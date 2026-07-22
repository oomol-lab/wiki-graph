import type {
  MentionRecord,
  ReadonlyDocument,
} from "../../../document/index.js";
import type { BookMeta } from "../../../text/source/index.js";
import { listChapters } from "../../../document/chapter/index.js";

import {
  createMentionLexicalHits,
  scoreLexicalText,
  type LexicalQuery,
} from "../lexical-search.js";
import {
  aggregateEvidenceScores,
  ARCHIVE_ROOT_ID,
  compareArchivePositions,
  compareFindEvidenceHits,
  createFindMatchFields,
  createNodePosition,
  createSnippet,
  getSnippetNeedle,
  isDefined,
  matchText,
} from "./helpers.js";
import type { ArchiveTextSearch } from "./helpers.js";
import { formatNodeId, formatTextStreamRangeUri } from "./references.js";
import { createTextStreamIndex } from "./text-streams.js";
import type {
  ArchiveFindHit,
  ArchiveFindMatch,
  ArchiveTextStreamKind,
} from "./types.js";
import { formatTripleUri, getMentionForTripleSearch } from "./knowledge.js";

export function findEntities(
  search: LexicalQuery,
  context: {
    readonly mentions: readonly MentionRecord[];
  },
): readonly ArchiveFindHit[] {
  const candidatesByQid = new Map<
    string,
    Array<{
      readonly hit: ArchiveFindHit;
      readonly mention: MentionRecord;
    }>
  >();

  for (const { match, mention } of createMentionLexicalHits(
    context.mentions,
    search,
  )) {
    const candidates = candidatesByQid.get(mention.qid) ?? [];

    candidates.push({
      hit: {
        chapter: mention.chapterId,
        field: "title" as const,
        id: `wikg://entity/${mention.qid}`,
        ...createFindMatchFields(match),
        position: {
          chapter: mention.chapterId,
          sentence: mention.sentenceIndex ?? 0,
        },
        snippet: mention.note ?? mention.surface,
        title: mention.surface,
        type: "entity" as const,
      },
      mention,
    });
    candidatesByQid.set(mention.qid, candidates);
  }

  return [...candidatesByQid.values()].map((candidates) => {
    const rankedCandidates = [...candidates].sort((left, right) => {
      const scoreComparison = (right.hit.score ?? 0) - (left.hit.score ?? 0);

      if (scoreComparison !== 0) {
        return scoreComparison;
      }
      if (left.hit.position === undefined) {
        return right.hit.position === undefined ? 0 : 1;
      }
      if (right.hit.position === undefined) {
        return -1;
      }
      return compareArchivePositions(left.hit.position, right.hit.position);
    });
    const [best] = rankedCandidates;

    if (best === undefined) {
      throw new Error("Internal error: entity search candidate is empty.");
    }

    return {
      ...best.hit,
      score: aggregateEvidenceScores(
        rankedCandidates.map((candidate) => candidate.hit.score ?? 0),
      ),
      evidenceMentions: rankedCandidates.map((candidate) => ({
        match: {
          matchCount: candidate.hit.matchCount ?? 0,
          matchedTerms: candidate.hit.matchedTerms ?? [],
          missingTerms: candidate.hit.missingTerms ?? [],
          score: candidate.hit.score ?? 0,
        },
        mention: candidate.mention,
      })),
    };
  });
}

export async function findTriples(
  document: ReadonlyDocument,
  search: LexicalQuery,
  context: {
    readonly mentions: readonly MentionRecord[];
  },
): Promise<readonly ArchiveFindHit[]> {
  const mentionsById = new Map(
    context.mentions.map((mention) => [mention.id, mention]),
  );
  const hitsByTriple = new Map<string, ArchiveFindHit[]>();

  for (const chapter of await listChapters(document)) {
    for (const link of await document.mentionLinks.listByChapter(
      chapter.chapterId,
    )) {
      const [source, target] = await Promise.all([
        getMentionForTripleSearch(document, mentionsById, link.sourceMentionId),
        getMentionForTripleSearch(document, mentionsById, link.targetMentionId),
      ]);

      if (source === undefined || target === undefined) {
        continue;
      }

      const text = `${source.surface} ${link.predicate} ${target.surface}`;
      const match = scoreLexicalText(text, search);

      if (match === undefined) {
        continue;
      }

      const id = formatTripleUri(source.qid, link.predicate, target.qid);
      const next = {
        chapter: source.chapterId,
        evidenceLinks: [link],
        field: "content" as const,
        id,
        ...createFindMatchFields(match),
        position: {
          chapter: source.chapterId,
          sentence: source.sentenceIndex ?? 0,
        },
        snippet: link.note ?? text,
        title: text,
        triple: {
          objectLabel: target.surface,
          predicate: link.predicate,
          subjectLabel: source.surface,
        },
        type: "triple" as const,
      };
      const values = hitsByTriple.get(id) ?? [];

      values.push(next);
      hitsByTriple.set(id, values);
    }
  }

  return [...hitsByTriple.values()].map(groupTripleEvidenceHits);
}

function groupTripleEvidenceHits(
  evidenceHits: readonly ArchiveFindHit[],
): ArchiveFindHit {
  const rankedHits = [...evidenceHits].sort(compareFindEvidenceHits);
  const [best] = rankedHits;

  if (best === undefined) {
    throw new Error("Internal error: triple search candidate is empty.");
  }

  return {
    ...best,
    evidenceLinks: rankedHits.flatMap((hit) => hit.evidenceLinks ?? []),
    score: aggregateEvidenceScores(rankedHits.map((hit) => hit.score ?? 0)),
  };
}

export function filterLexicalHitsByMatch(
  hits: readonly ArchiveFindHit[],
  search: LexicalQuery,
  match: ArchiveFindMatch,
): readonly ArchiveFindHit[] {
  if (match === "any") {
    return hits;
  }

  const requiredTerms = [...search.phrases];

  if (requiredTerms.length === 0) {
    return hits;
  }

  return hits.filter((hit) =>
    requiredTerms.every((term) => hit.matchedTerms?.includes(term) === true),
  );
}

export async function findChapters(
  document: ReadonlyDocument,
  search: ArchiveTextSearch,
): Promise<readonly ArchiveFindHit[]> {
  const hits: ArchiveFindHit[] = [];

  for (const chapter of await listChapters(document)) {
    const title = chapter.title ?? chapter.uri;
    const titleMatch = matchText(title, search);

    if (titleMatch !== undefined) {
      hits.push({
        chapter: chapter.chapterId,
        field: "title",
        id: `${chapter.uri}/title`,
        ...createFindMatchFields(titleMatch),
        position: {
          chapter: chapter.chapterId,
        },
        snippet: title,
        title,
        type: "chapter-title",
      });
    }

    hits.push(
      ...(await findTextStreamSentences(
        document,
        chapter.chapterId,
        chapter.path,
        "summary",
        title,
        search,
      )),
    );

    hits.push(
      ...(await findTextStreamSentences(
        document,
        chapter.chapterId,
        chapter.path,
        "source",
        title,
        search,
      )),
    );
  }

  return hits;
}

async function findTextStreamSentences(
  document: ReadonlyDocument,
  chapterId: number,
  chapterPath: string,
  stream: ArchiveTextStreamKind,
  title: string,
  search: ArchiveTextSearch,
): Promise<readonly ArchiveFindHit[]> {
  const index = await createTextStreamIndex(document, chapterId, stream);

  return index.sentences.flatMap((sentence) => {
    const match = matchText(sentence.text, search);

    if (match === undefined) {
      return [];
    }

    return [
      {
        chapter: chapterId,
        field: stream,
        id: formatTextStreamRangeUri(
          chapterPath,
          stream,
          sentence.globalIndex,
          sentence.globalIndex,
        ),
        ...createFindMatchFields(match),
        position: {
          chapter: chapterId,
          fragment: sentence.fragmentId,
          sentence: sentence.localIndex,
        },
        snippet: createSnippet(sentence.text, getSnippetNeedle(match)),
        title,
        type: stream === "source" ? ("source" as const) : ("summary" as const),
      },
    ];
  });
}

export function findMeta(
  meta: BookMeta | undefined,
  search: ArchiveTextSearch,
): readonly ArchiveFindHit[] {
  if (meta === undefined) {
    return [];
  }

  const fields = [
    meta.title,
    ...meta.authors,
    meta.description,
    meta.publisher,
  ].filter(isDefined);
  const content = fields.join("\n");
  const contentMatch = matchText(content, search);

  if (contentMatch === undefined) {
    return [];
  }

  return [
    {
      field: "metadata",
      id: ARCHIVE_ROOT_ID,
      ...createFindMatchFields(contentMatch),
      snippet: createSnippet(content, getSnippetNeedle(contentMatch)),
      title: meta.title ?? "Archive metadata",
      type: "meta",
    },
  ];
}

export async function findNodes(
  document: ReadonlyDocument,
  search: ArchiveTextSearch,
): Promise<readonly ArchiveFindHit[]> {
  const hits: ArchiveFindHit[] = [];

  for (const node of await document.chunks.listAll()) {
    const position = createNodePosition(node.sentenceIds);
    const labelMatch = matchText(node.label, search);

    if (labelMatch !== undefined) {
      hits.push({
        chapter: node.sentenceId[0],
        field: "title",
        id: formatNodeId(node.id),
        ...createFindMatchFields(labelMatch),
        ...(position === undefined ? {} : { position }),
        snippet: node.label,
        title: node.label,
        type: "node",
      });
    }
    const contentMatch = matchText(node.content, search);

    if (contentMatch !== undefined) {
      hits.push({
        chapter: node.sentenceId[0],
        field: "content",
        id: formatNodeId(node.id),
        ...createFindMatchFields(contentMatch),
        ...(position === undefined ? {} : { position }),
        snippet: createSnippet(node.content, getSnippetNeedle(contentMatch)),
        title: node.label,
        type: "node",
      });
    }
  }

  return hits;
}

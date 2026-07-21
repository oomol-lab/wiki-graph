import type { ReadonlyDocument } from "../../../document/index.js";

import { readEntitySearchEvidenceMentions } from "../search-cache/index.js";
import {
  encodeFindCursor,
  isWikiGraphObjectUri,
  mergeStringLists,
  normalizeWikiGraphObjectUri,
} from "./helpers.js";
import { parseWikiGraphReference } from "./references.js";
import type { WikiGraphReference } from "./references.js";
import { readTextStreamRange } from "./text-streams.js";
import type {
  ArchiveFindHit,
  ArchiveFindOptions,
  ArchiveFindOrder,
  EvidenceReadContext,
  TextStreamHitRange,
} from "./types.js";
import { DEFAULT_SOURCE_CONTEXT } from "./core.js";
import { compareMentions, parseEntityQid, selectEntityLabel } from "./knowledge.js";
import {
  createEvidenceReadContext,
  createExpandedSourceEvidenceRanges,
  createMentionEvidencePreview,
  createMentionEvidenceRanges,
  createMentionLinkEvidencePreview,
  createSourceEvidenceItem,
} from "./source.js";

export async function hydrateFindHitEvidence(
  document: ReadonlyDocument,
  hits: readonly ArchiveFindHit[],
  options: {
    readonly evidenceLimit?: number;
    readonly order?: ArchiveFindOrder;
    readonly sessionId?: string;
    readonly sourceContext?: number;
  } = {},
): Promise<readonly ArchiveFindHit[]> {
  const evidenceContext = createEvidenceReadContext();

  const hydrated = await Promise.all(
    hits.map(async (rawHit) => {
      const displayHit = await hydrateEntityDisplayHit(document, rawHit);
      const hit = await hydrateTextStreamHitContext(
        document,
        displayHit,
        options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
        evidenceContext,
      );

      if (hit.evidence !== undefined && hit.evidence.sources.length > 0) {
        return hit;
      }
      if (
        hit.evidence !== undefined &&
        hit.type === "entity" &&
        options.sessionId !== undefined
      ) {
        return await hydrateEntitySessionHitEvidence(
          document,
          hit,
          options.sessionId,
          options.evidenceLimit,
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          evidenceContext,
        );
      }
      if (hit.evidenceLinks !== undefined) {
        if (options.evidenceLimit === undefined) {
          const { evidenceLinks: _evidenceLinks, ...publicHit } = hit;

          return publicHit;
        }

        const evidence = await createMentionLinkEvidencePreview(
          document,
          hit.evidenceLinks,
          options.evidenceLimit,
          evidenceContext,
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          options.order ?? "doc-asc",
        );
        const { evidenceLinks: _evidenceLinks, ...publicHit } = hit;

        return {
          ...publicHit,
          evidence,
        };
      }
      if (hit.evidenceMentions === undefined) {
        return hit;
      }
      if (options.evidenceLimit === undefined) {
        const { evidenceMentions: _evidenceMentions, ...publicHit } = hit;

        return publicHit;
      }

      const evidence = await createMentionEvidencePreview(
        document,
        hit.evidenceMentions.map((item) => item.mention),
        options.evidenceLimit,
        evidenceContext,
        options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
        options.order ?? "doc-asc",
      );
      const { evidenceMentions: _evidenceMentions, ...publicHit } = hit;

      return {
        ...publicHit,
        evidence,
      };
    }),
  );

  return await coalesceTextStreamFindHits(document, hydrated, evidenceContext);
}

async function hydrateEntityDisplayHit(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
): Promise<ArchiveFindHit> {
  if (hit.type !== "entity") {
    return hit;
  }

  const qid = parseEntityQid(hit.id);

  if (qid === undefined) {
    return hit;
  }
  if (hit.title !== qid && hit.snippet !== qid) {
    return hit;
  }

  const mentions = await document.mentions.listByQid(qid);
  const [first] = mentions.sort(compareMentions);

  if (first === undefined) {
    return hit;
  }

  return {
    ...hit,
    chapter: first.chapterId,
    position: {
      chapter: first.chapterId,
      sentence: first.sentenceIndex ?? 0,
    },
    snippet: hit.snippet === qid ? (first.note ?? first.surface) : hit.snippet,
    title: hit.title === qid ? selectEntityLabel(mentions) : hit.title,
  };
}

async function hydrateTextStreamHitContext(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
  sourceContext: number,
  context: EvidenceReadContext,
): Promise<ArchiveFindHit> {
  if (sourceContext <= 0 || (hit.type !== "source" && hit.type !== "summary")) {
    return hit;
  }
  if (hit.matchCount === undefined && hit.matchedTerms === undefined) {
    return hit;
  }

  const reference = parseTextStreamHitReference(hit.id);

  if (reference === undefined) {
    return hit;
  }

  const range = await readTextStreamRange(
    document,
    reference.chapterId,
    reference.stream,
    reference.startSentenceIndex - sourceContext,
    reference.endSentenceIndex + sourceContext,
    context,
  );

  return {
    ...hit,
    id: range.id,
    snippet: range.text,
  };
}

function parseTextStreamHitReference(
  uri: string,
): Extract<WikiGraphReference, { readonly type: "text-stream" }> | undefined {
  if (!isWikiGraphObjectUri(uri)) {
    return undefined;
  }

  try {
    const reference = parseWikiGraphReference(normalizeWikiGraphObjectUri(uri));

    return reference.type === "text-stream" ? reference : undefined;
  } catch {
    return undefined;
  }
}

async function coalesceTextStreamFindHits(
  document: ReadonlyDocument,
  hits: readonly ArchiveFindHit[],
  context: EvidenceReadContext,
): Promise<readonly ArchiveFindHit[]> {
  const entries: Array<
    | { readonly hit: ArchiveFindHit; readonly type: "hit" }
    | { range: TextStreamHitRange; readonly type: "range" }
  > = [];

  for (const hit of hits) {
    const range = parseSearchTextStreamHitRange(hit);

    if (range === undefined || hit.backlinks !== undefined) {
      entries.push({ hit, type: "hit" });
      continue;
    }

    const overlappingIndexes = entries
      .map((entry, index) =>
        entry.type === "range" &&
        areMergeableTextStreamHitRanges(entry.range, range)
          ? index
          : -1,
      )
      .filter((index) => index >= 0);

    if (overlappingIndexes.length === 0) {
      entries.push({ range, type: "range" });
      continue;
    }

    const firstIndex = overlappingIndexes[0] ?? 0;
    const ranges = overlappingIndexes.flatMap((index) => {
      const entry = entries[index];

      return entry?.type === "range" ? [entry.range] : [];
    });

    entries[firstIndex] = {
      range: await mergeTextStreamHitRangeGroup(
        document,
        [...ranges, range],
        context,
      ),
      type: "range",
    };

    for (const index of overlappingIndexes.slice(1).reverse()) {
      entries.splice(index, 1);
    }
  }

  return entries.map((entry) =>
    entry.type === "range" ? entry.range.hit : entry.hit,
  );
}

function parseSearchTextStreamHitRange(
  hit: ArchiveFindHit,
): TextStreamHitRange | undefined {
  if (hit.type !== "source" && hit.type !== "summary") {
    return undefined;
  }
  if (hit.matchCount === undefined && hit.matchedTerms === undefined) {
    return undefined;
  }

  const reference = parseTextStreamHitReference(hit.id);

  if (reference === undefined) {
    return undefined;
  }

  return {
    chapterId: reference.chapterId,
    endSentenceIndex: reference.endSentenceIndex,
    hit,
    startSentenceIndex: reference.startSentenceIndex,
    stream: reference.stream,
  };
}

function areMergeableTextStreamHitRanges(
  left: TextStreamHitRange,
  right: TextStreamHitRange,
): boolean {
  return (
    left.chapterId === right.chapterId &&
    left.stream === right.stream &&
    right.startSentenceIndex <= left.endSentenceIndex + 1 &&
    left.startSentenceIndex <= right.endSentenceIndex + 1
  );
}

async function mergeTextStreamHitRangeGroup(
  document: ReadonlyDocument,
  ranges: readonly TextStreamHitRange[],
  context: EvidenceReadContext,
): Promise<TextStreamHitRange> {
  const [representative] = ranges;

  if (representative === undefined) {
    throw new Error(
      "Internal error: cannot merge empty text stream hit group.",
    );
  }

  const startSentenceIndex = Math.min(
    ...ranges.map((range) => range.startSentenceIndex),
  );
  const endSentenceIndex = Math.max(
    ...ranges.map((range) => range.endSentenceIndex),
  );
  const text = await readTextStreamRange(
    document,
    representative.chapterId,
    representative.stream,
    startSentenceIndex,
    endSentenceIndex,
    context,
  );
  const hits = ranges.map((range) => range.hit);
  const scores = hits
    .map((hit) => hit.score)
    .filter((score): score is number => score !== undefined);

  return {
    chapterId: representative.chapterId,
    endSentenceIndex,
    hit: {
      ...representative.hit,
      id: text.id,
      matchCount: Math.max(...hits.map((hit) => hit.matchCount ?? 0)),
      matchedTerms: mergeStringLists(
        hits.flatMap((hit) => hit.matchedTerms ?? []),
      ),
      missingTerms: mergeStringLists(
        hits.flatMap((hit) => hit.missingTerms ?? []),
      ),
      ...(scores.length === 0 ? {} : { score: Math.max(...scores) }),
      snippet: text.text,
    },
    startSentenceIndex,
    stream: representative.stream,
  };
}


export function createFindEvidenceHydrationOptions(
  options: ArchiveFindOptions,
  sessionId?: string,
): {
  readonly evidenceLimit?: number;
  readonly order?: ArchiveFindOrder;
  readonly sessionId?: string;
  readonly sourceContext?: number;
} {
  return {
    ...(options.evidenceLimit === undefined
      ? {}
      : { evidenceLimit: options.evidenceLimit }),
    order: options.order ?? "doc-asc",
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(options.sourceContext === undefined
      ? {}
      : { sourceContext: options.sourceContext }),
  };
}

async function hydrateEntitySessionHitEvidence(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
  sessionId: string,
  evidenceLimit: number | undefined,
  sourceContext: number,
  context: EvidenceReadContext = createEvidenceReadContext(),
): Promise<ArchiveFindHit> {
  if (evidenceLimit === undefined) {
    const { evidence: _evidence, ...publicHit } = hit;

    return publicHit;
  }

  const qid = parseEntityQid(hit.id);

  if (qid === undefined) {
    return hit;
  }

  const mentionsByQid = await document.mentions.listByQid(qid);
  const mentionsById = new Map(
    mentionsByQid.map((mention) => [mention.id, mention]),
  );
  const allMentions = (
    await readEntitySearchEvidenceMentions(
      sessionId,
      mentionsByQid.map((mention) => mention.id),
      10_000,
    )
  ).flatMap((hit) => {
    const mention = mentionsById.get(hit.mentionId);

    return mention === undefined ? [] : [mention];
  });
  const ranges = await createMentionEvidenceRanges(document, allMentions);
  const mergedRanges = await createExpandedSourceEvidenceRanges(
    document,
    ranges,
    sourceContext,
    context,
  );
  const sources = await Promise.all(
    mergedRanges
      .slice(0, evidenceLimit)
      .map(
        async (range) =>
          await createSourceEvidenceItem(
            document,
            range.chapterId,
            range.startSentenceIndex,
            range.endSentenceIndex,
            context,
          ),
      ),
  );

  return {
    ...hit,
    ...(allMentions[0] === undefined
      ? {}
      : {
          chapter: allMentions[0].chapterId,
          position: {
            chapter: allMentions[0].chapterId,
            sentence: allMentions[0].sentenceIndex ?? 0,
          },
          snippet: allMentions[0].note ?? allMentions[0].surface,
          title: allMentions[0].surface,
        }),
    evidence: {
      nextCursor:
        sources.length < mergedRanges.length
          ? encodeFindCursor(sources.length)
          : null,
      shown: sources.length,
      sources,
      total: mergedRanges.length,
    },
  };
}

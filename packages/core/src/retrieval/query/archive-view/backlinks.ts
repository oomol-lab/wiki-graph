import type { ReadonlyDocument, SentenceId } from "../../../document/index.js";

import {
  compareListHits,
  compareSentenceIds,
  createNodePosition,
  createSentencePosition,
  createSnippet,
  isWikiGraphObjectUri,
  normalizeWikiGraphObjectUri,
} from "./helpers.js";
import { formatNodeId, parseWikiGraphReference } from "./references.js";
import type { WikiGraphReference } from "./references.js";
import { createTextStreamIndex } from "./text-streams.js";
import type {
  ArchiveBacklinkBucket,
  ArchiveBacklinks,
  ArchiveCollectionOptions,
  ArchiveFindHit,
  ArchiveFindOptions,
  ArchiveFindResult,
} from "./types.js";
import { formatTripleUri, listAllMentions } from "./knowledge.js";
import { listEntityCollection } from "./collection.js";

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export async function hydrateFindResultBacklinks(
  document: ReadonlyDocument,
  result: ArchiveFindResult,
  options: Pick<ArchiveFindOptions, "backlinks">,
): Promise<ArchiveFindResult> {
  return {
    ...result,
    items: await hydrateFindHitBacklinks(document, result.items, options),
  };
}

export async function hydrateFindHitBacklinks(
  document: ReadonlyDocument,
  hits: readonly ArchiveFindHit[],
  options:
    | Pick<ArchiveFindOptions, "backlinks">
    | Pick<ArchiveCollectionOptions, "backlinks">,
): Promise<readonly ArchiveFindHit[]> {
  if (options.backlinks !== true) {
    return hits;
  }

  return await Promise.all(
    hits.map(async (hit) => {
      const reference = parseSourceBacklinkReference(hit.id);

      if (reference === undefined) {
        return hit;
      }

      return {
        ...hit,
        backlinks: await createTextStreamBacklinks(document, reference),
      };
    }),
  );
}

export function parseSourceBacklinkReference(
  uri: string,
): Extract<WikiGraphReference, { readonly type: "text-stream" }> | undefined {
  if (!isWikiGraphObjectUri(uri)) {
    return undefined;
  }

  try {
    const reference = parseWikiGraphReference(normalizeWikiGraphObjectUri(uri));

    return reference.type === "text-stream" && reference.stream === "source"
      ? reference
      : undefined;
  } catch {
    return undefined;
  }
}

export async function createTextStreamBacklinks(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "text-stream" }>,
): Promise<ArchiveBacklinks> {
  if (reference.stream !== "source") {
    return createEmptyBacklinks();
  }

  const sentenceKeys = await createTextStreamRangeSentenceKeySet(
    document,
    reference,
  );
  const [chunks, mentions, links] = await Promise.all([
    createChunkBacklinkHits(document, sentenceKeys),
    createEntityBacklinkHits(document, sentenceKeys),
    createTripleBacklinkHits(document, reference.chapterId, sentenceKeys),
  ]);

  return {
    chunks: createBacklinkBucket(chunks),
    entities: createBacklinkBucket(mentions),
    triples: createBacklinkBucket(links),
  };
}

function createEmptyBacklinks(): ArchiveBacklinks {
  return {
    chunks: createBacklinkBucket([]),
    entities: createBacklinkBucket([]),
    triples: createBacklinkBucket([]),
  };
}

function createBacklinkBucket(
  hits: readonly ArchiveFindHit[],
): ArchiveBacklinkBucket {
  const sorted = [...hits].sort((left, right) =>
    compareListHits(left, right, "doc-asc"),
  );

  return {
    items: sorted,
    limit: sorted.length,
    nextCursor: null,
  };
}

async function createTextStreamRangeSentenceKeySet(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "text-stream" }>,
): Promise<ReadonlySet<string>> {
  const index = await createTextStreamIndex(
    document,
    reference.chapterId,
    reference.stream,
  );
  const lastSentenceIndex = Math.max(0, index.sentences.length - 1);
  const start = clampInteger(
    reference.startSentenceIndex,
    0,
    lastSentenceIndex,
  );
  const end = clampInteger(
    reference.endSentenceIndex,
    start,
    lastSentenceIndex,
  );
  const keys = new Set<string>();

  for (const sentence of index.sentences.slice(start, end + 1)) {
    keys.add(formatSentenceKey(reference.chapterId, sentence.globalIndex));
  }

  return keys;
}

async function createChunkBacklinkHits(
  document: ReadonlyDocument,
  sentenceKeys: ReadonlySet<string>,
): Promise<readonly ArchiveFindHit[]> {
  return (await document.chunks.listAll())
    .filter((chunk) =>
      chunk.sentenceIds.some((sentenceId) =>
        sentenceKeys.has(formatSentenceIdKey(sentenceId)),
      ),
    )
    .map((chunk) => {
      const position = createNodePosition(chunk.sentenceIds);

      return {
        chapter: chunk.sentenceId[0],
        field: "content" as const,
        id: formatNodeId(chunk.id),
        ...(position === undefined ? {} : { position }),
        snippet: createSnippet(chunk.content),
        title: chunk.label,
        type: "node" as const,
      };
    });
}

async function createEntityBacklinkHits(
  document: ReadonlyDocument,
  sentenceKeys: ReadonlySet<string>,
): Promise<readonly ArchiveFindHit[]> {
  return listEntityCollection(
    (await listAllMentions(document)).filter((mention) =>
      sentenceKeys.has(
        formatSentenceKey(mention.chapterId, mention.sentenceIndex ?? 0),
      ),
    ),
  );
}

async function createTripleBacklinkHits(
  document: ReadonlyDocument,
  chapterId: number,
  sentenceKeys: ReadonlySet<string>,
): Promise<readonly ArchiveFindHit[]> {
  const hitsById = new Map<string, ArchiveFindHit>();

  for (const link of await document.mentionLinks.listByChapter(chapterId)) {
    const evidenceSentenceIds = link.evidenceSentenceIds.filter((sentenceId) =>
      sentenceKeys.has(formatSentenceIdKey(sentenceId)),
    );

    if (evidenceSentenceIds.length === 0) {
      continue;
    }

    const [source, target] = await Promise.all([
      document.mentions.getById(link.sourceMentionId),
      document.mentions.getById(link.targetMentionId),
    ]);

    if (source === undefined || target === undefined) {
      continue;
    }

    const id = formatTripleUri(source.qid, link.predicate, target.qid);
    const existing = hitsById.get(id);
    const evidenceLink = { ...link, evidenceSentenceIds };

    if (existing !== undefined) {
      hitsById.set(id, {
        ...existing,
        evidenceLinks: [...(existing.evidenceLinks ?? []), evidenceLink],
        score: (existing.evidenceLinks?.length ?? 0) + 1,
      });
      continue;
    }

    hitsById.set(id, {
      chapter: source.chapterId,
      evidenceLinks: [evidenceLink],
      field: "title",
      id,
      position: createSentencePosition(
        [...evidenceSentenceIds].sort(compareSentenceIds)[0] ?? [
          source.chapterId,
          source.sentenceIndex ?? 0,
        ],
      ),
      score: 1,
      snippet: `${source.surface} ${link.predicate} ${target.surface}`,
      title: `${source.qid} ${link.predicate} ${target.qid}`,
      triple: {
        objectLabel: target.surface,
        predicate: link.predicate,
        subjectLabel: source.surface,
      },
      type: "triple",
    });
  }

  return [...hitsById.values()];
}

function formatSentenceIdKey(sentenceId: SentenceId): string {
  return formatSentenceKey(sentenceId[0], sentenceId[1]);
}

function formatSentenceKey(chapterId: number, sentenceIndex: number): string {
  return `${chapterId}:${sentenceIndex}`;
}

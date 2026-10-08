import type {
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
} from "../../../../document/index.js";

import { TEXT_SENTENCE_KIND } from "../../../search-index/search/index.js";
import { listArchiveQueryableChapterIds } from "../index-state.js";
import {
  DEFAULT_FIND_LIMIT,
  compareNumbers,
  decodeFindCursor,
  encodeFindCursor,
} from "../helpers.js";
import { queryRequiredSearchIndex } from "../search/hydration.js";
import type {
  ArchiveEvidence,
  ArchiveEvidenceOptions,
  ArchiveFindEvidencePreview,
  ArchiveFindOrder,
  EvidenceReadContext,
  SourceEvidenceRange,
} from "../types.js";
import { DEFAULT_SOURCE_CONTEXT } from "../core.js";
import {
  createMentionEvidenceRanges,
  createMentionLinkEvidenceRanges,
} from "./ranges.js";
import {
  createSourceEvidenceCandidatePage,
  createSourceEvidenceCandidatePreview,
  createSourceEvidenceDisplayItems,
} from "./pagination.js";
import { createEvidenceReadContext } from "./read.js";

export { createEvidenceReadContext, createSourceEvidenceItem } from "./read.js";
export {
  createExpandedSourceEvidenceRanges,
  createMentionEvidenceRanges,
  createMentionLinkEvidenceRanges,
  createNodeEvidenceRanges,
} from "./ranges.js";

export async function createMentionEvidencePreview(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: await sortSourceEvidenceCandidates(
      document,
      mentions,
      async (mention) => await createMentionEvidenceRanges(document, [mention]),
      order,
    ),
    context,
    createRanges: async (mention) =>
      await createMentionEvidenceRanges(document, [mention]),
    limit,
    sourceContext,
    total,
  });
}

export async function createMentionEvidencePagePreview(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: mentions,
    context,
    createRanges: async (mention) =>
      await createMentionEvidenceRanges(document, [mention]),
    limit,
    sourceContext,
    total,
  });
}

export async function createMentionEvidencePage(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
  options: {
    readonly context: EvidenceReadContext;
    readonly limit: number;
    readonly offset: number;
    readonly sourceContext?: number | undefined;
    readonly total: number;
  },
): Promise<ArchiveEvidence> {
  return await createSourceEvidenceCandidatePage(document, {
    candidates: mentions,
    context: options.context,
    createRanges: async (mention) =>
      await createMentionEvidenceRanges(document, [mention]),
    limit: options.limit,
    offset: options.offset,
    sourceContext: options.sourceContext,
    total: options.total,
  });
}

export async function createRangeEvidencePreview(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: ranges,
    context,
    createRanges: (range) => [range],
    limit,
    sourceContext,
    total,
  });
}

export async function createSortedRangeEvidencePreview(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createRangeEvidencePreview(
    document,
    await sortSourceEvidenceRanges(document, ranges, order),
    limit,
    context,
    sourceContext,
    total,
  );
}

export async function createMentionLinkEvidencePreview(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: await sortSourceEvidenceCandidates(
      document,
      links,
      (link) => createMentionLinkEvidenceRanges(document, [link]),
      order,
    ),
    context,
    createRanges: (link) => createMentionLinkEvidenceRanges(document, [link]),
    limit,
    sourceContext,
    total,
  });
}

export async function createMentionLinkEvidencePagePreview(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: links,
    context,
    createRanges: (link) => createMentionLinkEvidenceRanges(document, [link]),
    limit,
    sourceContext,
    total,
  });
}

export async function createMentionLinkEvidencePage(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  options: {
    readonly context: EvidenceReadContext;
    readonly limit: number;
    readonly offset: number;
    readonly sourceContext?: number | undefined;
    readonly total: number;
  },
): Promise<ArchiveEvidence> {
  return await createSourceEvidenceCandidatePage(document, {
    candidates: links,
    context: options.context,
    createRanges: (link) => createMentionLinkEvidenceRanges(document, [link]),
    limit: options.limit,
    offset: options.offset,
    sourceContext: options.sourceContext,
    total: options.total,
  });
}

export async function createSortedMentionLinkEvidencePreview(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createRangeEvidencePreview(
    document,
    await sortSourceEvidenceRanges(
      document,
      createMentionLinkEvidenceRanges(document, links),
      order,
    ),
    limit,
    context,
    sourceContext,
    total,
  );
}

export async function createSourceEvidencePage(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  options: ArchiveEvidenceOptions,
): Promise<ArchiveEvidence> {
  const context = createEvidenceReadContext();
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const start = decodeFindCursor(options.cursor);
  const evidenceRanges = await filterAndSortSourceEvidenceRangesByFtsQuery(
    document,
    ranges,
    options.query,
    options.order ?? "doc-asc",
    options,
  );
  const pageRanges = evidenceRanges.slice(start, start + limit);
  const nextOffset = start + pageRanges.length;
  const items = await createSourceEvidenceDisplayItems(document, pageRanges, {
    context,
    sourceContext: options.sourceContext,
  });

  return {
    items,
    limit,
    nextCursor:
      nextOffset < evidenceRanges.length ? encodeFindCursor(nextOffset) : null,
  };
}

export async function filterAndSortSourceEvidenceRangesByFtsQuery(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  queryText: string | undefined,
  order: ArchiveFindOrder,
  options: Pick<
    ArchiveEvidenceOptions,
    "embeddingProvider" | "queryMode" | "skipUnindexed"
  > = {},
): Promise<readonly SourceEvidenceRange[]> {
  const documentOrders = await document.serials.listDocumentOrders();

  if (queryText === undefined) {
    return [...ranges].sort((left, right) =>
      compareSourceEvidenceRanges(left, right, documentOrders, order),
    );
  }

  const queryRanges =
    options.skipUnindexed === true
      ? await filterQueryableSourceEvidenceRanges(document, ranges, options)
      : ranges;
  if (queryRanges.length === 0) {
    return [];
  }

  const indexResult = await queryRequiredSearchIndex(document, queryText, {
    chapters: [...new Set(queryRanges.map((range) => range.chapterId))],
    types: ["source"],
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
    ...(options.queryMode === undefined
      ? {}
      : { queryMode: options.queryMode }),
  });

  if (indexResult === undefined) {
    return [];
  }

  const matchedRanges = new Map<string, SourceEvidenceRange>();
  const rangesByChapterId = new Map<number, SourceEvidenceRange[]>();

  for (const range of queryRanges) {
    const chapterRanges = rangesByChapterId.get(range.chapterId) ?? [];

    chapterRanges.push(range);
    rangesByChapterId.set(range.chapterId, chapterRanges);
  }

  for (const hit of indexResult.textHits) {
    if (hit.kind !== TEXT_SENTENCE_KIND.source) {
      continue;
    }

    for (const range of rangesByChapterId.get(hit.chapterId) ?? []) {
      if (
        hit.sentenceIndex < range.startSentenceIndex ||
        hit.sentenceIndex > range.endSentenceIndex
      ) {
        continue;
      }

      const key = formatSourceEvidenceRangeKey(range);
      const current = matchedRanges.get(key);

      matchedRanges.set(key, {
        ...range,
        score: Math.max(current?.score ?? 0, hit.score),
      });
    }
  }

  return [...matchedRanges.values()].sort((left, right) => {
    const scoreComparison = (right.score ?? 0) - (left.score ?? 0);

    if (scoreComparison !== 0) {
      return scoreComparison;
    }

    return compareSourceEvidenceRanges(left, right, documentOrders, "doc-asc");
  });
}

export async function filterAndSortSourceEvidenceCandidatesByFtsQuery<T>(
  document: ReadonlyDocument,
  candidates: readonly T[],
  createRanges: (
    candidate: T,
  ) => Promise<readonly SourceEvidenceRange[]> | readonly SourceEvidenceRange[],
  stableIdentity: (candidate: T) => string,
  queryText: string,
  options: Pick<
    ArchiveEvidenceOptions,
    "embeddingProvider" | "queryMode" | "skipUnindexed"
  > = {},
): Promise<readonly SourceEvidenceCandidateQueryMatch<T>[]> {
  let keyed: readonly SourceEvidenceCandidateQueryItem<T>[] = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      ranges: await createRanges(candidate),
      score: 0,
      stableIdentity: stableIdentity(candidate),
    })),
  );
  if (options.skipUnindexed === true) {
    keyed = await filterQueryableSourceEvidenceCandidates(
      document,
      keyed,
      options,
    );
  }
  if (keyed.length === 0) {
    return [];
  }
  const indexResult = await queryRequiredSearchIndex(document, queryText, {
    chapters: [
      ...new Set(
        keyed.flatMap((item) => item.ranges.map((range) => range.chapterId)),
      ),
    ],
    types: ["source"],
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
    ...(options.queryMode === undefined
      ? {}
      : { queryMode: options.queryMode }),
  });

  if (indexResult === undefined) {
    return [];
  }

  const matched = new Map<
    string,
    {
      readonly candidate: T;
      readonly ranges: readonly SourceEvidenceRange[];
      readonly stableIdentity: string;
      score: number;
    }
  >();

  for (const hit of indexResult.textHits) {
    if (hit.kind !== TEXT_SENTENCE_KIND.source) {
      continue;
    }

    for (const item of keyed) {
      if (
        !item.ranges.some(
          (range) =>
            range.chapterId === hit.chapterId &&
            hit.sentenceIndex >= range.startSentenceIndex &&
            hit.sentenceIndex <= range.endSentenceIndex,
        )
      ) {
        continue;
      }

      const current = matched.get(item.stableIdentity) ?? item;
      current.score = Math.max(current.score, hit.score);
      matched.set(item.stableIdentity, current);
    }
  }

  const documentOrders = await document.serials.listDocumentOrders();

  return [...matched.values()]
    .sort((left, right) => {
      const scoreComparison = right.score - left.score;

      if (scoreComparison !== 0) {
        return scoreComparison;
      }

      const rangeComparison = compareSourceEvidenceRanges(
        firstSourceEvidenceRange(left.ranges),
        firstSourceEvidenceRange(right.ranges),
        documentOrders,
        "doc-asc",
      );

      if (rangeComparison !== 0) {
        return rangeComparison;
      }

      return left.stableIdentity.localeCompare(right.stableIdentity);
    })
    .map((item) => ({ candidate: item.candidate, score: item.score }));
}

async function filterQueryableSourceEvidenceRanges(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  options: Pick<ArchiveEvidenceOptions, "embeddingProvider" | "queryMode">,
): Promise<readonly SourceEvidenceRange[]> {
  const queryableChapters = new Set(
    await listArchiveQueryableChapterIds(document, {
      chapters: [...new Set(ranges.map((range) => range.chapterId))],
      ...(options.embeddingProvider === undefined
        ? {}
        : { embeddingProvider: options.embeddingProvider }),
      requireEmbeddingProvider: true,
      ...(options.queryMode === undefined
        ? {}
        : { queryMode: options.queryMode }),
    }),
  );

  return ranges.filter((range) => queryableChapters.has(range.chapterId));
}

async function filterQueryableSourceEvidenceCandidates<T>(
  document: ReadonlyDocument,
  candidates: readonly SourceEvidenceCandidateQueryItem<T>[],
  options: Pick<ArchiveEvidenceOptions, "embeddingProvider" | "queryMode">,
): Promise<readonly SourceEvidenceCandidateQueryItem<T>[]> {
  const queryableChapters = new Set(
    await listArchiveQueryableChapterIds(document, {
      chapters: [
        ...new Set(
          candidates.flatMap((item) =>
            item.ranges.map((range) => range.chapterId),
          ),
        ),
      ],
      ...(options.embeddingProvider === undefined
        ? {}
        : { embeddingProvider: options.embeddingProvider }),
      requireEmbeddingProvider: true,
      ...(options.queryMode === undefined
        ? {}
        : { queryMode: options.queryMode }),
    }),
  );

  return candidates
    .map((item) => ({
      ...item,
      ranges: item.ranges.filter((range) =>
        queryableChapters.has(range.chapterId),
      ),
    }))
    .filter((item) => item.ranges.length > 0);
}

export interface SourceEvidenceCandidateQueryMatch<T> {
  readonly candidate: T;
  readonly score: number;
}

interface SourceEvidenceCandidateQueryItem<T> {
  readonly candidate: T;
  readonly ranges: readonly SourceEvidenceRange[];
  readonly stableIdentity: string;
  score: number;
}

function firstSourceEvidenceRange(
  ranges: readonly SourceEvidenceRange[],
): SourceEvidenceRange {
  const [first] = ranges;

  return (
    first ?? {
      chapterId: Number.MAX_SAFE_INTEGER,
      endSentenceIndex: Number.MAX_SAFE_INTEGER,
      startSentenceIndex: Number.MAX_SAFE_INTEGER,
    }
  );
}

function formatSourceEvidenceRangeKey(range: SourceEvidenceRange): string {
  return `${range.chapterId}:${range.startSentenceIndex}:${range.endSentenceIndex}`;
}

async function sortSourceEvidenceCandidates<T>(
  document: ReadonlyDocument,
  candidates: readonly T[],
  createRanges: (
    candidate: T,
  ) => Promise<readonly SourceEvidenceRange[]> | readonly SourceEvidenceRange[],
  order: ArchiveFindOrder,
): Promise<readonly T[]> {
  const documentOrders = await document.serials.listDocumentOrders();
  const keyed = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      range: (await createRanges(candidate))[0],
    })),
  );

  return keyed
    .sort((left, right) => {
      if (left.range === undefined || right.range === undefined) {
        return left.range === undefined
          ? right.range === undefined
            ? 0
            : 1
          : -1;
      }
      return compareSourceEvidenceRanges(
        left.range,
        right.range,
        documentOrders,
        order,
      );
    })
    .map((item) => item.candidate);
}

function compareSourceEvidenceRanges(
  left: SourceEvidenceRange,
  right: SourceEvidenceRange,
  documentOrders: ReadonlyMap<number, number>,
  order: ArchiveFindOrder,
): number {
  const direction = order === "doc-asc" ? 1 : -1;

  return (
    (compareNumbers(
      documentOrders.get(left.chapterId) ?? left.chapterId,
      documentOrders.get(right.chapterId) ?? right.chapterId,
    ) ||
      compareNumbers(left.chapterId, right.chapterId) ||
      compareNumbers(left.startSentenceIndex, right.startSentenceIndex) ||
      compareNumbers(left.endSentenceIndex, right.endSentenceIndex)) * direction
  );
}

export async function createSourceEvidencePreview(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  limit: number,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSortedRangeEvidencePreview(
    document,
    ranges,
    limit,
    context,
    sourceContext,
    order,
    total,
  );
}

async function sortSourceEvidenceRanges(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  order: ArchiveFindOrder,
): Promise<readonly SourceEvidenceRange[]> {
  const documentOrders = await document.serials.listDocumentOrders();

  return [...ranges].sort((left, right) =>
    compareSourceEvidenceRanges(left, right, documentOrders, order),
  );
}

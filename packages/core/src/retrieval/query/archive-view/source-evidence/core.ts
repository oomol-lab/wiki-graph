import type {
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
} from "../../../../document/index.js";

import { TEXT_SENTENCE_KIND } from "../../../search-index/search/index.js";
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
  createExpandedSourceEvidenceRanges,
  createMentionEvidenceRanges,
  createMentionLinkEvidenceRanges,
  mergeSourceEvidenceRanges,
} from "./ranges.js";
import { createEvidenceReadContext, createSourceEvidenceItem } from "./read.js";

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
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidencePreview(
    document,
    await createMentionEvidenceRanges(document, mentions),
    limit,
    context,
    sourceContext,
    order,
  );
}

export async function createMentionLinkEvidencePreview(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidencePreview(
    document,
    createMentionLinkEvidenceRanges(document, links),
    limit,
    context,
    sourceContext,
    order,
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
  );
  const displayRanges = await createExpandedSourceEvidenceRanges(
    document,
    evidenceRanges,
    options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
    context,
  );
  const pageRanges = displayRanges.slice(start, start + limit);
  const nextOffset = start + pageRanges.length;
  const items = await Promise.all(
    pageRanges.map(
      async (range) =>
        await createSourceEvidenceItem(
          document,
          range.chapterId,
          range.startSentenceIndex,
          range.endSentenceIndex,
          context,
          range.score,
        ),
    ),
  );

  return {
    items,
    limit,
    nextCursor:
      nextOffset < displayRanges.length ? encodeFindCursor(nextOffset) : null,
  };
}

export async function filterAndSortSourceEvidenceRangesByFtsQuery(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  queryText: string | undefined,
  order: ArchiveFindOrder,
): Promise<readonly SourceEvidenceRange[]> {
  const documentOrders = await document.serials.listDocumentOrders();

  if (queryText === undefined) {
    return mergeSourceEvidenceRanges(ranges).sort((left, right) =>
      compareSourceEvidenceRanges(left, right, documentOrders, order),
    );
  }

  const indexResult = await queryRequiredSearchIndex(document, queryText, {
    chapters: [...new Set(ranges.map((range) => range.chapterId))],
    types: ["source"],
  });

  if (indexResult === undefined) {
    return [];
  }

  const matchedRanges = new Map<string, SourceEvidenceRange>();
  const rangesByChapterId = new Map<number, SourceEvidenceRange[]>();

  for (const range of ranges) {
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

function formatSourceEvidenceRangeKey(range: SourceEvidenceRange): string {
  return `${range.chapterId}:${range.startSentenceIndex}:${range.endSentenceIndex}`;
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
): Promise<ArchiveFindEvidencePreview> {
  const documentOrders = await document.serials.listDocumentOrders();
  const mergedRanges = mergeSourceEvidenceRanges(ranges).sort((left, right) =>
    compareSourceEvidenceRanges(left, right, documentOrders, order),
  );
  const displayRanges = await createExpandedSourceEvidenceRanges(
    document,
    mergedRanges.slice(0, limit),
    sourceContext,
    context,
  );
  const sources = await Promise.all(
    displayRanges.map(
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
    nextCursor:
      Math.min(limit, mergedRanges.length) < mergedRanges.length
        ? encodeFindCursor(Math.min(limit, mergedRanges.length))
        : null,
    shown: sources.length,
    sources,
    total: mergedRanges.length,
  };
}

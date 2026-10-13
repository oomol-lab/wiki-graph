import type { ReadonlyDocument } from "../../../../document/index.js";

import { encodeFindCursor } from "../helpers.js";
import type {
  ArchiveEvidence,
  ArchiveEvidenceItem,
  ArchiveFindEvidencePreview,
  EvidenceReadContext,
  SourceEvidenceRange,
} from "../types.js";
import { DEFAULT_SOURCE_CONTEXT } from "../core.js";
import {
  createExpandedSourceEvidenceRanges,
  mergeSourceEvidenceRangesInInputOrder,
} from "./ranges.js";
import { createSourceEvidenceItem } from "./read.js";

export interface SourceEvidencePageDisplayOptions {
  readonly context: EvidenceReadContext;
  readonly sourceContext?: number | undefined;
}

export interface SourceEvidenceCandidatePageOptions<T> {
  readonly candidates: readonly T[];
  readonly context: EvidenceReadContext;
  readonly createRanges: (
    candidate: T,
  ) => Promise<readonly SourceEvidenceRange[]> | readonly SourceEvidenceRange[];
  readonly limit: number;
  readonly offset?: number | undefined;
  readonly sourceContext?: number | undefined;
  readonly total?: number | undefined;
}

export async function createSourceEvidenceCandidatePage<T>(
  document: ReadonlyDocument,
  options: SourceEvidenceCandidatePageOptions<T>,
): Promise<ArchiveEvidence> {
  const pageCandidates = options.candidates.slice(0, options.limit);
  const items = await createSourceEvidenceCandidateItems(document, {
    ...options,
    candidates: pageCandidates,
  });
  const nextOffset = (options.offset ?? 0) + pageCandidates.length;
  const total = options.total ?? options.candidates.length;

  return {
    items,
    limit: options.limit,
    nextCursor: nextOffset < total ? encodeFindCursor(nextOffset) : null,
  };
}

export async function createSourceEvidenceCandidatePreview<T>(
  document: ReadonlyDocument,
  options: SourceEvidenceCandidatePageOptions<T>,
): Promise<ArchiveFindEvidencePreview> {
  const pageCandidates = options.candidates.slice(0, options.limit);
  const sources = await createSourceEvidenceCandidateItems(document, {
    ...options,
    candidates: pageCandidates,
  });
  const total = options.total ?? options.candidates.length;
  const nextOffset = (options.offset ?? 0) + pageCandidates.length;

  return {
    nextCursor: nextOffset < total ? encodeFindCursor(nextOffset) : null,
    shown: sources.length,
    sources,
    total,
  };
}

async function createSourceEvidenceCandidateItems<T>(
  document: ReadonlyDocument,
  options: SourceEvidenceCandidatePageOptions<T>,
): Promise<ArchiveEvidenceItem[]> {
  const ranges = (
    await Promise.all(
      options.candidates.map(
        async (candidate) => await options.createRanges(candidate),
      ),
    )
  ).flat();

  return await createSourceEvidenceDisplayItems(document, ranges, {
    context: options.context,
    sourceContext: options.sourceContext,
  });
}

export async function createSourceEvidenceDisplayItems(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  options: SourceEvidencePageDisplayOptions,
): Promise<ArchiveEvidenceItem[]> {
  const displayRanges = await createSourceEvidenceDisplayRanges(
    document,
    ranges,
    options,
  );

  return await Promise.all(
    displayRanges.map(
      async (range) =>
        await createSourceEvidenceItem(
          document,
          range.chapterId,
          range.startSentenceIndex,
          range.endSentenceIndex,
          options.context,
          range.score,
          {
            ...(range.ftsScore === undefined
              ? {}
              : { ftsScore: range.ftsScore }),
            ...(range.embeddingScore === undefined
              ? {}
              : { embeddingScore: range.embeddingScore }),
          },
        ),
    ),
  );
}

export async function createSourceEvidenceDisplayRanges(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  options: SourceEvidencePageDisplayOptions,
): Promise<SourceEvidenceRange[]> {
  const expanded = await createExpandedSourceEvidenceRanges(
    document,
    ranges,
    options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
    options.context,
  );

  return mergeSourceEvidenceRangesInInputOrder(expanded);
}

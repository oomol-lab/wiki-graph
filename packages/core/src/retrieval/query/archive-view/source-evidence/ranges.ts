import type {
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
} from "../../../../document/index.js";
import type { GraphNode } from "../../../../graph/reading.js";

import { getTextStreamIndex } from "../text-streams.js";
import type { EvidenceReadContext, SourceEvidenceRange } from "../types.js";

export function createNodeEvidenceRanges(
  node: Pick<GraphNode, "sentenceIds">,
): Array<{
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly startSentenceIndex: number;
}> {
  const ranges = new Map<string, [number, number]>();

  for (const [chapterId, sentenceIndex] of node.sentenceIds) {
    const key = `${chapterId}`;
    const current = ranges.get(key);

    if (current === undefined) {
      ranges.set(key, [sentenceIndex, sentenceIndex]);
    } else {
      ranges.set(key, [
        Math.min(current[0], sentenceIndex),
        Math.max(current[1], sentenceIndex),
      ]);
    }
  }

  return [...ranges.entries()].map(([key, [start, end]]) => {
    const chapterId = Number(key);
    return {
      chapterId,
      endSentenceIndex: end,
      startSentenceIndex: start,
    };
  });
}

export async function createMentionEvidenceRanges(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
): Promise<
  Array<{
    readonly chapterId: number;
    readonly endSentenceIndex: number;
    readonly startSentenceIndex: number;
  }>
> {
  return await Promise.all(
    mentions.map(async (mention) => {
      const startSentenceIndex =
        mention.sentenceIndex ??
        (await findSentenceIndexAtOffset(
          document,
          mention.chapterId,
          mention.rangeStart,
        ));
      const endSentenceIndex =
        mention.sentenceIndex ??
        (await findSentenceIndexAtOffset(
          document,
          mention.chapterId,
          Math.max(0, mention.rangeEnd - 1),
        ));

      return {
        chapterId: mention.chapterId,
        endSentenceIndex,
        startSentenceIndex,
      };
    }),
  );
}

export function createMentionLinkEvidenceRanges(
  _document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
): Array<{
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly startSentenceIndex: number;
}> {
  return links.flatMap((link) =>
    link.evidenceSentenceIds.map(([chapterId, sentenceIndex]) => ({
      chapterId,
      endSentenceIndex: sentenceIndex,
      startSentenceIndex: sentenceIndex,
    })),
  );
}

export function mergeSourceEvidenceRanges(
  ranges: readonly SourceEvidenceRange[],
): SourceEvidenceRange[] {
  const rangesBySource = new Map<
    string,
    Array<{
      readonly end: number;
      readonly score?: number;
      readonly start: number;
    }>
  >();

  for (const range of ranges) {
    const key = `${range.chapterId}`;
    const sourceRanges = rangesBySource.get(key) ?? [];

    sourceRanges.push({
      end: range.endSentenceIndex,
      ...(range.score === undefined ? {} : { score: range.score }),
      start: range.startSentenceIndex,
    });
    rangesBySource.set(key, sourceRanges);
  }

  return [...rangesBySource.entries()].flatMap(([key, ranges]) => {
    const chapterId = Number(key);

    return mergeEvidenceRanges(ranges).map(
      ({ end, score, start }) =>
        ({
          chapterId,
          endSentenceIndex: end,
          ...(score === undefined ? {} : { score }),
          startSentenceIndex: start,
        }) as const,
    );
  });
}

export function mergeSourceEvidenceRangesInInputOrder(
  ranges: readonly SourceEvidenceRange[],
): SourceEvidenceRange[] {
  const merged: SourceEvidenceRange[] = [];

  for (const range of ranges) {
    const overlappingIndexes = merged
      .map((existing, index) =>
        areMergeableSourceEvidenceRanges(existing, range) ? index : -1,
      )
      .filter((index) => index >= 0);

    if (overlappingIndexes.length === 0) {
      merged.push(range);
      continue;
    }

    const firstIndex = overlappingIndexes[0] ?? 0;
    const overlapping = overlappingIndexes.flatMap((index) => {
      const existing = merged[index];

      return existing === undefined ? [] : [existing];
    });
    const mergedRange = mergeSourceEvidenceRangeGroup([...overlapping, range]);

    merged[firstIndex] = mergedRange;
    for (const index of overlappingIndexes.slice(1).reverse()) {
      merged.splice(index, 1);
    }
  }

  return merged;
}

function areMergeableSourceEvidenceRanges(
  left: SourceEvidenceRange,
  right: SourceEvidenceRange,
): boolean {
  return (
    left.chapterId === right.chapterId &&
    right.startSentenceIndex <= left.endSentenceIndex + 1 &&
    left.startSentenceIndex <= right.endSentenceIndex + 1
  );
}

function mergeSourceEvidenceRangeGroup(
  ranges: readonly SourceEvidenceRange[],
): SourceEvidenceRange {
  const [first] = ranges;

  if (first === undefined) {
    throw new Error("Internal error: cannot merge empty evidence range group.");
  }

  const scores = ranges
    .map((range) => range.score)
    .filter((score): score is number => score !== undefined);

  return {
    chapterId: first.chapterId,
    endSentenceIndex: Math.max(
      ...ranges.map((range) => range.endSentenceIndex),
    ),
    ...(scores.length === 0 ? {} : { score: Math.max(...scores) }),
    startSentenceIndex: Math.min(
      ...ranges.map((range) => range.startSentenceIndex),
    ),
  };
}

export async function createExpandedSourceEvidenceRanges(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  sourceContext: number,
  context: EvidenceReadContext,
): Promise<SourceEvidenceRange[]> {
  const expanded = await Promise.all(
    ranges.map(async (range) => {
      if (sourceContext <= 0) {
        return range;
      }

      const sourceIndex = await getTextStreamIndex(
        document,
        range.chapterId,
        "source",
        context,
      );
      const lastSentenceIndex = Math.max(0, sourceIndex.sentences.length - 1);

      return {
        ...range,
        endSentenceIndex: clampInteger(
          range.endSentenceIndex + sourceContext,
          range.startSentenceIndex,
          lastSentenceIndex,
        ),
        startSentenceIndex: clampInteger(
          range.startSentenceIndex - sourceContext,
          0,
          lastSentenceIndex,
        ),
      };
    }),
  );

  return mergeSourceEvidenceRangesInInputOrder(expanded);
}

async function findSentenceIndexAtOffset(
  document: ReadonlyDocument,
  chapterId: number,
  offset: number,
): Promise<number> {
  const serial = document.getSerialFragments(chapterId);
  const sentences =
    serial.listSentences === undefined ? [] : await serial.listSentences();

  if (sentences.length === 0) {
    return 0;
  }
  let cursor = 0;

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];

    if (sentence === undefined) {
      continue;
    }

    const nextCursor = cursor + sentence.text.length;

    if (offset <= nextCursor) {
      return index;
    }

    cursor = nextCursor + 1;
  }

  return Math.max(0, sentences.length - 1);
}

function mergeEvidenceRanges(
  ranges: readonly {
    readonly end: number;
    readonly score?: number;
    readonly start: number;
  }[],
): readonly {
  readonly end: number;
  readonly score?: number;
  readonly start: number;
}[] {
  const sortedRanges = [...ranges]
    .map((range) => ({
      ...(range.score === undefined ? {} : { score: range.score }),
      end: Math.max(range.start, range.end),
      start: Math.min(range.start, range.end),
    }))
    .sort((left, right) =>
      left.start === right.start
        ? left.end - right.end
        : left.start - right.start,
    );
  const mergedRanges: Array<{
    end: number;
    score?: number;
    start: number;
  }> = [];

  for (const { end, score, start } of sortedRanges) {
    const last = mergedRanges.at(-1);

    if (last === undefined || start > last.end + 1) {
      mergedRanges.push({
        end,
        ...(score === undefined ? {} : { score }),
        start,
      });
    } else {
      last.end = Math.max(last.end, end);
      if (score !== undefined) {
        last.score = Math.max(last.score ?? score, score);
      }
    }
  }

  return mergedRanges;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

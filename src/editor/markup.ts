import {
  ChunkRetention,
  type ChunkImportance,
  type ChunkRecord,
  type FragmentRecord,
  type ReadonlySerialFragments,
} from "../document/index.js";
export async function formatClueAsBook(input: {
  chunks: readonly ChunkRecord[];
  serialFragments: ReadonlySerialFragments;
  fullMarkup?: boolean;
  wrapHighRetention?: boolean;
}): Promise<string> {
  return await formatChunksAsBook({
    chunks: input.chunks,
    segmentStartIndexes: await listSegmentStartIndexesCoveringChunks(
      input.chunks,
      input.serialFragments,
    ),
    serialFragments: input.serialFragments,
    ...(input.fullMarkup === undefined
      ? {}
      : {
          fullMarkup: input.fullMarkup,
        }),
    ...(input.wrapHighRetention === undefined
      ? {}
      : {
          wrapHighRetention: input.wrapHighRetention,
        }),
  });
}

export async function formatChunksAsBook(input: {
  chunks: readonly ChunkRecord[];
  segmentStartIndexes: readonly number[];
  serialFragments: ReadonlySerialFragments;
  fullMarkup?: boolean;
  wrapHighRetention?: boolean;
}): Promise<string> {
  if (input.segmentStartIndexes.length === 0) {
    return "";
  }

  const chunkCoverage = createChunkCoverage(input.chunks);
  const segmentStartIndexes = [...input.segmentStartIndexes].sort(
    compareNumber,
  );
  const allSegmentStartIndexes = [
    ...(await input.serialFragments.listFragmentIds()),
  ].sort(compareNumber);
  const fragments = await loadFragments(
    listRequiredSegmentStartIndexes(
      segmentStartIndexes,
      allSegmentStartIndexes,
    ),
    input.serialFragments,
  );
  const resultParts: string[] = [];

  for (let index = 0; index < segmentStartIndexes.length; index += 1) {
    const startSentenceIndex = segmentStartIndexes[index];

    if (startSentenceIndex === undefined) {
      continue;
    }

    const fragment = fragments[String(startSentenceIndex)];

    if (fragment === undefined) {
      continue;
    }

    if (index > 0) {
      const previousStartSentenceIndex = segmentStartIndexes[index - 1];

      if (
        previousStartSentenceIndex !== undefined &&
        startSentenceIndex > previousStartSentenceIndex
      ) {
        const skippedSummary = collectSkippedSummary({
          fragments,
          skippedStartIndexes: listSkippedSegmentStartIndexes(
            allSegmentStartIndexes,
            previousStartSentenceIndex,
            startSentenceIndex,
          ),
        });

        if (skippedSummary !== "") {
          resultParts.push(skippedSummary);
        }
      }
    }

    resultParts.push(
      buildFragmentMarkup({
        chunkCoverage,
        fragment,
        fullMarkup: input.fullMarkup ?? false,
        wrapHighRetention: input.wrapHighRetention ?? false,
      }),
    );
  }

  return resultParts.join("\n\n");
}

function buildFragmentMarkup(input: {
  chunkCoverage: Record<string, readonly ChunkRecord[] | undefined>;
  fragment: FragmentRecord;
  fullMarkup: boolean;
  wrapHighRetention: boolean;
}): string {
  const sentenceRanges: Array<{
    readonly endIndex: number;
    readonly startIndex: number;
    readonly chunkAttributes?: ChunkAttributes;
  }> = [];
  const { fragment } = input;
  let sentenceIndex = 0;

  while (sentenceIndex < fragment.sentences.length) {
    const sentence = fragment.sentences[sentenceIndex];

    if (sentence === undefined) {
      sentenceIndex += 1;
      continue;
    }

    const sentenceId = createSentenceKey(
      fragment.serialId,
      fragment.fragmentId + sentenceIndex,
    );
    const coveredChunks = input.chunkCoverage[sentenceId];

    if (coveredChunks === undefined) {
      sentenceRanges.push({
        endIndex: sentenceIndex + 1,
        startIndex: sentenceIndex,
      });
      sentenceIndex += 1;
      continue;
    }

    const chunkAttributes = mergeChunkAttributes(coveredChunks);
    let endIndex = sentenceIndex + 1;

    while (endIndex < fragment.sentences.length) {
      const nextSentenceId = createSentenceKey(
        fragment.serialId,
        fragment.fragmentId + endIndex,
      );
      const nextCoveredChunks = input.chunkCoverage[nextSentenceId];

      if (nextCoveredChunks === undefined) {
        break;
      }

      const nextAttributes = mergeChunkAttributes(nextCoveredChunks);

      if (nextAttributes.label !== chunkAttributes.label) {
        break;
      }

      endIndex += 1;
    }

    sentenceRanges.push({
      chunkAttributes,
      endIndex,
      startIndex: sentenceIndex,
    });
    sentenceIndex = endIndex;
  }

  const parts = sentenceRanges.map((range) =>
    renderSentenceRange({
      fragment,
      fullMarkup: input.fullMarkup,
      range,
      wrapHighRetention: input.wrapHighRetention,
    }),
  );

  return parts.join(" ");
}

function collectSkippedSummary(input: {
  fragments: Record<string, FragmentRecord | undefined>;
  skippedStartIndexes: readonly number[];
}): string {
  const summaries: string[] = [];

  for (const startSentenceIndex of input.skippedStartIndexes) {
    const summary =
      input.fragments[String(startSentenceIndex)]?.summary?.trim() ?? "";

    if (summary !== "") {
      summaries.push(summary);
    }
  }

  return summaries.join(" ");
}

function createChunkCoverage(
  chunks: readonly ChunkRecord[],
): Record<string, readonly ChunkRecord[] | undefined> {
  const coverage = Object.create(null) as Record<
    string,
    readonly ChunkRecord[] | undefined
  >;

  for (const chunk of chunks) {
    for (const sentenceId of chunk.sentenceIds) {
      const coverageKey = createSentenceKey(...sentenceId);
      const coveredChunks = coverage[coverageKey];

      coverage[coverageKey] =
        coveredChunks === undefined ? [chunk] : [...coveredChunks, chunk];
    }
  }

  return coverage;
}

function createSentenceKey(serialId: number, sentenceIndex: number): string {
  return `${serialId}:${sentenceIndex}`;
}

function listRequiredSegmentStartIndexes(
  selectedStartIndexes: readonly number[],
  allStartIndexes: readonly number[],
): number[] {
  const required = new Set(selectedStartIndexes);

  for (let index = 1; index < selectedStartIndexes.length; index += 1) {
    const previousStartIndex = selectedStartIndexes[index - 1];
    const nextStartIndex = selectedStartIndexes[index];

    if (previousStartIndex === undefined || nextStartIndex === undefined) {
      continue;
    }

    for (const skippedStartIndex of listSkippedSegmentStartIndexes(
      allStartIndexes,
      previousStartIndex,
      nextStartIndex,
    )) {
      required.add(skippedStartIndex);
    }
  }

  return [...required].sort(compareNumber);
}

function listSkippedSegmentStartIndexes(
  allStartIndexes: readonly number[],
  previousStartIndex: number,
  nextStartIndex: number,
): number[] {
  return allStartIndexes.filter(
    (startIndex) =>
      startIndex > previousStartIndex && startIndex < nextStartIndex,
  );
}

async function listSegmentStartIndexesCoveringChunks(
  chunks: readonly ChunkRecord[],
  serialFragments: ReadonlySerialFragments,
): Promise<number[]> {
  const allSegmentStartIndexes = [
    ...(await serialFragments.listFragmentIds()),
  ].sort(compareNumber);
  const startIndexRecord = Object.create(null) as Record<string, true>;
  const startIndexes: number[] = [];

  for (const chunk of chunks) {
    for (const sentenceId of chunk.sentenceIds) {
      const startSentenceIndex = findContainingSegmentStartIndex(
        allSegmentStartIndexes,
        sentenceId[1],
      );

      if (startSentenceIndex === undefined) {
        continue;
      }

      const startIndexKey = String(startSentenceIndex);

      if (startIndexRecord[startIndexKey] === true) {
        continue;
      }

      startIndexRecord[startIndexKey] = true;
      startIndexes.push(startSentenceIndex);
    }
  }

  startIndexes.sort(compareNumber);

  return startIndexes;
}

function findContainingSegmentStartIndex(
  segmentStartIndexes: readonly number[],
  sentenceIndex: number,
): number | undefined {
  let containingStartIndex: number | undefined;

  for (const startIndex of segmentStartIndexes) {
    if (startIndex > sentenceIndex) {
      break;
    }

    containingStartIndex = startIndex;
  }

  return containingStartIndex;
}

async function loadFragments(
  startSentenceIndexes: readonly number[],
  serialFragments: ReadonlySerialFragments,
): Promise<Record<string, FragmentRecord | undefined>> {
  const fragments = Object.create(null) as Record<
    string,
    FragmentRecord | undefined
  >;

  await Promise.all(
    startSentenceIndexes.map(async (startSentenceIndex) => {
      fragments[String(startSentenceIndex)] =
        await serialFragments.getFragment(startSentenceIndex);
    }),
  );

  return fragments;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

interface ChunkAttributes {
  readonly importance?: ChunkImportance;
  readonly label: string;
  readonly retention?: ChunkRetention;
}

function mergeChunkAttributes(
  chunksAtPosition: readonly ChunkRecord[],
): ChunkAttributes {
  const retentionOrder = createMetadataOrder({
    detailed: 3,
    focused: 2,
    relevant: 1,
    verbatim: 4,
  });
  const importanceOrder = createMetadataOrder({
    critical: 3,
    helpful: 1,
    important: 2,
  });
  let bestRetentionChunk = chunksAtPosition[0];
  let bestImportanceChunk = chunksAtPosition[0];

  for (const chunk of chunksAtPosition) {
    if (
      getMetadataRank(chunk.retention, retentionOrder) >
      getMetadataRank(bestRetentionChunk?.retention, retentionOrder)
    ) {
      bestRetentionChunk = chunk;
    }

    if (
      getMetadataRank(chunk.importance, importanceOrder) >
      getMetadataRank(bestImportanceChunk?.importance, importanceOrder)
    ) {
      bestImportanceChunk = chunk;
    }
  }

  const bestChunk =
    getMetadataRank(bestRetentionChunk?.retention, retentionOrder) >=
    getMetadataRank(bestImportanceChunk?.importance, importanceOrder)
      ? bestRetentionChunk
      : bestImportanceChunk;

  return {
    label: bestChunk?.label ?? "",
    ...(bestImportanceChunk?.importance === undefined
      ? {}
      : {
          importance: bestImportanceChunk.importance,
        }),
    ...(bestRetentionChunk?.retention === undefined
      ? {}
      : {
          retention: bestRetentionChunk.retention,
        }),
  };
}

function createMetadataOrder<TValue extends string>(
  values: Record<TValue, number>,
): Readonly<Record<TValue, number>> {
  return Object.freeze(values);
}

function getMetadataRank<TValue extends string>(
  value: TValue | undefined,
  order: Readonly<Record<TValue, number>>,
): number {
  if (value === undefined) {
    return 0;
  }

  return order[value] ?? 0;
}

function renderSentenceRange(input: {
  fragment: FragmentRecord;
  fullMarkup: boolean;
  range: {
    readonly endIndex: number;
    readonly startIndex: number;
    readonly chunkAttributes?: ChunkAttributes;
  };
  wrapHighRetention: boolean;
}): string {
  const textSegment = input.fragment.sentences
    .slice(input.range.startIndex, input.range.endIndex)
    .map((sentence) => sentence.text)
    .join(" ");
  const chunkAttributes = input.range.chunkAttributes;

  if (chunkAttributes === undefined) {
    return textSegment;
  }

  if (input.fullMarkup) {
    const attributes = [`label="${chunkAttributes.label}"`];

    if (chunkAttributes.retention !== undefined) {
      attributes.push(`retention="${chunkAttributes.retention}"`);
    }

    if (chunkAttributes.importance !== undefined) {
      attributes.push(`importance="${chunkAttributes.importance}"`);
    }

    return `<chunk ${attributes.join(" ")}>${textSegment}</chunk>`;
  }

  if (
    input.wrapHighRetention &&
    (chunkAttributes.retention === ChunkRetention.Verbatim ||
      chunkAttributes.retention === ChunkRetention.Detailed)
  ) {
    return `<chunk retention="${chunkAttributes.retention}">${textSegment}</chunk>`;
  }

  return textSegment;
}

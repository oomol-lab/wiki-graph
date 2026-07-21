import type {
  ChunkRecord,
  ReadingEdgeRecord,
  ReadonlySerialFragments,
} from "../../document/index.js";

export interface SegmentInfo {
  readonly startSentenceIndex: number;
  readonly wordsCount: number;
  readonly startIncision: number;
  readonly endIncision: number;
}

export async function computeNormalizedSegmentIncisions(input: {
  chunks: readonly ChunkRecord[];
  edges: readonly ReadingEdgeRecord[];
  fragments: ReadonlySerialFragments;
}): Promise<SegmentInfo[]> {
  const segmentWordsCounts = await loadSegmentWordsCounts(input.fragments);

  return normalizeIncisions(
    computeSegmentIncisions({
      chunks: input.chunks,
      edges: input.edges,
      segmentWordsCounts,
    }),
  );
}

async function loadSegmentWordsCounts(
  fragments: ReadonlySerialFragments,
): Promise<Readonly<Record<string, number>>> {
  const wordsCounts = createNumberRecord();
  const startSentenceIndexes = await fragments.listFragmentIds();

  for (const startSentenceIndex of startSentenceIndexes) {
    const segment = await fragments.getFragment(startSentenceIndex);

    wordsCounts[String(startSentenceIndex)] = segment.sentences.reduce(
      (total, sentence) => total + sentence.wordsCount,
      0,
    );
  }

  return wordsCounts;
}

function computeSegmentIncisions(input: {
  chunks: readonly ChunkRecord[];
  edges: readonly ReadingEdgeRecord[];
  segmentWordsCounts: Readonly<Record<string, number>>;
}): SegmentInfo[] {
  const startSentenceIndexes = Object.keys(input.segmentWordsCounts)
    .map(Number)
    .sort(compareNumber);
  const chunkIdsBySegmentStartIndex = createNumberListRecord();
  const chunkWeightsById = createNumberRecord();
  const edgesByChunkId = createReadingEdgeListRecord();

  for (const chunk of input.chunks) {
    const startSentenceIndex = findContainingSegmentStartIndex(
      startSentenceIndexes,
      chunk.sentenceId[1],
    );

    if (startSentenceIndex === undefined) {
      continue;
    }

    const segmentKey = String(startSentenceIndex);

    chunkWeightsById[String(chunk.id)] = chunk.weight;
    if (chunkIdsBySegmentStartIndex[segmentKey] === undefined) {
      chunkIdsBySegmentStartIndex[segmentKey] = [];
    }
    chunkIdsBySegmentStartIndex[segmentKey]?.push(chunk.id);
  }

  for (const edge of input.edges) {
    const fromKey = String(edge.fromId);
    const toKey = String(edge.toId);

    if (edgesByChunkId[fromKey] === undefined) {
      edgesByChunkId[fromKey] = [];
    }
    if (edgesByChunkId[toKey] === undefined) {
      edgesByChunkId[toKey] = [];
    }

    edgesByChunkId[fromKey]?.push(edge);
    edgesByChunkId[toKey]?.push(edge);
  }

  const chunksById = createChunkRecord();

  for (const chunk of input.chunks) {
    chunksById[String(chunk.id)] = chunk;
  }

  return startSentenceIndexes
    .filter(
      (startSentenceIndex) =>
        chunkIdsBySegmentStartIndex[String(startSentenceIndex)] !== undefined,
    )
    .map((startSentenceIndex) => {
      const chunkIds =
        chunkIdsBySegmentStartIndex[String(startSentenceIndex)] ?? [];
      let endIncision = 0;
      let startIncision = 0;

      for (const chunkId of chunkIds) {
        const chunkWeight = chunkWeightsById[String(chunkId)] ?? 0;
        const chunkEdges = edgesByChunkId[String(chunkId)] ?? [];
        const externalEdges = chunkEdges
          .map((edge) => ({
            otherChunkId: edge.fromId === chunkId ? edge.toId : edge.fromId,
            weight: edge.weight,
          }))
          .map((edge) => {
            const otherChunk = chunksById[String(edge.otherChunkId)];

            if (otherChunk === undefined) {
              return undefined;
            }

            return {
              otherSegmentStartIndex: findContainingSegmentStartIndex(
                startSentenceIndexes,
                otherChunk.sentenceId[1],
              ),
              weight: edge.weight,
            };
          })
          .filter(
            (
              edge,
            ): edge is {
              otherSegmentStartIndex: number;
              weight: number;
            } =>
              edge !== undefined &&
              edge.otherSegmentStartIndex !== undefined &&
              edge.otherSegmentStartIndex !== startSentenceIndex,
          );

        if (externalEdges.length === 0) {
          continue;
        }

        const totalExternalWeight = externalEdges.reduce(
          (total, edge) => total + edge.weight,
          0,
        );

        if (totalExternalWeight === 0) {
          continue;
        }

        for (const edge of externalEdges) {
          const halfWeight = (chunkWeight / totalExternalWeight) * edge.weight;

          if (edge.otherSegmentStartIndex < startSentenceIndex) {
            startIncision += halfWeight;
            continue;
          }

          endIncision += halfWeight;
        }
      }

      return {
        endIncision,
        startSentenceIndex,
        startIncision,
        wordsCount: input.segmentWordsCounts[String(startSentenceIndex)] ?? 0,
      };
    });
}

function findContainingSegmentStartIndex(
  startSentenceIndexes: readonly number[],
  sentenceIndex: number,
): number | undefined {
  let containingSegmentStartIndex: number | undefined;

  for (const startSentenceIndex of startSentenceIndexes) {
    if (startSentenceIndex > sentenceIndex) {
      break;
    }

    containingSegmentStartIndex = startSentenceIndex;
  }

  return containingSegmentStartIndex;
}

function normalizeIncisions(
  segmentInfos: readonly SegmentInfo[],
): SegmentInfo[] {
  const allIncisions = segmentInfos
    .flatMap((segmentInfo) => [
      segmentInfo.startIncision,
      segmentInfo.endIncision,
    ])
    .filter((incision) => incision > 0)
    .sort(compareNumber);

  if (allIncisions.length === 0) {
    return [...segmentInfos];
  }

  const thresholdIndex = Math.min(
    Math.floor(allIncisions.length * 0.98),
    allIncisions.length - 1,
  );
  const threshold = allIncisions[thresholdIndex] ?? 0;
  const normalValues = allIncisions.filter((incision) => incision < threshold);

  if (normalValues.length === 0) {
    return segmentInfos.map((segmentInfo) => ({
      ...segmentInfo,
      endIncision: segmentInfo.endIncision > 0 ? 10 : 0,
      startIncision: segmentInfo.startIncision > 0 ? 10 : 0,
    }));
  }

  const minValue = Math.min(...normalValues);
  const maxValue = Math.max(...normalValues);
  const minLog = minValue > 0 ? Math.log(minValue) : 0;
  const maxLog = maxValue > 0 ? Math.log(maxValue) : 0;
  const logRange = maxLog - minLog === 0 ? 1 : maxLog - minLog;

  return segmentInfos.map((segmentInfo) => ({
    ...segmentInfo,
    endIncision: normalizeIncision(segmentInfo.endIncision, {
      logRange,
      minLog,
      threshold,
    }),
    startIncision: normalizeIncision(segmentInfo.startIncision, {
      logRange,
      minLog,
      threshold,
    }),
  }));
}

function normalizeIncision(
  incision: number,
  input: {
    logRange: number;
    minLog: number;
    threshold: number;
  },
): number {
  if (incision === 0) {
    return 0;
  }

  if (incision >= input.threshold) {
    return 10;
  }

  const incisionLog = incision > 0 ? Math.log(incision) : input.minLog;

  return Math.max(
    1,
    Math.min(
      10,
      Math.round(1 + ((incisionLog - input.minLog) / input.logRange) * 9),
    ),
  );
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function createChunkRecord(): Record<string, ChunkRecord | undefined> {
  return Object.create(null) as Record<string, ChunkRecord | undefined>;
}

function createReadingEdgeListRecord(): Record<
  string,
  ReadingEdgeRecord[] | undefined
> {
  return Object.create(null) as Record<string, ReadingEdgeRecord[] | undefined>;
}

function createNumberListRecord(): Record<string, number[] | undefined> {
  return Object.create(null) as Record<string, number[] | undefined>;
}

function createNumberRecord(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

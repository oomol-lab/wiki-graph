import type {
  ChunkRecord,
  ReadingEdgeRecord,
  ReadonlySerialFragments,
} from "../document/index.js";

export interface FragmentInfo {
  readonly fragmentId: number;
  readonly wordsCount: number;
  readonly startIncision: number;
  readonly endIncision: number;
}

export async function computeNormalizedFragmentIncisions(input: {
  chunks: readonly ChunkRecord[];
  edges: readonly ReadingEdgeRecord[];
  fragments: ReadonlySerialFragments;
}): Promise<FragmentInfo[]> {
  const fragmentWordsCounts = await loadFragmentWordsCounts(input.fragments);

  return normalizeIncisions(
    computeFragmentIncisions({
      chunks: input.chunks,
      edges: input.edges,
      fragmentWordsCounts,
    }),
  );
}

async function loadFragmentWordsCounts(
  fragments: ReadonlySerialFragments,
): Promise<Readonly<Record<string, number>>> {
  const wordsCounts = createNumberRecord();
  const fragmentIds = await fragments.listFragmentIds();

  for (const fragmentId of fragmentIds) {
    const fragment = await fragments.getFragment(fragmentId);

    wordsCounts[String(fragmentId)] = fragment.sentences.reduce(
      (total, sentence) => total + sentence.wordsCount,
      0,
    );
  }

  return wordsCounts;
}

function computeFragmentIncisions(input: {
  chunks: readonly ChunkRecord[];
  edges: readonly ReadingEdgeRecord[];
  fragmentWordsCounts: Readonly<Record<string, number>>;
}): FragmentInfo[] {
  const fragmentIds = Object.keys(input.fragmentWordsCounts)
    .map(Number)
    .sort(compareNumber);
  const chunkIdsByFragmentId = createNumberListRecord();
  const chunkWeightsById = createNumberRecord();
  const edgesByChunkId = createReadingEdgeListRecord();

  for (const chunk of input.chunks) {
    const fragmentId = findContainingFragmentId(
      fragmentIds,
      chunk.sentenceId[1],
    );

    if (fragmentId === undefined) {
      continue;
    }

    const fragmentKey = String(fragmentId);

    chunkWeightsById[String(chunk.id)] = chunk.weight;
    if (chunkIdsByFragmentId[fragmentKey] === undefined) {
      chunkIdsByFragmentId[fragmentKey] = [];
    }
    chunkIdsByFragmentId[fragmentKey]?.push(chunk.id);
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

  return fragmentIds
    .filter(
      (fragmentId) => chunkIdsByFragmentId[String(fragmentId)] !== undefined,
    )
    .map((fragmentId) => {
      const chunkIds = chunkIdsByFragmentId[String(fragmentId)] ?? [];
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
              otherFragmentId: findContainingFragmentId(
                fragmentIds,
                otherChunk.sentenceId[1],
              ),
              weight: edge.weight,
            };
          })
          .filter(
            (
              edge,
            ): edge is {
              otherFragmentId: number;
              weight: number;
            } =>
              edge !== undefined &&
              edge.otherFragmentId !== undefined &&
              edge.otherFragmentId !== fragmentId,
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

          if (edge.otherFragmentId < fragmentId) {
            startIncision += halfWeight;
            continue;
          }

          endIncision += halfWeight;
        }
      }

      return {
        endIncision,
        fragmentId,
        startIncision,
        wordsCount: input.fragmentWordsCounts[String(fragmentId)] ?? 0,
      };
    });
}

function findContainingFragmentId(
  fragmentIds: readonly number[],
  sentenceIndex: number,
): number | undefined {
  let containingFragmentId: number | undefined;

  for (const fragmentId of fragmentIds) {
    if (fragmentId > sentenceIndex) {
      break;
    }

    containingFragmentId = fragmentId;
  }

  return containingFragmentId;
}

function normalizeIncisions(
  fragmentInfos: readonly FragmentInfo[],
): FragmentInfo[] {
  const allIncisions = fragmentInfos
    .flatMap((fragmentInfo) => [
      fragmentInfo.startIncision,
      fragmentInfo.endIncision,
    ])
    .filter((incision) => incision > 0)
    .sort(compareNumber);

  if (allIncisions.length === 0) {
    return [...fragmentInfos];
  }

  const thresholdIndex = Math.min(
    Math.floor(allIncisions.length * 0.98),
    allIncisions.length - 1,
  );
  const threshold = allIncisions[thresholdIndex] ?? 0;
  const normalValues = allIncisions.filter((incision) => incision < threshold);

  if (normalValues.length === 0) {
    return fragmentInfos.map((fragmentInfo) => ({
      ...fragmentInfo,
      endIncision: fragmentInfo.endIncision > 0 ? 10 : 0,
      startIncision: fragmentInfo.startIncision > 0 ? 10 : 0,
    }));
  }

  const minValue = Math.min(...normalValues);
  const maxValue = Math.max(...normalValues);
  const minLog = minValue > 0 ? Math.log(minValue) : 0;
  const maxLog = maxValue > 0 ? Math.log(maxValue) : 0;
  const logRange = maxLog - minLog === 0 ? 1 : maxLog - minLog;

  return fragmentInfos.map((fragmentInfo) => ({
    ...fragmentInfo,
    endIncision: normalizeIncision(fragmentInfo.endIncision, {
      logRange,
      minLog,
      threshold,
    }),
    startIncision: normalizeIncision(fragmentInfo.startIncision, {
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

import type { ChunkRecord, ReadingEdgeRecord } from "../document/index.js";
import { getReadingEdgeKey } from "./weights.js";

const ATTRIBUTE_BONUS_WEIGHT = 3;
const DEFAULT_LINK_STRENGTH_WEIGHT = 1;
const DEFAULT_SNAKE_WORDS_COUNT = 280;
const DECAY_FACTOR = 0.75;
const MIN_EDGE_WEIGHT = 0.1;

interface DetectorGraph {
  readonly chunksById: Readonly<Record<string, ChunkRecord | undefined>>;
  readonly edgeByKey: Readonly<Record<string, ReadingEdgeRecord | undefined>>;
  readonly fingerprintEdgeWeightsByKey: Readonly<Record<string, number>>;
  readonly incomingEdgesByChunkId: Readonly<
    Record<string, readonly ReadingEdgeRecord[] | undefined>
  >;
  readonly outgoingEdgesByChunkId: Readonly<
    Record<string, readonly ReadingEdgeRecord[] | undefined>
  >;
  readonly sortedChunkIds: readonly number[];
  readonly undirectedAdjacentChunkIdsByChunkId: Readonly<
    Record<string, readonly number[] | undefined>
  >;
}

interface MergeConfig {
  readonly enableBonus: boolean;
  readonly snakeWordsCount: number;
}

export function splitConnectedComponents(input: {
  chunkIds: readonly number[];
  edges: readonly ReadingEdgeRecord[];
}): number[][] {
  const sortedChunkIds = [...input.chunkIds].sort(compareNumber);
  const chunkIdRecord = createBooleanRecord();
  const adjacentChunkIdsByChunkId = createNumberListRecord();
  const visitedChunkIds = createBooleanRecord();
  const components: number[][] = [];

  for (const chunkId of sortedChunkIds) {
    chunkIdRecord[String(chunkId)] = true;
  }

  for (const edge of input.edges) {
    if (
      chunkIdRecord[String(edge.fromId)] !== true ||
      chunkIdRecord[String(edge.toId)] !== true
    ) {
      continue;
    }

    attachChunkAdjacency(adjacentChunkIdsByChunkId, edge.fromId, edge.toId);
    attachChunkAdjacency(adjacentChunkIdsByChunkId, edge.toId, edge.fromId);
  }

  for (const chunkId of sortedChunkIds) {
    if (visitedChunkIds[String(chunkId)] === true) {
      continue;
    }

    const stack = [chunkId];
    const component: number[] = [];
    visitedChunkIds[String(chunkId)] = true;

    while (stack.length > 0) {
      const currentChunkId = stack.pop();

      if (currentChunkId === undefined) {
        continue;
      }

      component.push(currentChunkId);

      for (const nextChunkId of adjacentChunkIdsByChunkId[
        String(currentChunkId)
      ] ?? []) {
        if (visitedChunkIds[String(nextChunkId)] === true) {
          continue;
        }

        visitedChunkIds[String(nextChunkId)] = true;
        stack.push(nextChunkId);
      }
    }

    component.sort(compareNumber);
    components.push(component);
  }

  components.sort((left, right) => {
    const leftMinChunkId = left[0] ?? Number.POSITIVE_INFINITY;
    const rightMinChunkId = right[0] ?? Number.POSITIVE_INFINITY;

    return leftMinChunkId - rightMinChunkId;
  });

  return components;
}

export function detectSnakesInComponent(input: {
  chunks: readonly ChunkRecord[];
  edges: readonly ReadingEdgeRecord[];
  snakeWordsCount?: number;
}): number[][] {
  if (input.chunks.length === 0) {
    return [];
  }

  const graph = createDetectorGraph(input.chunks, input.edges);

  if (!isWeaklyConnected(graph)) {
    throw new Error(
      "Snake detector requires a weakly connected component input",
    );
  }

  const snakeWordsCount = input.snakeWordsCount ?? DEFAULT_SNAKE_WORDS_COUNT;
  const totalWordsCount = input.chunks.reduce((sum, chunk) => {
    return sum + chunk.wordsCount;
  }, 0);

  if (totalWordsCount <= snakeWordsCount) {
    return [
      [...input.chunks].sort(compareChunkBySentence).map((chunk) => chunk.id),
    ];
  }

  const fingerprints = computeAllFingerprints(graph);

  validateFingerprints(fingerprints);

  const phaseOneClusters = greedyMerge(
    graph,
    fingerprints,
    {
      enableBonus: true,
      snakeWordsCount,
    },
    undefined,
  );
  const phaseTwoClusters = greedyMerge(
    graph,
    fingerprints,
    {
      enableBonus: false,
      snakeWordsCount,
    },
    phaseOneClusters,
  );

  return [...phaseTwoClusters.values()].map((cluster) =>
    [...cluster].sort((leftId, rightId) => {
      const leftChunk = graph.chunksById[String(leftId)];
      const rightChunk = graph.chunksById[String(rightId)];

      if (leftChunk === undefined || rightChunk === undefined) {
        return leftId - rightId;
      }

      return compareChunkBySentence(leftChunk, rightChunk);
    }),
  );
}

function attachChunkAdjacency(
  adjacentChunkIdsByChunkId: Record<string, number[] | undefined>,
  fromId: number,
  toId: number,
): void {
  const existingAdjacentChunkIds =
    adjacentChunkIdsByChunkId[String(fromId)] ?? [];

  if (existingAdjacentChunkIds.includes(toId)) {
    return;
  }

  adjacentChunkIdsByChunkId[String(fromId)] = [
    ...existingAdjacentChunkIds,
    toId,
  ];
}

function clustersConnected(
  graph: DetectorGraph,
  leftCluster: readonly number[],
  rightCluster: readonly number[],
): boolean {
  for (const leftChunkId of leftCluster) {
    for (const rightChunkId of rightCluster) {
      if (
        graph.edgeByKey[getReadingEdgeKey(leftChunkId, rightChunkId)] !==
          undefined ||
        graph.edgeByKey[getReadingEdgeKey(rightChunkId, leftChunkId)] !==
          undefined
      ) {
        return true;
      }
    }
  }

  return false;
}

function compareChunkBySentence(left: ChunkRecord, right: ChunkRecord): number {
  const [leftSerialId, leftSentenceIndex] = left.sentenceId;
  const [rightSerialId, rightSentenceIndex] = right.sentenceId;

  if (leftSerialId !== rightSerialId) {
    return leftSerialId - rightSerialId;
  }

  if (leftSentenceIndex !== rightSentenceIndex) {
    return leftSentenceIndex - rightSentenceIndex;
  }

  return left.id - right.id;
}

function compareEdgeQueueEntry(
  left: EdgeQueueEntry,
  right: EdgeQueueEntry,
): number {
  if (left.value !== right.value) {
    return right.value - left.value;
  }

  if (left.leftClusterId !== right.leftClusterId) {
    return left.leftClusterId - right.leftClusterId;
  }

  return left.rightClusterId - right.rightClusterId;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function computeAllFingerprints(
  graph: DetectorGraph,
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const fingerprints = createNumberMatrixRecord();

  for (const startChunkId of graph.sortedChunkIds) {
    const concentrations = createNumberRecord();
    let currentLayer = [startChunkId];
    const visitedChunkIds = createBooleanRecord();

    concentrations[String(startChunkId)] = 1;
    visitedChunkIds[String(startChunkId)] = true;

    while (currentLayer.length > 0) {
      const nextLayerConcentrations = createNumberRecord();

      for (const currentChunkId of currentLayer) {
        const currentConcentration =
          concentrations[String(currentChunkId)] ?? 0;
        let totalWeight = 0;
        const neighbors: Array<readonly [number, number]> = [];

        for (const edge of graph.incomingEdgesByChunkId[
          String(currentChunkId)
        ] ?? []) {
          if (visitedChunkIds[String(edge.fromId)] === true) {
            continue;
          }

          const weight =
            graph.fingerprintEdgeWeightsByKey[
              getReadingEdgeKey(edge.fromId, currentChunkId)
            ] ??
            graph.fingerprintEdgeWeightsByKey[
              getReadingEdgeKey(currentChunkId, edge.fromId)
            ] ??
            DEFAULT_LINK_STRENGTH_WEIGHT;

          neighbors.push([edge.fromId, weight]);
          totalWeight += weight;
        }

        for (const edge of graph.outgoingEdgesByChunkId[
          String(currentChunkId)
        ] ?? []) {
          if (visitedChunkIds[String(edge.toId)] === true) {
            continue;
          }

          const weight =
            graph.fingerprintEdgeWeightsByKey[
              getReadingEdgeKey(currentChunkId, edge.toId)
            ] ??
            graph.fingerprintEdgeWeightsByKey[
              getReadingEdgeKey(edge.toId, currentChunkId)
            ] ??
            DEFAULT_LINK_STRENGTH_WEIGHT;

          neighbors.push([edge.toId, weight]);
          totalWeight += weight;
        }

        if (totalWeight <= 0) {
          continue;
        }

        for (const [neighborChunkId, weight] of neighbors) {
          const contribution =
            currentConcentration * (weight / totalWeight) * DECAY_FACTOR;

          nextLayerConcentrations[String(neighborChunkId)] =
            (nextLayerConcentrations[String(neighborChunkId)] ?? 0) +
            contribution;
        }
      }

      currentLayer = Object.keys(nextLayerConcentrations).map(Number);

      for (const nextChunkId of currentLayer) {
        concentrations[String(nextChunkId)] =
          nextLayerConcentrations[String(nextChunkId)] ?? 0;
        visitedChunkIds[String(nextChunkId)] = true;
      }
    }

    const totalConcentration = Object.values(concentrations).reduce(
      (sum, concentration) => sum + concentration,
      0,
    );

    if (totalConcentration > 0) {
      for (const chunkId of Object.keys(concentrations)) {
        concentrations[chunkId] =
          (concentrations[chunkId] ?? 0) / totalConcentration;
      }
    }

    fingerprints[String(startChunkId)] = concentrations;
  }

  return fingerprints;
}

function computeClusterWordsCount(
  graph: DetectorGraph,
  cluster: readonly number[],
): number {
  return cluster.reduce((sum, chunkId) => {
    return sum + (graph.chunksById[String(chunkId)]?.wordsCount ?? 0);
  }, 0);
}

function computeMergeValue(
  graph: DetectorGraph,
  leftCluster: readonly number[],
  rightCluster: readonly number[],
  fingerprints: Readonly<Record<string, Readonly<Record<string, number>>>>,
): number {
  let edgeCount = 0;
  let minValue = Number.POSITIVE_INFINITY;

  for (const leftChunkId of leftCluster) {
    for (const rightChunkId of rightCluster) {
      const edge =
        graph.edgeByKey[getReadingEdgeKey(leftChunkId, rightChunkId)] ??
        graph.edgeByKey[getReadingEdgeKey(rightChunkId, leftChunkId)];

      if (edge === undefined) {
        continue;
      }

      edgeCount += 1;

      const leftFingerprint = fingerprints[String(leftChunkId)] ?? {};
      const rightFingerprint = fingerprints[String(rightChunkId)] ?? {};
      let squaredSum = 0;

      for (const targetChunkId of Object.keys(leftFingerprint)) {
        const diff =
          (leftFingerprint[targetChunkId] ?? 0) -
          (rightFingerprint[targetChunkId] ?? 0);

        squaredSum += diff * diff;
      }

      let deltaValue = getLinkStrengthWeight(edge.strength);
      const leftChunk = graph.chunksById[String(leftChunkId)];
      const rightChunk = graph.chunksById[String(rightChunkId)];

      if (
        leftChunk?.retention !== undefined &&
        rightChunk?.retention !== undefined
      ) {
        deltaValue += ATTRIBUTE_BONUS_WEIGHT;
      }
      if (
        leftChunk?.importance !== undefined &&
        rightChunk?.importance !== undefined
      ) {
        deltaValue += ATTRIBUTE_BONUS_WEIGHT;
      }

      const distance = Math.sqrt(squaredSum);
      const value = (1 - distance / 2) * deltaValue;

      minValue = Math.min(minValue, value);
    }
  }

  if (edgeCount === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return minValue;
}

function createBooleanRecord(): Record<string, boolean | undefined> {
  return Object.create(null) as Record<string, boolean | undefined>;
}

function createDetectorGraph(
  chunks: readonly ChunkRecord[],
  edges: readonly ReadingEdgeRecord[],
): DetectorGraph {
  const chunksById = createChunkRecord();
  const edgeByKey = createEdgeRecord();
  const incomingEdgesByChunkId = createReadingEdgeListRecord();
  const outgoingEdgesByChunkId = createReadingEdgeListRecord();
  const sortedChunkIds = [...chunks]
    .map((chunk) => chunk.id)
    .sort(compareNumber);
  const undirectedAdjacentChunkIdsByChunkId = createNumberListRecord();

  for (const chunk of chunks) {
    chunksById[String(chunk.id)] = chunk;
  }

  for (const edge of edges) {
    if (
      chunksById[String(edge.fromId)] === undefined ||
      chunksById[String(edge.toId)] === undefined
    ) {
      continue;
    }

    const edgeKey = getReadingEdgeKey(edge.fromId, edge.toId);

    edgeByKey[edgeKey] = edge;
    if (incomingEdgesByChunkId[String(edge.toId)] === undefined) {
      incomingEdgesByChunkId[String(edge.toId)] = [];
    }
    if (outgoingEdgesByChunkId[String(edge.fromId)] === undefined) {
      outgoingEdgesByChunkId[String(edge.fromId)] = [];
    }

    incomingEdgesByChunkId[String(edge.toId)]?.push(edge);
    outgoingEdgesByChunkId[String(edge.fromId)]?.push(edge);
    attachChunkAdjacency(
      undirectedAdjacentChunkIdsByChunkId,
      edge.fromId,
      edge.toId,
    );
    attachChunkAdjacency(
      undirectedAdjacentChunkIdsByChunkId,
      edge.toId,
      edge.fromId,
    );
  }

  return {
    chunksById,
    edgeByKey,
    fingerprintEdgeWeightsByKey: computeFingerprintEdgeWeights(
      chunksById,
      edges,
    ),
    incomingEdgesByChunkId,
    outgoingEdgesByChunkId,
    sortedChunkIds,
    undirectedAdjacentChunkIdsByChunkId,
  };
}

function createChunkRecord(): Record<string, ChunkRecord | undefined> {
  return Object.create(null) as Record<string, ChunkRecord | undefined>;
}

function createEdgeQueueEntry(
  leftClusterId: number,
  rightClusterId: number,
  value: number,
): EdgeQueueEntry {
  return {
    leftClusterId,
    rightClusterId,
    value,
  };
}

function createEdgeRecord(): Record<string, ReadingEdgeRecord | undefined> {
  return Object.create(null) as Record<string, ReadingEdgeRecord | undefined>;
}

function createReadingEdgeListRecord(): Record<
  string,
  ReadingEdgeRecord[] | undefined
> {
  return Object.create(null) as Record<string, ReadingEdgeRecord[] | undefined>;
}

function createNumberMatrixRecord(): Record<string, Record<string, number>> {
  return Object.create(null) as Record<string, Record<string, number>>;
}

function createNumberListRecord(): Record<string, number[] | undefined> {
  return Object.create(null) as Record<string, number[] | undefined>;
}

function createNumberRecord(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

function createOptionalNumberRecord(): Record<string, number | undefined> {
  return Object.create(null) as Record<string, number | undefined>;
}

function getClusterPairKey(
  leftClusterId: number,
  rightClusterId: number,
): string {
  return leftClusterId < rightClusterId
    ? getReadingEdgeKey(leftClusterId, rightClusterId)
    : getReadingEdgeKey(rightClusterId, leftClusterId);
}

function getLinkStrengthWeight(strength: string | undefined): number {
  switch (strength) {
    case "critical":
      return 9;
    case "important":
      return 3;
    case "helpful":
      return 1;
    default:
      return DEFAULT_LINK_STRENGTH_WEIGHT;
  }
}

function greedyMerge(
  graph: DetectorGraph,
  fingerprints: Readonly<Record<string, Readonly<Record<string, number>>>>,
  config: MergeConfig,
  initialClusters: ReadonlyMap<number, readonly number[]> | undefined,
): Map<number, number[]> {
  const clusters =
    initialClusters === undefined
      ? new Map<number, number[]>(
          graph.sortedChunkIds.map((chunkId) => [chunkId, [chunkId]]),
        )
      : new Map(
          [...initialClusters.entries()].map(([clusterId, chunkIds]) => [
            clusterId,
            [...chunkIds],
          ]),
        );
  const nodeToCluster = createOptionalNumberRecord();
  const edgeQueue: EdgeQueueEntry[] = [];
  const queuedClusterPairs = createBooleanRecord();

  for (const [clusterId, chunkIds] of clusters.entries()) {
    for (const chunkId of chunkIds) {
      nodeToCluster[String(chunkId)] = clusterId;
    }
  }

  for (const leftClusterId of clusters.keys()) {
    for (const rightClusterId of clusters.keys()) {
      if (leftClusterId >= rightClusterId) {
        continue;
      }

      const leftCluster = clusters.get(leftClusterId);
      const rightCluster = clusters.get(rightClusterId);

      if (leftCluster === undefined || rightCluster === undefined) {
        continue;
      }
      if (!clustersConnected(graph, leftCluster, rightCluster)) {
        continue;
      }

      edgeQueue.push(
        createEdgeQueueEntry(
          leftClusterId,
          rightClusterId,
          computeMergeValue(graph, leftCluster, rightCluster, fingerprints),
        ),
      );
      queuedClusterPairs[getClusterPairKey(leftClusterId, rightClusterId)] =
        true;
    }
  }

  while (edgeQueue.length > 0) {
    edgeQueue.sort(compareEdgeQueueEntry);

    const nextEntry = edgeQueue.shift();

    if (nextEntry === undefined) {
      continue;
    }

    const currentLeftClusterId = nodeToCluster[String(nextEntry.leftClusterId)];
    const currentRightClusterId =
      nodeToCluster[String(nextEntry.rightClusterId)];

    if (
      currentLeftClusterId === undefined ||
      currentRightClusterId === undefined ||
      currentLeftClusterId === currentRightClusterId
    ) {
      continue;
    }

    const leftCluster = clusters.get(currentLeftClusterId);
    const rightCluster = clusters.get(currentRightClusterId);

    if (leftCluster === undefined || rightCluster === undefined) {
      continue;
    }
    if (!clustersConnected(graph, leftCluster, rightCluster)) {
      continue;
    }

    if (
      config.enableBonus &&
      leftCluster.length >= 2 &&
      rightCluster.length >= 2
    ) {
      continue;
    }

    if (
      computeClusterWordsCount(graph, leftCluster) +
        computeClusterWordsCount(graph, rightCluster) >
      config.snakeWordsCount
    ) {
      continue;
    }

    leftCluster.push(...rightCluster);
    clusters.delete(currentRightClusterId);

    for (const chunkId of rightCluster) {
      nodeToCluster[String(chunkId)] = currentLeftClusterId;
    }

    const neighborChunkIds = new Set<number>();

    for (const chunkId of leftCluster) {
      for (const neighborChunkId of graph.undirectedAdjacentChunkIdsByChunkId[
        String(chunkId)
      ] ?? []) {
        neighborChunkIds.add(neighborChunkId);
      }
    }

    for (const neighborChunkId of neighborChunkIds) {
      const neighborClusterId = nodeToCluster[String(neighborChunkId)];

      if (
        neighborClusterId === undefined ||
        neighborClusterId === currentLeftClusterId
      ) {
        continue;
      }

      const neighborCluster = clusters.get(neighborClusterId);

      if (neighborCluster === undefined) {
        continue;
      }

      const clusterPairKey = getClusterPairKey(
        currentLeftClusterId,
        neighborClusterId,
      );

      if (queuedClusterPairs[clusterPairKey] === true) {
        continue;
      }

      edgeQueue.push(
        createEdgeQueueEntry(
          Math.min(currentLeftClusterId, neighborClusterId),
          Math.max(currentLeftClusterId, neighborClusterId),
          computeMergeValue(graph, leftCluster, neighborCluster, fingerprints),
        ),
      );
      queuedClusterPairs[clusterPairKey] = true;
    }
  }

  return clusters;
}

function isWeaklyConnected(graph: DetectorGraph): boolean {
  const firstChunkId = graph.sortedChunkIds[0];

  if (firstChunkId === undefined) {
    return true;
  }

  const visitedChunkIds = createBooleanRecord();
  const stack = [firstChunkId];

  visitedChunkIds[String(firstChunkId)] = true;

  while (stack.length > 0) {
    const currentChunkId = stack.pop();

    if (currentChunkId === undefined) {
      continue;
    }

    for (const nextChunkId of graph.undirectedAdjacentChunkIdsByChunkId[
      String(currentChunkId)
    ] ?? []) {
      if (visitedChunkIds[String(nextChunkId)] === true) {
        continue;
      }

      visitedChunkIds[String(nextChunkId)] = true;
      stack.push(nextChunkId);
    }
  }

  return graph.sortedChunkIds.every(
    (chunkId) => visitedChunkIds[String(chunkId)] === true,
  );
}

function validateFingerprints(
  fingerprints: Readonly<Record<string, Readonly<Record<string, number>>>>,
): void {
  const firstChunkId = Object.keys(fingerprints)[0];

  if (firstChunkId === undefined) {
    return;
  }

  const referenceChunkIds = Object.keys(
    fingerprints[firstChunkId] ?? {},
  ).sort();

  for (const [chunkId, fingerprint] of Object.entries(fingerprints)) {
    const fingerprintChunkIds = Object.keys(fingerprint).sort();

    if (
      fingerprintChunkIds.length !== referenceChunkIds.length ||
      fingerprintChunkIds.some(
        (targetChunkId, index) => targetChunkId !== referenceChunkIds[index],
      )
    ) {
      throw new Error(`Fingerprint structure mismatch for chunk ${chunkId}`);
    }
  }
}

function computeFingerprintEdgeWeights(
  chunksById: Readonly<Record<string, ChunkRecord | undefined>>,
  edges: readonly ReadingEdgeRecord[],
): Readonly<Record<string, number>> {
  const totalStrengthsByChunkId = createNumberRecord();

  for (const edge of edges) {
    if (
      chunksById[String(edge.fromId)] === undefined ||
      chunksById[String(edge.toId)] === undefined
    ) {
      continue;
    }

    const strengthWeight = getLinkStrengthWeight(edge.strength);

    totalStrengthsByChunkId[String(edge.fromId)] =
      (totalStrengthsByChunkId[String(edge.fromId)] ?? 0) + strengthWeight;
    totalStrengthsByChunkId[String(edge.toId)] =
      (totalStrengthsByChunkId[String(edge.toId)] ?? 0) + strengthWeight;
  }

  const edgeWeightsByKey = createNumberRecord();

  for (const edge of edges) {
    const fromChunk = chunksById[String(edge.fromId)];
    const toChunk = chunksById[String(edge.toId)];

    if (fromChunk === undefined || toChunk === undefined) {
      continue;
    }

    const strengthWeight = getLinkStrengthWeight(edge.strength);
    const fromTotalStrength = totalStrengthsByChunkId[String(edge.fromId)] ?? 0;
    const toTotalStrength = totalStrengthsByChunkId[String(edge.toId)] ?? 0;
    const fromHalfWeight =
      fromTotalStrength === 0
        ? 0
        : fromChunk.weight * (strengthWeight / fromTotalStrength);
    const toHalfWeight =
      toTotalStrength === 0
        ? 0
        : toChunk.weight * (strengthWeight / toTotalStrength);
    const finalWeight = Math.max(
      fromHalfWeight + toHalfWeight,
      MIN_EDGE_WEIGHT,
    );

    edgeWeightsByKey[getReadingEdgeKey(edge.fromId, edge.toId)] = finalWeight;
    edgeWeightsByKey[getReadingEdgeKey(edge.toId, edge.fromId)] = finalWeight;
  }

  return edgeWeightsByKey;
}

interface EdgeQueueEntry {
  readonly leftClusterId: number;
  readonly rightClusterId: number;
  readonly value: number;
}

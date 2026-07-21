import { getReadingEdgeKey } from "../weights.js";
import { ATTRIBUTE_BONUS_WEIGHT } from "./constants.js";
import { compareEdgeQueueEntry } from "./compare.js";
import { createBooleanRecord, createOptionalNumberRecord } from "./records.js";
import type {
  DetectorGraph,
  EdgeQueueEntry,
  Fingerprints,
  MergeConfig,
} from "./types.js";
import { getLinkStrengthWeight } from "./weights.js";

export function greedyMerge(
  graph: DetectorGraph,
  fingerprints: Fingerprints,
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
  fingerprints: Fingerprints,
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

function getClusterPairKey(
  leftClusterId: number,
  rightClusterId: number,
): string {
  return leftClusterId < rightClusterId
    ? getReadingEdgeKey(leftClusterId, rightClusterId)
    : getReadingEdgeKey(rightClusterId, leftClusterId);
}

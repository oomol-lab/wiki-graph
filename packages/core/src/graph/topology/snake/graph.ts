import type {
  ChunkRecord,
  ReadingEdgeRecord,
} from "../../../document/index.js";
import { getReadingEdgeKey } from "../weights.js";
import { MIN_EDGE_WEIGHT } from "./constants.js";
import { compareNumber } from "./compare.js";
import {
  createChunkRecord,
  createEdgeRecord,
  createNumberListRecord,
  createNumberRecord,
  createReadingEdgeListRecord,
} from "./records.js";
import type { DetectorGraph } from "./types.js";
import { getLinkStrengthWeight } from "./weights.js";

export function attachChunkAdjacency(
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

export function createDetectorGraph(
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

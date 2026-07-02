import type { ChunkRecord, ReadingEdgeRecord } from "../document/index.js";
import { getReadingEdgeKey } from "./weights.js";

export interface SnakeGraphEdge {
  readonly fromSnakeIndex: number;
  readonly toSnakeIndex: number;
  readonly weight: number;
}

export function buildSnakeGraph(input: {
  chunksById: Readonly<Record<string, ChunkRecord | undefined>>;
  edges: readonly ReadingEdgeRecord[];
  snakes: readonly (readonly number[])[];
}): SnakeGraphEdge[] {
  const chunkIdToSnakeIndex = createOptionalNumberRecord();
  const interSnakeWeightByKey = createNumberRecord();

  for (const [snakeIndex, snakeChunkIds] of input.snakes.entries()) {
    for (const chunkId of snakeChunkIds) {
      chunkIdToSnakeIndex[String(chunkId)] = snakeIndex;
    }
  }

  for (const edge of input.edges) {
    const fromSnakeIndex = chunkIdToSnakeIndex[String(edge.fromId)];
    const toSnakeIndex = chunkIdToSnakeIndex[String(edge.toId)];

    if (
      fromSnakeIndex === undefined ||
      toSnakeIndex === undefined ||
      fromSnakeIndex === toSnakeIndex
    ) {
      continue;
    }

    const edgeKey = getReadingEdgeKey(fromSnakeIndex, toSnakeIndex);

    interSnakeWeightByKey[edgeKey] =
      (interSnakeWeightByKey[edgeKey] ?? 0) + edge.weight;
  }

  const normalizedSnakeWeightByKey = createNumberRecord();

  for (const [edgeKey, weight] of Object.entries(interSnakeWeightByKey)) {
    const [fromSnakeIndexText = "", toSnakeIndexText = ""] = edgeKey.split(":");
    const fromSnakeIndex = Number(fromSnakeIndexText);
    const toSnakeIndex = Number(toSnakeIndexText);
    const fromSnakeStartChunkId = input.snakes[fromSnakeIndex]?.[0];
    const toSnakeStartChunkId = input.snakes[toSnakeIndex]?.[0];

    if (
      fromSnakeStartChunkId === undefined ||
      toSnakeStartChunkId === undefined
    ) {
      continue;
    }

    const fromChunk = input.chunksById[String(fromSnakeStartChunkId)];
    const toChunk = input.chunksById[String(toSnakeStartChunkId)];

    if (fromChunk === undefined || toChunk === undefined) {
      continue;
    }

    const normalizedEdgeKey =
      compareChunkBySentence(fromChunk, toChunk) < 0
        ? getReadingEdgeKey(fromSnakeIndex, toSnakeIndex)
        : getReadingEdgeKey(toSnakeIndex, fromSnakeIndex);

    normalizedSnakeWeightByKey[normalizedEdgeKey] =
      (normalizedSnakeWeightByKey[normalizedEdgeKey] ?? 0) + weight;
  }

  return Object.keys(normalizedSnakeWeightByKey)
    .sort(compareEdgeKey)
    .map((edgeKey) => {
      const [fromSnakeIndexText = "", toSnakeIndexText = ""] =
        edgeKey.split(":");

      return {
        fromSnakeIndex: Number(fromSnakeIndexText),
        toSnakeIndex: Number(toSnakeIndexText),
        weight: normalizedSnakeWeightByKey[edgeKey] ?? 0,
      };
    });
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

function compareEdgeKey(left: string, right: string): number {
  const [leftFromIdText = "", leftToIdText = ""] = left.split(":");
  const [rightFromIdText = "", rightToIdText = ""] = right.split(":");
  const leftFromId = Number(leftFromIdText);
  const rightFromId = Number(rightFromIdText);

  if (leftFromId !== rightFromId) {
    return leftFromId - rightFromId;
  }

  return Number(leftToIdText) - Number(rightToIdText);
}

function createNumberRecord(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

function createOptionalNumberRecord(): Record<string, number | undefined> {
  return Object.create(null) as Record<string, number | undefined>;
}

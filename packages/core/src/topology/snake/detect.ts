import type { ChunkRecord, ReadingEdgeRecord } from "../../document/index.js";
import { isWeaklyConnected } from "./components.js";
import { DEFAULT_SNAKE_WORDS_COUNT } from "./constants.js";
import { compareChunkBySentence } from "./compare.js";
import {
  computeAllFingerprints,
  validateFingerprints,
} from "./fingerprints.js";
import { createDetectorGraph } from "./graph.js";
import { greedyMerge } from "./merge.js";

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

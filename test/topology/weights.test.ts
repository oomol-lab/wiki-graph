import { describe, expect, it } from "vitest";

import {
  ChunkImportance,
  ChunkRetention,
} from "../../packages/core/src/document/index.js";
import {
  computeChunkWeights,
  computeReadingEdgeWeights,
  getReadingEdgeKey,
} from "../../packages/core/src/graph/topology/weights.js";

describe("topology/weights", () => {
  it("computes chunk weights from retention and importance", () => {
    const chunkWeights = computeChunkWeights([
      {
        content: "alpha",
        generation: 0,
        id: 1,
        importance: ChunkImportance.Critical,
        label: "alpha",
        sentenceId: [1, 0],
        sentenceIds: [[1, 0]],
        retention: ChunkRetention.Verbatim,
        wordsCount: 8,
        weight: 0,
      },
      {
        content: "beta",
        generation: 0,
        id: 2,
        importance: ChunkImportance.Helpful,
        label: "beta",
        sentenceId: [1, 1],
        sentenceIds: [[1, 1]],
        retention: ChunkRetention.Relevant,
        wordsCount: 5,
        weight: 0,
      },
    ]);

    expect(chunkWeights["1"]).toBe(36);
    expect(chunkWeights["2"]).toBe(2);
  });

  it("distributes edge weights by endpoint strength", () => {
    const edgeWeights = computeReadingEdgeWeights({
      chunkWeights: {
        "1": 10,
        "2": 6,
        "3": 4,
      },
      edges: [
        {
          fromId: 1,
          strength: "critical",
          toId: 2,
          weight: 0,
        },
        {
          fromId: 1,
          toId: 3,
          weight: 0,
        },
      ],
    });

    expect(edgeWeights[getReadingEdgeKey(1, 2)] ?? 0).toBeGreaterThan(
      edgeWeights[getReadingEdgeKey(1, 3)] ?? 0,
    );
    expect(edgeWeights[getReadingEdgeKey(1, 3)] ?? 0).toBeGreaterThanOrEqual(
      0.1,
    );
  });
});

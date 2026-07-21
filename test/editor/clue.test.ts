import { describe, expect, it } from "vitest";

import type { ReadonlyDocument } from "../../packages/core/src/document/index.js";
import type {
  ChunkRecord,
  SnakeRecord,
} from "../../packages/core/src/document/types.js";
import { extractCluesFromDocument } from "../../packages/core/src/text/editor/clue.js";

describe("editor/clue", () => {
  it("extracts and normalizes clues without merging when below the limit", async () => {
    const document = createClueDocument({
      chunkIdsBySnakeId: {
        1: [101],
        2: [102],
      },
      chunksById: {
        101: createChunkRecord(101, 0, "Alpha"),
        102: createChunkRecord(102, 1, "Beta"),
      },
      snakeIdsByGroup: [1, 2],
      snakesById: {
        1: createSnakeRecord(1, 4, "Alpha", "Beta"),
        2: createSnakeRecord(2, 1, "Gamma", "Delta"),
      },
    });

    const clues = await extractCluesFromDocument({
      document,
      groupId: 1,
      maxClues: 5,
      serialId: 1,
    });

    expect(clues).toHaveLength(2);
    expect(clues[0]?.label).toBe("Alpha -> Beta");
    expect(clues[0]?.weight).toBeCloseTo(0.8, 5);
    expect(clues[1]?.weight).toBeCloseTo(0.2, 5);
  });

  it("merges minor clues when there are too many", async () => {
    const document = createClueDocument({
      chunkIdsBySnakeId: {
        1: [101],
        2: [102],
        3: [103],
      },
      chunksById: {
        101: createChunkRecord(101, 0, "Major"),
        102: createChunkRecord(102, 0, "Minor A"),
        103: createChunkRecord(103, 1, "Minor B"),
      },
      snakeIdsByGroup: [1, 2, 3],
      snakesById: {
        1: createSnakeRecord(1, 8, "Major", "Lead"),
        2: createSnakeRecord(2, 1, "Minor", "A"),
        3: createSnakeRecord(3, 1, "Minor", "B"),
      },
    });

    const clues = await extractCluesFromDocument({
      document,
      groupId: 1,
      maxClues: 2,
      serialId: 1,
    });

    expect(clues).toHaveLength(2);
    expect(clues[0]?.label).toBe("Major -> Lead");
    expect(clues[1]).toMatchObject({
      isMerged: true,
      label: "Merged minor clues (2)",
      sourceSnakeIds: [2, 3],
    });
    expect(clues.reduce((sum, clue) => sum + clue.weight, 0)).toBeCloseTo(1, 6);
  });
});

function createClueDocument(input: {
  readonly chunkIdsBySnakeId: Record<number, readonly number[]>;
  readonly chunksById: Record<number, ChunkRecord>;
  readonly snakeIdsByGroup: readonly number[];
  readonly snakesById: Record<number, SnakeRecord>;
}): ReadonlyDocument {
  return {
    chunks: {
      getById: (chunkId: number) => Promise.resolve(input.chunksById[chunkId]),
    },
    snakeChunks: {
      listChunkIds: (snakeId: number) =>
        Promise.resolve([...(input.chunkIdsBySnakeId[snakeId] ?? [])]),
    },
    snakes: {
      getById: (snakeId: number) => Promise.resolve(input.snakesById[snakeId]),
      listIdsByGroup: () => Promise.resolve([...input.snakeIdsByGroup]),
    },
  } as unknown as ReadonlyDocument;
}

function createChunkRecord(
  chunkId: number,
  sentenceIndex: number,
  label: string,
): ChunkRecord {
  return {
    content: `${label} content`,
    generation: 0,
    id: chunkId,
    label,
    sentenceId: [1, sentenceIndex],
    sentenceIds: [[1, sentenceIndex]],
    wordsCount: 5,
    weight: 1,
  };
}

function createSnakeRecord(
  snakeId: number,
  weight: number,
  firstLabel: string,
  lastLabel: string,
): SnakeRecord {
  return {
    firstLabel,
    groupId: 1,
    id: snakeId,
    lastLabel,
    localSnakeId: snakeId,
    serialId: 1,
    size: 1,
    wordsCount: 10,
    weight,
  };
}

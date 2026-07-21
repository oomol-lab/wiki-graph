import { describe, expect, it } from "vitest";

import type {
  ChunkRecord,
  ReadonlySerialFragments,
} from "../../packages/core/src/document/index.js";
import { groupSegments } from "../../packages/core/src/graph/topology/grouping.js";

describe("topology/grouping", () => {
  it("converts normalized segment incisions into persisted sentence groups", async () => {
    const result = await groupSegments({
      chunks: [
        createChunk(1, 1, 3),
        createChunk(2, 2, 3),
        createChunk(3, 3, 3),
      ],
      edges: [],
      fragments: createSerialFragments({
        1: 10,
        2: 10,
        3: 10,
      }),
      groupWordsCount: 25,
      serialId: 7,
    });

    expect(result).toStrictEqual([
      {
        endSentenceIndex: 2,
        groupId: 0,
        serialId: 7,
        startSentenceIndex: 1,
      },
      {
        endSentenceIndex: 3,
        groupId: 1,
        serialId: 7,
        startSentenceIndex: 3,
      },
    ]);
  });
});

function createChunk(
  id: number,
  sentenceIndex: number,
  weight: number,
): ChunkRecord {
  return {
    content: `Chunk ${id}`,
    generation: 0,
    id,
    label: `Chunk ${id}`,
    sentenceId: [7, sentenceIndex],
    sentenceIds: [[7, sentenceIndex]],
    wordsCount: 5,
    weight,
  };
}

function createSerialFragments(
  wordsCountsByStartIndex: Record<number, number>,
): ReadonlySerialFragments {
  return {
    getFragment: (startSentenceIndex: number) =>
      Promise.resolve({
        fragmentId: startSentenceIndex,
        sentences: [
          {
            text: `Segment ${startSentenceIndex}`,
            wordsCount: wordsCountsByStartIndex[startSentenceIndex] ?? 0,
          },
        ],
        serialId: 7,
        summary: "",
      }),
    listFragmentIds: () =>
      Promise.resolve(
        Object.keys(wordsCountsByStartIndex).map((startSentenceIndex) =>
          Number(startSentenceIndex),
        ),
      ),
    path: "/tmp/fragments",
    serialId: 7,
  };
}

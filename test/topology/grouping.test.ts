import { describe, expect, it } from "vitest";

import type {
  ChunkRecord,
  ReadonlySerialFragments,
} from "../../src/document/index.js";
import { groupFragments } from "../../src/topology/grouping.js";

describe("topology/grouping", () => {
  it("converts normalized fragment incisions into persisted fragment groups", async () => {
    const result = await groupFragments({
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
  wordsCountsByFragmentId: Record<number, number>,
): ReadonlySerialFragments {
  return {
    getFragment: (fragmentId: number) =>
      Promise.resolve({
        fragmentId,
        sentences: [
          {
            text: `Fragment ${fragmentId}`,
            wordsCount: wordsCountsByFragmentId[fragmentId] ?? 0,
          },
        ],
        serialId: 7,
        summary: "",
      }),
    listFragmentIds: () =>
      Promise.resolve(
        Object.keys(wordsCountsByFragmentId).map((fragmentId) =>
          Number(fragmentId),
        ),
      ),
    path: "/tmp/fragments",
    serialId: 7,
  };
}

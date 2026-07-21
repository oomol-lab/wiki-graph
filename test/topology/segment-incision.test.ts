import { describe, expect, it } from "vitest";

import type {
  ChunkRecord,
  ReadingEdgeRecord,
  ReadonlySerialFragments,
} from "../../packages/core/src/document/index.js";
import { computeNormalizedSegmentIncisions } from "../../packages/core/src/graph/topology/segment-incision.js";

describe("topology/segment-incision", () => {
  it("returns zero incisions when segments have no external edges", async () => {
    const result = await computeNormalizedSegmentIncisions({
      chunks: [createChunk(1, 1, 2), createChunk(2, 2, 3)],
      edges: [],
      fragments: createSerialFragments({
        1: 10,
        2: 20,
      }),
    });

    expect(result).toStrictEqual([
      {
        endIncision: 0,
        startSentenceIndex: 1,
        startIncision: 0,
        wordsCount: 10,
      },
      {
        endIncision: 0,
        startSentenceIndex: 2,
        startIncision: 0,
        wordsCount: 20,
      },
    ]);
  });

  it("caps uniformly strong cross-segment incisions to the maximum score", async () => {
    const result = await computeNormalizedSegmentIncisions({
      chunks: [createChunk(1, 1, 5), createChunk(2, 2, 5)],
      edges: [
        {
          fromId: 1,
          toId: 2,
          weight: 2,
        },
      ] satisfies ReadingEdgeRecord[],
      fragments: createSerialFragments({
        1: 10,
        2: 20,
      }),
    });

    expect(result).toStrictEqual([
      {
        endIncision: 10,
        startSentenceIndex: 1,
        startIncision: 0,
        wordsCount: 10,
      },
      {
        endIncision: 0,
        startSentenceIndex: 2,
        startIncision: 10,
        wordsCount: 20,
      },
    ]);
  });

  it("maps chunk sentences to sparse segment start indexes", async () => {
    const result = await computeNormalizedSegmentIncisions({
      chunks: [createChunk(1, 2, 5), createChunk(2, 5, 5)],
      edges: [
        {
          fromId: 1,
          toId: 2,
          weight: 2,
        },
      ] satisfies ReadingEdgeRecord[],
      fragments: createSerialFragments({
        0: 10,
        3: 20,
      }),
    });

    expect(result).toStrictEqual([
      {
        endIncision: 10,
        startSentenceIndex: 0,
        startIncision: 0,
        wordsCount: 10,
      },
      {
        endIncision: 0,
        startSentenceIndex: 3,
        startIncision: 10,
        wordsCount: 20,
      },
    ]);
  });

  it("normalizes mixed incision strengths across multiple segments", async () => {
    const result = await computeNormalizedSegmentIncisions({
      chunks: [
        createChunk(1, 1, 4),
        createChunk(2, 2, 6),
        createChunk(3, 3, 5),
      ],
      edges: [
        {
          fromId: 1,
          toId: 2,
          weight: 2,
        },
        {
          fromId: 2,
          toId: 3,
          weight: 8,
        },
      ] satisfies ReadingEdgeRecord[],
      fragments: createSerialFragments({
        1: 10,
        2: 20,
        3: 30,
      }),
    });

    expect(result).toStrictEqual([
      {
        endIncision: 9,
        startSentenceIndex: 1,
        startIncision: 0,
        wordsCount: 10,
      },
      {
        endIncision: 10,
        startSentenceIndex: 2,
        startIncision: 1,
        wordsCount: 20,
      },
      {
        endIncision: 0,
        startSentenceIndex: 3,
        startIncision: 10,
        wordsCount: 30,
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
    sentenceId: [1, sentenceIndex],
    sentenceIds: [[1, sentenceIndex]],
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
        serialId: 1,
        summary: "",
      }),
    listFragmentIds: () =>
      Promise.resolve(
        Object.keys(wordsCountsByStartIndex).map((startSentenceIndex) =>
          Number(startSentenceIndex),
        ),
      ),
    path: "/tmp/fragments",
    serialId: 1,
  };
}

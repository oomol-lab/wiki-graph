import { describe, expect, it } from "vitest";

import type {
  ChunkRecord,
  ReadingEdgeRecord,
  ReadonlySerialFragments,
} from "../../src/document/index.js";
import { computeNormalizedFragmentIncisions } from "../../src/topology/fragment-incision.js";

describe("topology/fragment-incision", () => {
  it("returns zero incisions when fragments have no external edges", async () => {
    const result = await computeNormalizedFragmentIncisions({
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
        fragmentId: 1,
        startIncision: 0,
        wordsCount: 10,
      },
      {
        endIncision: 0,
        fragmentId: 2,
        startIncision: 0,
        wordsCount: 20,
      },
    ]);
  });

  it("caps uniformly strong cross-fragment incisions to the maximum score", async () => {
    const result = await computeNormalizedFragmentIncisions({
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
        fragmentId: 1,
        startIncision: 0,
        wordsCount: 10,
      },
      {
        endIncision: 0,
        fragmentId: 2,
        startIncision: 10,
        wordsCount: 20,
      },
    ]);
  });

  it("maps chunk sentences to sparse fragment start indexes", async () => {
    const result = await computeNormalizedFragmentIncisions({
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
        fragmentId: 0,
        startIncision: 0,
        wordsCount: 10,
      },
      {
        endIncision: 0,
        fragmentId: 3,
        startIncision: 10,
        wordsCount: 20,
      },
    ]);
  });

  it("normalizes mixed incision strengths across multiple fragments", async () => {
    const result = await computeNormalizedFragmentIncisions({
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
        fragmentId: 1,
        startIncision: 0,
        wordsCount: 10,
      },
      {
        endIncision: 10,
        fragmentId: 2,
        startIncision: 1,
        wordsCount: 20,
      },
      {
        endIncision: 0,
        fragmentId: 3,
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
        serialId: 1,
        summary: "",
      }),
    listFragmentIds: () =>
      Promise.resolve(
        Object.keys(wordsCountsByFragmentId).map((fragmentId) =>
          Number(fragmentId),
        ),
      ),
    path: "/tmp/fragments",
    serialId: 1,
  };
}

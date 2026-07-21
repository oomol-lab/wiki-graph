import { describe, expect, it } from "vitest";

import type {
  ChunkRecord,
  FragmentRecord,
  ReadonlySerialFragments,
} from "../../document/index.js";
import { formatClueAsBook } from "./markup.js";

describe("editor/markup", () => {
  it("loads the fragment containing a chunk sentence", async () => {
    const fragments = [
      createFragmentRecord(0, ["Alpha.", "Beta.", "Gamma."]),
      createFragmentRecord(3, ["Delta."]),
    ];
    const requestedFragmentIds: number[] = [];
    const result = await formatClueAsBook({
      chunks: [createChunkRecord(2)],
      serialFragments: createSerialFragments(fragments, requestedFragmentIds),
    });

    expect(requestedFragmentIds).toStrictEqual([0]);
    expect(result).toContain("Gamma.");
  });
});

function createSerialFragments(
  fragments: readonly FragmentRecord[],
  requestedFragmentIds: number[],
): ReadonlySerialFragments {
  const fragmentsById = new Map(
    fragments.map((fragment) => [fragment.fragmentId, fragment] as const),
  );

  return {
    getFragment: (fragmentId: number) => {
      requestedFragmentIds.push(fragmentId);
      const fragment = fragmentsById.get(fragmentId);

      if (fragment === undefined) {
        throw new Error(`Fragment ${fragmentId} does not exist`);
      }

      return Promise.resolve(fragment);
    },
    listFragmentIds: () =>
      Promise.resolve(fragments.map((fragment) => fragment.fragmentId)),
    path: "/tmp/fragments",
    serialId: 1,
  };
}

function createChunkRecord(sentenceIndex: number): ChunkRecord {
  return {
    content: "Gamma content",
    generation: 0,
    id: 1,
    label: "Gamma chunk",
    sentenceId: [1, sentenceIndex],
    sentenceIds: [[1, sentenceIndex]],
    wordsCount: 2,
    weight: 1,
  };
}

function createFragmentRecord(
  fragmentId: number,
  sentences: readonly string[],
): FragmentRecord {
  return {
    fragmentId,
    sentences: sentences.map((text) => ({
      text,
      wordsCount: 1,
    })),
    serialId: 1,
    summary: `Fragment ${fragmentId} summary`,
  };
}

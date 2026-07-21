import { describe, expect, it } from "vitest";

import { WorkingMemory } from "../../packages/core/src/text/reader/attention/working-memory.js";

describe("reader/working-memory", () => {
  it("formats current, previous, and retained chunks in prompt order", () => {
    const memory = new WorkingMemory(3);

    memory.addChunks([
      createChunk(7, 1, [1, 1], "Later", "Later content"),
      createChunk(3, 0, [1, 1], "Earlier", "Earlier content"),
    ]);
    memory.setRetainedChunks({
      extraChunks: [createChunk(5, 0, [1, 0], "Extra", "Extra content")],
      previousFragmentChunks: [
        createChunk(2, 0, [1, 0], "Previous", "Previous content"),
      ],
    });

    expect(memory.capacity).toBe(3);
    expect(memory.getChunks().map((chunk) => chunk.id)).toStrictEqual([
      7, 3, 2, 5,
    ]);
    expect(memory.formatForPrompt()).toBe(
      [
        "7. [Later] - Later content",
        "3. [Earlier] - Earlier content",
        "2. [Previous] - Previous content",
        "5. [Extra] - Extra content",
      ].join("\n"),
    );
    expect(memory.formatForPrompt(false)).toBe(
      ["2. [Previous] - Previous content", "5. [Extra] - Extra content"].join(
        "\n",
      ),
    );
  });

  it("finalizes fragments, increments generation, and clears all state", () => {
    const memory = new WorkingMemory(2);

    memory.addChunks([createChunk(1, 0, [1, 0], "Alpha", "Alpha content")]);
    memory.setRetainedChunks({
      extraChunks: [createChunk(2, 1, [1, 1], "Beta", "Beta content")],
      previousFragmentChunks: [
        createChunk(3, 0, [1, 2], "Gamma", "Gamma content"),
      ],
    });

    const finalized = memory.finalizeFragment();

    expect(finalized.map((chunk) => chunk.id)).toStrictEqual([1]);
    expect(memory.generation).toBe(1);
    expect(memory.getAllChunksForSaving()).toStrictEqual([]);
    expect(memory.getChunks().map((chunk) => chunk.id)).toStrictEqual([3, 2]);

    memory.clear();

    expect(memory.getChunks()).toStrictEqual([]);
    expect(memory.formatForPrompt()).toBe("(empty)");
  });
});

function createChunk(
  id: number,
  generation: number,
  sentenceId: readonly [number, number],
  label: string,
  content: string,
) {
  return {
    content,
    generation,
    id,
    label,
    links: [],
    sentenceId: [...sentenceId] as [number, number],
    sentenceIds: [[...sentenceId] as [number, number]],
    wordsCount: 1,
  };
}

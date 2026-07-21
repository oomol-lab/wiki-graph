import { describe, expect, it } from "vitest";

import { Attention } from "../../packages/core/src/text/reader/attention/core.js";
import { ChunkImportance } from "../../packages/core/src/document/index.js";

describe("reader/attention", () => {
  it("accepts chunk batches, assigns ids, and exposes visible context", async () => {
    const attention = new Attention(3, 0.5, createIdGenerator([10, 11]));

    const delta = await attention.acceptChunkBatch({
      chunks: [
        createChunk(0, 0, [1, 0], "Alpha", "Alpha content"),
        createChunk(0, 0, [1, 1], "Beta", "Beta content"),
      ],
      importanceAnnotations: [
        {
          chunkId: 10,
          importance: ChunkImportance.Important,
        },
      ],
      links: [
        {
          from: "temp-a",
          strength: "strong",
          to: "temp-b",
        },
      ],
      orderCorrect: true,
      tempIds: ["temp-a", "temp-b"],
    });

    expect(delta.chunks.map((chunk) => chunk.id)).toStrictEqual([10, 11]);
    expect(delta.chunks.map((chunk) => chunk.generation)).toStrictEqual([0, 0]);
    expect(delta.chunks[0]?.links).toStrictEqual([11]);
    expect(delta.edges).toStrictEqual([
      {
        fromId: 11,
        strength: "strong",
        toId: 10,
      },
    ]);
    expect(delta.importanceAnnotations).toStrictEqual([
      {
        chunkId: 10,
        importance: ChunkImportance.Important,
      },
    ]);
    expect(attention.capacity).toBe(3);
    expect(attention.createChunkBatchContext()).toStrictEqual({
      visibleChunkIds: [10, 11],
      workingMemoryPrompt: [
        "10. [Alpha] - Alpha content",
        "11. [Beta] - Beta content",
      ].join("\n"),
    });
  });

  it("keeps the previous fragment visible for one round and also retains reflected history", async () => {
    const attention = new Attention(2, 1, createIdGenerator([10, 11]));

    const firstDelta = await attention.acceptChunkBatch({
      chunks: [createChunk(0, 0, [1, 0], "Earlier", "Earlier content")],
      links: [],
      orderCorrect: true,
      tempIds: ["temp-a"],
    });

    attention.completeFragment({
      allChunks: firstDelta.chunks,
      getSuccessorChunkIds: () => [],
    });

    const secondDelta = await attention.acceptChunkBatch({
      chunks: [createChunk(0, 0, [1, 1], "Latest", "Latest content")],
      links: [],
      orderCorrect: true,
      tempIds: ["temp-b"],
    });

    attention.completeFragment({
      allChunks: [...firstDelta.chunks, ...secondDelta.chunks],
      getSuccessorChunkIds: (chunkId) => (chunkId === 10 ? [11] : []),
    });

    expect(attention.createChunkBatchContext()).toStrictEqual({
      visibleChunkIds: [11, 10],
      workingMemoryPrompt: [
        "11. [Latest] - Latest content",
        "10. [Earlier] - Earlier content",
      ].join("\n"),
    });

    attention.clear();

    expect(attention.createChunkBatchContext()).toStrictEqual({
      visibleChunkIds: [],
      workingMemoryPrompt: "(empty)",
    });
  });

  it("keeps all latest chunks even when they exceed capacity", async () => {
    const attention = new Attention(2, 1, createIdGenerator([10, 11, 12]));

    const firstDelta = await attention.acceptChunkBatch({
      chunks: [
        createChunk(0, 0, [1, 0], "Alpha", "Alpha content"),
        createChunk(0, 0, [1, 1], "Beta", "Beta content"),
        createChunk(0, 0, [1, 2], "Gamma", "Gamma content"),
      ],
      links: [],
      orderCorrect: true,
      tempIds: ["temp-a", "temp-b", "temp-c"],
    });

    attention.completeFragment({
      allChunks: firstDelta.chunks,
      getSuccessorChunkIds: () => [],
    });

    expect(attention.createChunkBatchContext()).toStrictEqual({
      visibleChunkIds: [10, 11, 12],
      workingMemoryPrompt: [
        "10. [Alpha] - Alpha content",
        "11. [Beta] - Beta content",
        "12. [Gamma] - Gamma content",
      ].join("\n"),
    });
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

function createIdGenerator(ids: readonly number[]): () => Promise<number> {
  const queue = [...ids];

  return () => {
    const nextId = queue.shift();

    if (nextId === undefined) {
      throw new Error("Ran out of generated ids");
    }

    return Promise.resolve(nextId);
  };
}

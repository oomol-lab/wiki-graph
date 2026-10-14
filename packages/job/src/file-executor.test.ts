import { describe, expect, it, vi } from "vitest";

import { executeChapterJobFile } from "./file-executor.js";
import { readChapterJobArtifact, writeChapterJobInput } from "./jsonl.js";
import type { JobProgressSink } from "./ports.js";
import {
  MemoryJobDirectory,
  MemoryJobFile,
} from "./testing/memory-platform.js";

describe("file-based chapter jobs", () => {
  it("builds an FTS artifact one JSONL record at a time", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      { chapterId: 3, title: "Douglas Adams", type: "chapter-title" },
      {
        sentenceIndex: 0,
        text: "The answer is forty-two.",
        type: "source-sentence",
        wordsCount: 5,
      },
    ]);

    const updatePhase = vi.fn<NonNullable<JobProgressSink["updatePhase"]>>();
    const result = await executeChapterJobFile({
      inputFile,
      kind: "index-fts",
      progress: { updatePhase },
      revision: 9,
      workspace: new MemoryJobDirectory(),
    });

    expect(result.revision).toBe(9);
    const records = await collect(readChapterJobArtifact(result.artifactFile));
    expect(records.map((record) => record.type)).toEqual([
      "lexical-row",
      "lexical-row",
    ]);
    expect(updatePhase.mock.calls.map(([progress]) => progress)).toEqual([
      { done: 0, phase: "indexing", total: 2, unit: "record" },
      {
        done: 1,
        force: false,
        phase: "indexing",
        total: 2,
        unit: "record",
      },
      {
        done: 2,
        force: false,
        phase: "indexing",
        total: 2,
        unit: "record",
      },
    ]);
  });

  it("streams embedding segments through an injected provider", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      {
        sentenceIndex: 0,
        text: "First sentence.",
        type: "source-sentence",
        wordsCount: 160,
      },
      {
        sentenceIndex: 1,
        text: "Second sentence.",
        type: "source-sentence",
        wordsCount: 160,
      },
      {
        sentenceIndex: 2,
        text: "Third sentence.",
        type: "source-sentence",
        wordsCount: 160,
      },
    ]);
    const embedTexts = vi.fn((texts: readonly string[]) =>
      Promise.resolve({
        embeddings: texts.map(() => [0.1, 0.2, 0.3]),
      }),
    );

    const updatePhase = vi.fn<NonNullable<JobProgressSink["updatePhase"]>>();
    const result = await executeChapterJobFile({
      embeddingProvider: { dimensions: 3, embedTexts, model: "test-model" },
      inputFile,
      kind: "index-embedding-source",
      progress: { updatePhase },
      revision: 4,
      workspace: new MemoryJobDirectory(),
    });

    const records = await collect(readChapterJobArtifact(result.artifactFile));
    expect(records[0]).toMatchObject({
      dimensions: 3,
      source: "source",
      type: "embedding-metadata",
    });
    expect(
      records.filter((record) => record.type === "embedding-segment"),
    ).toHaveLength(2);
    expect(embedTexts).toHaveBeenCalledTimes(1);
    expect(embedTexts).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(String), expect.any(String)]),
      undefined,
    );
    expect(updatePhase.mock.calls.map(([progress]) => progress)).toEqual([
      { done: 0, phase: "indexing", total: 2, unit: "record" },
      {
        done: 2,
        force: false,
        phase: "indexing",
        total: 2,
        unit: "record",
      },
    ]);
  });

  it.each(["index-embedding-source", "index-embedding-summary"] as const)(
    "%s emits metadata for empty input without calling the provider",
    async (kind) => {
      const inputFile = new MemoryJobFile("input.jsonl");
      await writeChapterJobInput(inputFile, []);
      const embedTexts = vi.fn(() =>
        Promise.reject(new Error("No text to embed.")),
      );
      const result = await executeChapterJobFile({
        embeddingProvider: {
          dimensions: 3,
          embedTexts,
          identity: "test-profile",
          model: "test-model",
        },
        inputFile,
        kind,
        revision: 4,
        workspace: new MemoryJobDirectory(),
      });
      expect(
        await collect(readChapterJobArtifact(result.artifactFile)),
      ).toEqual([
        {
          dimensions: 3,
          identity: "test-profile",
          model: "test-model",
          source: kind === "index-embedding-source" ? "source" : "summary",
          type: "embedding-metadata",
          version: 1,
        },
      ]);
      expect(result.revision).toBe(4);
      expect(embedTexts).not.toHaveBeenCalled();
    },
  );

  it("reports a complete summary phase for the single-fragment shortcut", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      {
        fragmentId: 1,
        sentenceIndex: 0,
        text: "A short chapter.",
        type: "source-sentence",
        wordsCount: 3,
      },
    ]);
    const updatePhase = vi.fn<NonNullable<JobProgressSink["updatePhase"]>>();
    const request = vi.fn(() =>
      Promise.reject(new Error("LLM should not be called")),
    );

    await executeChapterJobFile({
      inputFile,
      kind: "reading-summary",
      llm: { request },
      progress: { updatePhase },
      revision: 1,
      workspace: new MemoryJobDirectory(),
    });

    expect(request).not.toHaveBeenCalled();
    expect(updatePhase.mock.calls.map(([progress]) => progress)).toEqual([
      {
        done: 0,
        phase: "summary-compression",
        total: 1,
        unit: "item",
      },
      {
        done: 1,
        phase: "summary-compression",
        total: 1,
        unit: "item",
      },
    ]);
  });

  it("rejects records that belong to another job kind", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      {
        sentenceIndex: 0,
        text: "Reading Graph input",
        type: "source-text",
        wordsCount: 3,
      },
    ]);

    await expect(
      executeChapterJobFile({
        inputFile,
        kind: "index-fts",
        revision: 1,
        workspace: new MemoryJobDirectory(),
      }),
    ).rejects.toThrow("source-text is not valid input for index-fts");
  });

  it.each([
    "index-fts",
    "index-embedding-source",
    "index-embedding-summary",
  ] as const)("rejects generation options for %s", async (kind) => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, []);

    await expect(
      executeChapterJobFile({
        inputFile,
        kind,
        language: "English",
        prompt: "Focus on Arthur",
        revision: 1,
        workspace: new MemoryJobDirectory(),
      }),
    ).rejects.toThrow(`language and prompt are not supported for ${kind}`);
  });

  it("rejects hidden generation options in index snapshots", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      { language: "English", prompt: "Focus on Arthur", type: "job-options" },
    ]);

    await expect(
      executeChapterJobFile({
        inputFile,
        kind: "index-fts",
        revision: 1,
        workspace: new MemoryJobDirectory(),
      }),
    ).rejects.toThrow("job-options is not valid input for index-fts");
  });
});

async function collect<T>(records: AsyncIterable<T>): Promise<readonly T[]> {
  const output: T[] = [];
  for await (const record of records) output.push(record);
  return output;
}

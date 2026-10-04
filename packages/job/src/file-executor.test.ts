import { describe, expect, it, vi } from "vitest";

import { executeChapterJobFile } from "./file-executor.js";
import { readChapterJobArtifact, writeChapterJobInput } from "./jsonl.js";
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

    const result = await executeChapterJobFile({
      inputFile,
      kind: "index-fts",
      revision: 9,
      workspace: new MemoryJobDirectory(),
    });

    expect(result.revision).toBe(9);
    const records = await collect(readChapterJobArtifact(result.artifactFile));
    expect(records.map((record) => record.type)).toEqual([
      "lexical-row",
      "lexical-row",
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

    const result = await executeChapterJobFile({
      embeddingProvider: { dimensions: 3, embedTexts, model: "test-model" },
      inputFile,
      kind: "index-embedding-source",
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
  });

  it("rejects an empty summary embedding input at execution time", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, []);

    await expect(
      executeChapterJobFile({
        embeddingProvider: {
          dimensions: 3,
          embedTexts: () => Promise.resolve({ embeddings: [] }),
          model: "test-model",
        },
        inputFile,
        kind: "index-embedding-summary",
        revision: 4,
        workspace: new MemoryJobDirectory(),
      }),
    ).rejects.toThrow(
      "Summary embedding job requires at least one summary sentence",
    );
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

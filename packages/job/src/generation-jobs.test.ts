import { describe, expect, it, vi } from "vitest";

import { executeChapterJobFile } from "./file-executor.js";
import { readChapterJobArtifact, writeChapterJobInput } from "./jsonl.js";
import {
  MemoryJobDirectory,
  MemoryJobFile,
} from "./testing/memory-platform.js";

describe("file-based generation jobs", () => {
  it("builds semantic Reading Graph records through the LLM port", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      { extractionPrompt: "Track decisions", type: "job-options" },
      {
        sentenceIndex: 0,
        text: "Arthur decided to leave Earth.",
        type: "source-text",
        wordsCount: 6,
      },
    ]);
    const request = vi.fn(() =>
      Promise.resolve(
        JSON.stringify({
          chunks: [
            {
              content: "Arthur decides to leave Earth.",
              label: "Departure decision",
              sentenceIndexes: [0],
              tempId: "A",
            },
          ],
          links: [],
        }),
      ),
    );

    const result = await executeChapterJobFile({
      inputFile,
      kind: "reading-graph",
      llm: { request },
      revision: 2,
      workspace: new MemoryJobDirectory(),
    });
    const records = await collect(readChapterJobArtifact(result.artifactFile));
    expect(records.map((record) => record.type)).toEqual([
      "job-parameter",
      "reading-chunk",
      "fragment-group",
      "snake",
      "snake-chunk",
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("compresses Reading Summary groups through the LLM port", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      { fragmentId: 0, summary: "", type: "source-fragment" },
      {
        fragmentId: 0,
        sentenceIndex: 0,
        text: "Arthur left Earth.",
        type: "source-sentence",
        wordsCount: 3,
      },
      { fragmentId: 1, summary: "", type: "source-fragment" },
      {
        fragmentId: 1,
        sentenceIndex: 1,
        text: "He carried a towel.",
        type: "source-sentence",
        wordsCount: 4,
      },
      {
        endSentenceIndex: 1,
        groupId: 0,
        startSentenceIndex: 0,
        type: "fragment-group",
      },
    ]);
    const request = vi.fn(() =>
      Promise.resolve("<final>Arthur left Earth with a towel.</final>"),
    );

    const result = await executeChapterJobFile({
      inputFile,
      kind: "reading-summary",
      llm: { request },
      revision: 3,
      workspace: new MemoryJobDirectory(),
    });
    expect(await collect(readChapterJobArtifact(result.artifactFile))).toEqual([
      {
        position: 0,
        text: "Arthur left Earth with a towel.",
        type: "summary-part",
      },
    ]);
  });

  it("grounds Knowledge Graph mentions through injected providers", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      { fragmentId: 0, summary: "", type: "source-fragment" },
      {
        fragmentId: 0,
        sentenceIndex: 0,
        text: "Douglas Adams wrote novels.",
        type: "source-sentence",
        wordsCount: 4,
      },
    ]);
    const result = await executeChapterJobFile({
      inputFile,
      kind: "knowledge-graph",
      llm: {
        request: () =>
          Promise.resolve(
            JSON.stringify({
              links: [],
              mentions: [{ candidate: 0, qid: "Q42" }],
            }),
          ),
      },
      revision: 4,
      wikimedia: {
        resolve: () =>
          Promise.resolve([
            {
              en: {
                description: "English writer",
                label: "Douglas Adams",
                url: "https://en.wikipedia.org/wiki/Douglas_Adams",
              },
              qid: "Q42",
              zh: { description: null, label: null, url: null },
            },
          ]),
      },
      wikispine: {
        match: () =>
          Promise.resolve([
            {
              end: "Douglas Adams".length,
              qids: [{ disambiguation: false, qid: "Q42" }],
              start: 0,
            },
          ]),
      },
      workspace: new MemoryJobDirectory(),
    });
    const records = await collect(readChapterJobArtifact(result.artifactFile));
    expect(records.map((record) => record.type)).toEqual([
      "job-parameter",
      "mention",
    ]);
    expect(records[1]).toMatchObject({
      qid: "Q42",
      sentenceIndex: 0,
      surface: "Douglas Adams",
    });
  });
});

async function collect<T>(records: AsyncIterable<T>): Promise<readonly T[]> {
  const output: T[] = [];
  for await (const record of records) output.push(record);
  return output;
}

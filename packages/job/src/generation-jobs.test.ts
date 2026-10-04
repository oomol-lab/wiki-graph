import { describe, expect, it, vi } from "vitest";

import { executeChapterJobFile } from "./file-executor.js";
import { readChapterJobArtifact, writeChapterJobInput } from "./jsonl.js";
import {
  MemoryJobDirectory,
  MemoryJobFile,
} from "./testing/memory-platform.js";
import type { JobLlm } from "./ports.js";

describe("file-based generation jobs", () => {
  it("builds semantic Reading Graph records through the LLM port", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      {
        sentenceIndex: 0,
        text: "Arthur decided to leave Earth.",
        type: "source-text",
        wordsCount: 6,
      },
    ]);
    const responses = [
      JSON.stringify({
        chunks: [
          {
            content: "Arthur decides to leave Earth.",
            evidence: [
              {
                quote: "Arthur decided to leave Earth.",
                sentence_id: "S1",
              },
            ],
            label: "Departure decision",
            retention: "focused",
            temp_id: "A",
          },
        ],
        fragment_summary: "Arthur decided to leave Earth.",
        links: [],
      }),
      JSON.stringify({
        chunks: [],
        importance_annotations: [],
        links: [],
      }),
    ];
    const request = vi.fn((..._args: Parameters<JobLlm["request"]>) =>
      Promise.resolve(responses.shift() ?? ""),
    );

    const result = await executeChapterJobFile({
      inputFile,
      kind: "reading-graph",
      llm: { request },
      prompt: "Track decisions",
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
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls[0]?.[0].some((message) =>
        message.content.includes("Track decisions"),
      ),
    ).toBe(true);
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
    const request = vi.fn((..._args: Parameters<JobLlm["request"]>) =>
      Promise.resolve("<final>Arthur left Earth with a towel.</final>"),
    );

    const result = await executeChapterJobFile({
      inputFile,
      kind: "reading-summary",
      language: "English",
      llm: { request },
      prompt: "Focus on what Arthur carries",
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
    expect(request.mock.calls[0]?.[0][0]?.content).toContain(
      "Focus on what Arthur carries",
    );
  });

  it("uses Reading Graph clues and reviewer feedback for summaries", async () => {
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
        content: "Arthur leaves Earth with a towel.",
        generation: 0,
        id: "chunk-1",
        label: "Departure",
        sentenceIndex: 0,
        sentenceIndexes: [0, 1],
        type: "reading-chunk",
        weight: 2,
        wordsCount: 7,
      },
      {
        endSentenceIndex: 1,
        groupId: 0,
        startSentenceIndex: 0,
        type: "fragment-group",
      },
      {
        firstLabel: "Departure",
        groupId: 0,
        id: "snake-1",
        lastLabel: "Departure",
        localSnakeId: 0,
        size: 1,
        type: "snake",
        weight: 2,
        wordsCount: 7,
      },
      {
        chunkId: "chunk-1",
        position: 0,
        snakeId: "snake-1",
        type: "snake-chunk",
      },
    ]);
    const responses = [
      "Preserve the departure and the towel.",
      "<final>Arthur left Earth with a towel.</final>",
      '{"issues":[]}',
    ];
    const request = vi.fn((..._args: Parameters<JobLlm["request"]>) =>
      Promise.resolve(responses.shift() ?? ""),
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
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map((call) => call[1].scope)).toEqual([
      "reading-summary-review-guide",
      "reading-summary-compress",
      "reading-summary-review",
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
        request: vi
          .fn()
          .mockResolvedValueOnce(
            JSON.stringify({
              protectedSurfaces: [{ surfaceId: "s1" }],
            }),
          )
          .mockResolvedValueOnce(
            JSON.stringify({
              groups: [
                {
                  decisions: [
                    {
                      candidateId: "c1",
                      decision: "recall",
                      qid: "Q42",
                    },
                  ],
                  groupId: "g1",
                },
              ],
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

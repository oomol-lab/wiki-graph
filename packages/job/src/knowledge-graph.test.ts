import { describe, expect, it } from "vitest";

import { writeChapterJobInput } from "./jsonl.js";
import { buildKnowledgeGraphRecords } from "./knowledge-graph.js";
import { MemoryJobFile } from "./testing/memory-platform.js";

describe("knowledge-graph", () => {
  it("reports bounded enrichment progress for mixed duplicate QID inputs", async () => {
    const inputFile = new MemoryJobFile("input.jsonl");
    await writeChapterJobInput(inputFile, [
      {
        fragmentId: 1,
        sentenceIndex: 0,
        text: "x",
        type: "source-sentence",
        wordsCount: 1,
      },
    ]);
    const enrichment: Array<{ readonly done: number; readonly total: number }> =
      [];

    await collect(
      buildKnowledgeGraphRecords({
        inputFile,
        llm: {
          request: (messages) =>
            Promise.resolve(
              messages.some((message) =>
                message.content.includes("protectedSurfaces"),
              )
                ? JSON.stringify({
                    protectedSurfaces: [{ surfaceId: "s1" }],
                  })
                : JSON.stringify({
                    groups: [
                      {
                        decisions: [
                          { candidateId: "c1", decision: "never_recall" },
                        ],
                        groupId: "g1",
                      },
                    ],
                  }),
            ),
        },
        progress: {
          updatePhase: (progress) => {
            if (progress.phase === "enrichment") {
              enrichment.push({ done: progress.done, total: progress.total });
            }
          },
        },
        wikimedia: {
          resolve: async function* (input) {
            await Promise.resolve();
            expect(input).toStrictEqual([
              { disambiguation: true, qid: "Q1" },
              { disambiguation: false, qid: "Q1" },
            ]);
            yield { index: 1, resolution: resolution("Q1", "plain") };
            yield {
              index: 0,
              resolution: {
                ...resolution("Q1", "disambiguation"),
                disambiguation: [{ information: "meaning", qid: "Q2" }],
              },
            };
          },
        },
        wikispine: {
          match: async function* () {
            await Promise.resolve();
            yield {
              end: 1,
              qids: [
                { disambiguation: true, qid: "Q1" },
                { disambiguation: false, qid: "Q1" },
              ],
              start: 0,
            };
          },
        },
      }),
    );

    expect(enrichment).toStrictEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
      { done: 2, total: 2 },
    ]);
    expect(
      enrichment.every(({ done, total }) => done >= 0 && done <= total),
    ).toBe(true);
  });
});

function resolution(qid: string, label: string) {
  return {
    en: { description: null, label: null, url: null },
    qid,
    zh: { description: null, label, url: null },
  };
}

async function collect<T>(input: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for await (const value of input) values.push(value);
  return values;
}

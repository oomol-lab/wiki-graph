import { describe, expect, it } from "vitest";

import { WaveReflection } from "../../src/reader/attention/wave-reflection.js";
import { segmentTextStream } from "../../src/reader/segment/segment.js";
import {
  normalizeText,
  splitTextIntoSentences,
} from "../../src/evidence-selection/index.js";

describe("reader/text-processing", () => {
  it("splits text into sentences and normalizes comparison text", () => {
    expect(splitTextIntoSentences(" Alpha. Beta!\n\nGamma? ")).toStrictEqual([
      "Alpha.",
      "Beta!",
      "Gamma?",
    ]);
    expect(normalizeText(" Café — co ‐ operate! 中文。 ")).toBe(
      "cafecooperate中文",
    );
  });

  it("segments streamed text across chunk boundaries", async () => {
    const segments = [];

    for await (const segment of segmentTextStream([
      "First sentence. Sec",
      "ond sentence.\n\n第三句。",
    ])) {
      segments.push(segment.text);
    }

    expect(segments).toStrictEqual([
      "First sentence.",
      "Second sentence.",
      "第三句。",
    ]);
  });
});

describe("reader/wave-reflection", () => {
  it("selects relevant historical chunks using successor links", () => {
    const reflection = new WaveReflection(0.5);
    const allChunks = [
      {
        content: "one",
        generation: 0,
        id: 1,
        label: "one",
        links: [],
        sentenceId: [1, 0, 0] as const,
        sentenceIds: [[1, 0, 0] as const],
        wordsCount: 1,
      },
      {
        content: "two",
        generation: 1,
        id: 2,
        label: "two",
        links: [],
        sentenceId: [1, 0, 1] as const,
        sentenceIds: [[1, 0, 1] as const],
        wordsCount: 1,
      },
      {
        content: "three",
        generation: 2,
        id: 3,
        label: "three",
        links: [],
        sentenceId: [1, 0, 2] as const,
        sentenceIds: [[1, 0, 2] as const],
        wordsCount: 1,
      },
    ];

    const selected = reflection.selectTopChunks({
      allChunks,
      capacity: 2,
      getSuccessorChunkIds: (chunkId) => {
        switch (chunkId) {
          case 1:
            return [2];
          case 2:
            return [3];
          default:
            return [];
        }
      },
      latestChunkIds: [3],
    });

    expect(selected.map((chunk) => chunk.id)).toStrictEqual([1, 2]);
  });
});

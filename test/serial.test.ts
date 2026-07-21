import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReaderChunk,
  ReaderGraphDelta,
  ReaderSegment,
  ReaderSentence,
  ReaderTextStream,
} from "../packages/core/src/text/reader/index.js";

const EMPTY_DELTA: ReaderGraphDelta = {
  chunks: [],
  edges: [],
};

const { compressTextMock, readerFragmentSummaryMock, readerSegmentMock } =
  vi.hoisted(() => ({
    compressTextMock: vi.fn(),
    readerFragmentSummaryMock: vi.fn<() => string>(),
    readerSegmentMock:
      vi.fn<(stream: ReaderTextStream) => AsyncIterable<ReaderSegment>>(),
  }));

vi.mock("../packages/core/src/text/editor/index.js", () => ({
  compressText: compressTextMock,
}));

vi.mock("../packages/core/src/text/reader/index.js", () => ({
  Reader: class {
    public segment(stream: ReaderTextStream): AsyncIterable<ReaderSegment> {
      return readerSegmentMock(stream);
    }

    public extractUserFocused(_input: {
      readonly sentences: readonly ReaderSentence[];
      readonly text: string;
    }): Promise<{
      readonly delta: ReaderGraphDelta;
      readonly fragmentSummary: string;
    }> {
      return Promise.resolve({
        delta: EMPTY_DELTA,
        fragmentSummary: readerFragmentSummaryMock(),
      });
    }

    public extractBookCoherence(_input: {
      readonly sentences: readonly ReaderSentence[];
      readonly text: string;
      readonly userFocusedChunks: readonly ReaderChunk[];
    }): Promise<ReaderGraphDelta> {
      return Promise.resolve(EMPTY_DELTA);
    }

    public completeFragment(_input: {
      readonly allChunks: readonly ReaderChunk[];
      readonly getSuccessorChunkIds: (chunkId: number) => readonly number[];
    }): void {}
  },
  segmentTextStream: (stream: ReaderTextStream): AsyncIterable<ReaderSegment> =>
    readerSegmentMock(stream),
}));

vi.mock("../packages/core/src/graph/topology/index.js", () => ({
  Topology: class {
    public accept(): void {}

    public finalize(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

import { DirectoryDocument } from "../packages/core/src/document/index.js";
import {
  SerialGeneration,
  writeSerialSource,
} from "../packages/core/src/serial.js";
import { withTempDir } from "./helpers/temp.js";

describe("serial", () => {
  beforeEach(() => {
    compressTextMock.mockReset();
    readerFragmentSummaryMock.mockReset();
    readerSegmentMock.mockReset();
    compressTextMock.mockResolvedValue("");
    readerFragmentSummaryMock.mockReturnValue("");
  });

  it("emits advance for a single fragment before completion", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);
      const progressTracker = {
        advance: vi.fn((_wordsCount: number) => Promise.resolve()),
        complete: vi.fn((_finalWordsCount?: number) => Promise.resolve()),
      };

      readerSegmentMock.mockReturnValueOnce(
        createSentenceStream([
          {
            offset: 0,
            text: "Alpha beta.",
            wordsCount: 2,
          },
        ]),
      );

      try {
        await new SerialGeneration({
          document,
          llm: {} as never,
        }).generateInto(
          1,
          ["Alpha beta."],
          {
            extractionPrompt: "Keep key beats",
          },
          progressTracker as never,
        );

        expect(progressTracker.advance).toHaveBeenCalledTimes(1);
        expect(progressTracker.advance).toHaveBeenCalledWith(2);
        expect(progressTracker.complete).toHaveBeenCalledTimes(1);
        expect(progressTracker.complete).toHaveBeenCalledWith();
      } finally {
        await document.release();
      }
    });
  });

  it("emits advance for every processed fragment", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);
      const progressTracker = {
        advance: vi.fn((_wordsCount: number) => Promise.resolve()),
        complete: vi.fn((_finalWordsCount?: number) => Promise.resolve()),
      };

      readerSegmentMock.mockReturnValueOnce(
        createSentenceStream([
          {
            offset: 0,
            text: "Alpha beta.",
            wordsCount: 200,
          },
          {
            offset: 11,
            text: "Gamma delta epsilon.",
            wordsCount: 160,
          },
        ]),
      );

      try {
        await new SerialGeneration({
          document,
          llm: {} as never,
        }).generateInto(
          1,
          [`${createWords("alpha", 200)}. ${createWords("Gamma", 160)}.`],
          {
            extractionPrompt: "Keep key beats",
          },
          progressTracker as never,
        );

        expect(progressTracker.advance).toHaveBeenCalledTimes(2);
        expect(progressTracker.advance).toHaveBeenNthCalledWith(1, 200);
        expect(progressTracker.advance).toHaveBeenNthCalledWith(2, 160);
        expect(progressTracker.complete).toHaveBeenCalledWith();
      } finally {
        await document.release();
      }
    });
  });

  it("uses the original text as summary when a serial has one fragment", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);

      readerSegmentMock.mockReturnValueOnce(
        createSentenceStream([
          {
            offset: 0,
            text: "Alpha beta.",
            wordsCount: 2,
          },
          {
            offset: 11,
            text: "Gamma delta.",
            wordsCount: 2,
          },
        ]),
      );

      try {
        const serial = await new SerialGeneration({
          document,
          llm: {} as never,
        }).generateInto(1, ["Alpha beta. Gamma delta."], {
          extractionPrompt: "Keep key beats",
        });

        expect(serial.getSummary()).toBe("Alpha beta. Gamma delta.");
        expect(await document.readSummary(1)).toBe("Alpha beta. Gamma delta.");
        expect(compressTextMock).not.toHaveBeenCalled();
      } finally {
        await document.release();
      }
    });
  });

  it("writes an empty summary when a serial has no fragments", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);

      readerSegmentMock.mockReturnValueOnce(createSentenceStream([]));

      try {
        const serial = await new SerialGeneration({
          document,
          llm: {} as never,
        }).generateInto(1, [], {
          extractionPrompt: "Keep key beats",
        });

        expect(serial.getSummary()).toBe("");
        expect(await document.readSummary(1)).toBe("");
        expect(compressTextMock).not.toHaveBeenCalled();
      } finally {
        await document.release();
      }
    });
  });

  it("can build topology and summary as separate phases", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);

      readerSegmentMock.mockReturnValueOnce(
        createSentenceStream([
          {
            offset: 0,
            text: "Alpha beta.",
            wordsCount: 2,
          },
        ]),
      );

      try {
        const generation = new SerialGeneration({
          document,
          llm: {} as never,
        });

        await document.serials.createWithId(1);
        await writeSerialSource(document, 1, ["Alpha beta."]);
        await generation.buildTopologyInto(1, {
          extractionPrompt: "Keep key beats",
        });

        expect(await document.readSummary(1)).toBeUndefined();
        expect(await document.serials.getById(1)).toMatchObject({
          topologyReady: true,
        });

        const serial = await generation.buildSummary(1);

        expect(serial.getSummary()).toBe("Alpha beta.");
        expect(await document.readSummary(1)).toBe("Alpha beta.");
      } finally {
        await document.release();
      }
    });
  });

  it("preserves imported source text while exposing normalized sentences", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);
      const sourceText =
        "\n\n  Alpha wraps\ninside one sentence. Beta follows.\n\n";

      try {
        await document.serials.createWithId(1);
        await writeSerialSource(document, 1, [sourceText]);

        const serial = document.getSerialFragments(1);
        const sentence = await serial.getSentence(0);

        expect(await serial.readText()).toBe(sourceText);
        expect(sentence).toMatchObject({
          rawText: "  Alpha wraps\n",
          text: "Alpha wraps",
          wordsCount: 2,
        });
      } finally {
        await document.release();
      }
    });
  });

  it("does not build a summary before topology is ready", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.serials.createWithId(1);

        await expect(
          new SerialGeneration({
            document,
            llm: {} as never,
          }).buildSummary(1),
        ).rejects.toThrow("Serial 1 is not ready for summary");
      } finally {
        await document.release();
      }
    });
  });

  it("reuses an existing summary without recompressing", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);

      readerSegmentMock.mockReturnValueOnce(
        createSentenceStream([
          {
            offset: 0,
            text: "Alpha beta.",
            wordsCount: 2,
          },
          {
            offset: 11,
            text: "Gamma delta.",
            wordsCount: 2,
          },
        ]),
      );

      try {
        const generation = new SerialGeneration({
          document,
          llm: {} as never,
        });

        await document.serials.createWithId(1);
        await writeSerialSource(document, 1, ["Alpha beta. Gamma delta."]);
        await generation.buildTopologyInto(1, {
          extractionPrompt: "Keep key beats",
        });
        await document.writeSummary(1, "Existing summary");

        const serial = await generation.buildSummary(1);

        expect(serial.getSummary()).toBe("Existing summary");
        expect(compressTextMock).not.toHaveBeenCalled();
      } finally {
        await document.release();
      }
    });
  });

  it("does not write reader fragment summaries into source text", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);

      readerSegmentMock.mockReturnValueOnce(
        createSentenceStream([
          {
            offset: 0,
            text: "朱元璋面对张士诚。",
            wordsCount: 3,
          },
        ]),
      );
      readerFragmentSummaryMock.mockReturnValueOnce(
        "朱元璋即将面向最后一个真正的敌人。",
      );

      try {
        await document.serials.createWithId(1);
        await writeSerialSource(document, 1, ["朱元璋面对张士诚。"]);
        const before = await document.getSerialFragments(1).readText();

        await new SerialGeneration({
          document,
          llm: {} as never,
        }).buildTopologyInto(1, {
          extractionPrompt: "Keep key beats",
        });

        expect(await document.getSerialFragments(1).readText()).toBe(before);
      } finally {
        await document.release();
      }
    });
  });
});

function createSentenceStream(
  sentences: ReadonlyArray<ReaderSegment>,
): AsyncIterable<ReaderSegment> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<ReaderSegment> {
      const iterator = sentences[Symbol.iterator]();

      return {
        next() {
          return Promise.resolve(iterator.next());
        },
      };
    },
  };
}

function createWords(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(" ");
}

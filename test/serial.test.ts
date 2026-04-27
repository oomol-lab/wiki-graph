import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReaderChunk,
  ReaderGraphDelta,
  ReaderSegment,
  ReaderSentence,
  ReaderTextStream,
} from "../src/reader/index.js";

const EMPTY_DELTA: ReaderGraphDelta = {
  chunks: [],
  edges: [],
};

const { compressTextMock, readerSegmentMock } = vi.hoisted(() => ({
  compressTextMock: vi.fn(),
  readerSegmentMock:
    vi.fn<(stream: ReaderTextStream) => AsyncIterable<ReaderSegment>>(),
}));

vi.mock("../src/editor/index.js", () => ({
  compressText: compressTextMock,
}));

vi.mock("../src/reader/index.js", () => ({
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
        fragmentSummary: "",
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
  segmentTextStream: (stream: ReaderTextStream): ReaderTextStream => stream,
}));

vi.mock("../src/topology/index.js", () => ({
  Topology: class {
    public accept(): void {}

    public finalize(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

import { DirectoryDocument } from "../src/document/index.js";
import { SerialGeneration } from "../src/serial.js";
import { withTempDir } from "./helpers/temp.js";

describe("serial", () => {
  beforeEach(() => {
    compressTextMock.mockReset();
    readerSegmentMock.mockReset();
    compressTextMock.mockResolvedValue("");
  });

  it("emits advance for a single fragment before completion", async () => {
    await withTempDir("spinedigest-serial-", async (path) => {
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
          [],
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
    await withTempDir("spinedigest-serial-", async (path) => {
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
          [],
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
    await withTempDir("spinedigest-serial-", async (path) => {
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
        }).generateInto(1, [], {
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
    await withTempDir("spinedigest-serial-", async (path) => {
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

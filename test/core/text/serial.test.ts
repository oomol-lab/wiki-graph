import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReaderChunk,
  ReaderGraphDelta,
  ReaderSegment,
  ReaderSentence,
  ReaderTextStream,
} from "../../../packages/core/src/text/reader/index.js";

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

vi.mock("../../../packages/core/src/text/editor/index.js", () => ({
  compressText: compressTextMock,
}));

vi.mock("../../../packages/core/src/text/reader/index.js", () => ({
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

vi.mock("../../../packages/core/src/graph/topology/index.js", () => ({
  Topology: class {
    public accept(): void {}

    public finalize(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

import { DirectoryDocument } from "../../../packages/core/src/document/index.js";
import { DirectoryFileStore } from "../../../packages/core/src/document/directory/directory-file-store.js";
import { NodeDirectory } from "../../../packages/cli/src/runtime/node-platform.js";
import type { NodeFile } from "../../../packages/cli/src/runtime/node-platform.js";
import type {
  Directory,
  File,
} from "../../../packages/core/src/runtime/platform/index.js";
import {
  SerialGeneration,
  writeSerialSource,
} from "../../../packages/core/src/serial.js";
import { withTempDir } from "../../helpers/temp.js";

describe("serial", () => {
  beforeEach(() => {
    compressTextMock.mockReset();
    readerFragmentSummaryMock.mockReset();
    readerSegmentMock.mockReset();
    compressTextMock.mockResolvedValue("");
    readerFragmentSummaryMock.mockReturnValue("");
  });

  it("reads sentence ranges without whole-file reads", async () => {
    await withTempDir("wikigraph-serial-", async (path) => {
      const initial = await DirectoryDocument.open(path);
      try {
        await initial.serials.createWithId(1);
        await writeSerialSource(initial, 1, ["Alpha beta. Gamma delta."]);
      } finally {
        await initial.release();
      }

      class RangeOnlyFileStore extends DirectoryFileStore {
        public override async readFile(pathname: string) {
          if (pathname.startsWith("texts/")) {
            throw new Error("whole-file read is not allowed");
          }
          return await super.readFile(pathname);
        }
      }

      const document = await DirectoryDocument.openFileStore(
        new RangeOnlyFileStore(new NodeDirectory(path)),
      );
      try {
        const serial = document.getSerialFragments(1);
        await expect(serial.getSentence(0)).resolves.toMatchObject({
          text: "Alpha beta.",
        });
        await expect(serial.listSentencesInRange(1, 1)).resolves.toMatchObject([
          { text: "Gamma delta." },
        ]);
        await expect(serial.readTextInRange(1, 1)).resolves.toBe(
          "Gamma delta.",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("reads late Unicode ranges without scanning the text prefix", async () => {
    await withTempDir("wikigraph-serial-late-range-", async (path) => {
      const prefix = `${"a".repeat(512 * 1024)}.`;
      const target = "朱元璋抵达洪都。";
      const initial = await DirectoryDocument.open(path);
      try {
        await initial.serials.createWithId(1);
        const draft = await initial.getSerialFragments(1).createDraft();
        draft.addSentence(prefix, 1);
        draft.addSentence(target, 4);
        await draft.commit();
      } finally {
        await initial.release();
      }

      let rangeBytesRead = 0;
      class MeasuredRangeFileStore extends DirectoryFileStore {
        public override async readFile(pathname: string) {
          if (pathname.startsWith("texts/")) {
            throw new Error("whole-file read is not allowed");
          }
          return await super.readFile(pathname);
        }

        public override async readFileRange(
          pathname: string,
          offset: number,
          length: number,
        ) {
          rangeBytesRead += length;
          return await super.readFileRange(pathname, offset, length);
        }
      }

      const document = await DirectoryDocument.openFileStore(
        new MeasuredRangeFileStore(new NodeDirectory(path)),
      );
      try {
        await expect(
          document.getSerialFragments(1).readTextInRangeWithOffsets(1, 1),
        ).resolves.toEqual({
          sourceEnd: Array.from(prefix + target).length,
          sourceStart: Array.from(prefix).length,
          text: target,
        });
        expect(rangeBytesRead).toBe(new TextEncoder().encode(target).length);
      } finally {
        await document.release();
      }
    });
  });

  it("appends Unicode drafts through files with only reader-based size", async () => {
    await withTempDir("wikigraph-serial-minimal-file-", async (path) => {
      const document = await DirectoryDocument.open(
        wrapMinimalDirectory(new NodeDirectory(path)),
      );
      const firstText = "你😀。";
      const secondText = "A𠮷B。";
      try {
        await document.serials.createWithId(1);
        const firstDraft = await document.getSerialFragments(1).createDraft();
        firstDraft.addSentence(firstText, 2);
        await firstDraft.commit();

        const secondDraft = await document.getSerialFragments(1).createDraft();
        secondDraft.addSentence(secondText, 3);
        await secondDraft.commit();

        const serial = document.getSerialFragments(1);
        const sentences = await serial.listSentencesInRange(0, 1);
        expect(sentences.map((sentence) => sentence.text)).toEqual([
          firstText,
          secondText,
        ]);
        const locations = await document.readDatabase(
          async (database) =>
            await database.queryAll(
              `SELECT sentence_index, byte_offset, byte_length,
                    character_offset, character_length
             FROM text_sentence_records
             WHERE kind = 1 AND chapter_id = 1
             ORDER BY sentence_index`,
              undefined,
              (row) => ({
                byteLength: Number(row.byte_length),
                byteOffset: Number(row.byte_offset),
                characterLength: Number(row.character_length),
                characterOffset: Number(row.character_offset),
                sentenceIndex: Number(row.sentence_index),
              }),
            ),
        );
        expect(locations).toEqual([
          {
            byteLength: new TextEncoder().encode(firstText).length,
            byteOffset: 0,
            characterLength: 3,
            characterOffset: 0,
            sentenceIndex: 0,
          },
          {
            byteLength: new TextEncoder().encode(secondText).length,
            byteOffset: new TextEncoder().encode(firstText).length,
            characterLength: 4,
            characterOffset: 3,
            sentenceIndex: 1,
          },
        ]);
        await expect(serial.readTextInRangeWithOffsets(1, 1)).resolves.toEqual({
          sourceEnd: 7,
          sourceStart: 3,
          text: secondText,
        });
      } finally {
        await document.release();
      }
    });
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

function wrapMinimalDirectory(backing: NodeDirectory): Directory {
  return {
    createDirectory: async (name) =>
      wrapMinimalDirectory(
        (await backing.createDirectory(name)) as NodeDirectory,
      ),
    createFile: async (name) =>
      wrapMinimalFile((await backing.createFile(name)) as NodeFile),
    getDirectory: async (name) => {
      const directory = await backing.getDirectory(name);
      return directory === undefined
        ? undefined
        : wrapMinimalDirectory(directory as NodeDirectory);
    },
    getFile: async (name) => {
      const file = await backing.getFile(name);
      return file === undefined ? undefined : wrapMinimalFile(file as NodeFile);
    },
    identity: backing.identity,
    list: async () =>
      (await backing.list()).map((entry) =>
        entry instanceof NodeDirectory
          ? wrapMinimalDirectory(entry)
          : wrapMinimalFile(entry as NodeFile),
      ),
    name: backing.name,
    remove: async (name, options) => await backing.remove(name, options),
  };
}

function wrapMinimalFile(backing: NodeFile): File {
  return new Proxy(backing, {
    get: (target, property, receiver) => {
      if (property === "getSize" || property === "size") return undefined;
      if (property === "read") {
        return () => Promise.reject(new Error("whole-file read is forbidden"));
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

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

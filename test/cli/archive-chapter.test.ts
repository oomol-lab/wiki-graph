import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chapterMockState = vi.hoisted(() => ({
  addCalls: [] as unknown[],
  editableCalls: [] as string[],
  generatedGraphCalls: [] as unknown[],
  generatedSummaryCalls: [] as unknown[],
  inputFileContent: "file content",
  listEntries: [
    {
      chapterId: 1,
      childCount: 1,
      depth: 0,
      fragmentCount: 0,
      stage: "planned",
      title: "Part I",
      tocPath: ["Part I"],
    },
    {
      chapterId: 2,
      childCount: 0,
      depth: 1,
      fragmentCount: 2,
      stage: "sourced",
      title: "Chapter 1",
      tocPath: ["Part I", "Chapter 1"],
    },
  ],
  loadConfigCalls: [] as unknown[],
  removeCalls: [] as unknown[],
  resetCalls: [] as unknown[],
  setSourceCalls: [] as Array<{
    readonly chapterId: number;
    readonly streamText: string;
  }>,
  setSummaryCalls: [] as unknown[],
  sourceFileStream: ["source file content"],
  stdinStream: ["stdin content"],
  textWrites: [] as string[],
}));

const chapterDetails = {
  chapterId: 2,
  childCount: 0,
  depth: 1,
  fragmentCount: 2,
  graphReady: false,
  hasSummary: false,
  stage: "sourced",
  title: "Chapter 1",
  tocPath: ["Part I", "Chapter 1"],
};

vi.mock("../../src/facade/spine-digest-file.js", () => ({
  SpineDigestFile: class {
    readonly #path: string;

    public constructor(path: string) {
      this.#path = path;
    }

    public async openEditableSession(
      operation: (document: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      chapterMockState.editableCalls.push(this.#path);
      return await operation({});
    }
  },
}));

vi.mock("../../src/facade/index.js", () => ({
  addChapter: vi.fn((_document: unknown, options: unknown) => {
    chapterMockState.addCalls.push(options);
    return Promise.resolve({
      ...chapterDetails,
      chapterId: 3,
      stage: "planned",
      title: "New Chapter",
    });
  }),
  generateChapterGraph: vi.fn(
    (_document: unknown, chapterId: number, options: unknown) => {
      chapterMockState.generatedGraphCalls.push({
        chapterId,
        options,
      });
      return Promise.resolve({
        ...chapterDetails,
        graphReady: true,
        stage: "graphed",
      });
    },
  ),
  generateChapterSummary: vi.fn(
    (_document: unknown, chapterId: number, options: unknown) => {
      chapterMockState.generatedSummaryCalls.push({
        chapterId,
        options,
      });
      return Promise.resolve({
        ...chapterDetails,
        graphReady: true,
        hasSummary: true,
        stage: "summarized",
      });
    },
  ),
  getChapterDetails: vi.fn(() => Promise.resolve(chapterDetails)),
  listChapters: vi.fn(() => Promise.resolve(chapterMockState.listEntries)),
  removeChapter: vi.fn(
    (_document: unknown, chapterId: number, options: unknown) => {
      chapterMockState.removeCalls.push({
        chapterId,
        options,
      });
      return Promise.resolve();
    },
  ),
  resetChapter: vi.fn(
    (_document: unknown, chapterId: number, stage: string) => {
      chapterMockState.resetCalls.push({
        chapterId,
        stage,
      });
      return Promise.resolve({
        ...chapterDetails,
        stage,
      });
    },
  ),
  setChapterSource: vi.fn(
    async (
      _document: unknown,
      chapterId: number,
      stream: AsyncIterable<string>,
    ) => {
      let streamText = "";

      for await (const chunk of stream) {
        streamText += chunk;
      }

      chapterMockState.setSourceCalls.push({
        chapterId,
        streamText,
      });
      return chapterDetails;
    },
  ),
  setChapterSummary: vi.fn(
    (_document: unknown, chapterId: number, summary: string) => {
      chapterMockState.setSummaryCalls.push({
        chapterId,
        summary,
      });
      return Promise.resolve({
        ...chapterDetails,
        hasSummary: true,
        stage: "summarized",
      });
    },
  ),
}));

vi.mock("../../src/cli/config.js", () => ({
  loadCLIConfig: vi.fn((options?: unknown) => {
    chapterMockState.loadConfigCalls.push(options);
    return Promise.resolve({
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
      prompt: "Config prompt",
    });
  }),
}));

vi.mock("../../src/cli/llm.js", () => ({
  buildLLMOptions: vi.fn(() => ({
    model: {},
  })),
}));

vi.mock("../../src/common/data-dir.js", () => ({
  resolveDataDirPath: vi.fn(() => "/tmp/data"),
}));

vi.mock("../../src/llm/index.js", () => ({
  LLM: class {
    public constructor(_options: unknown) {}
  },
}));

vi.mock("../../src/cli/io.js", () => ({
  readTextStreamFromStdin: vi.fn(() => chapterMockState.stdinStream),
  writeTextToStdout: vi.fn((text: string) => {
    chapterMockState.textWrites.push(text);
    return Promise.resolve();
  }),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(() => Promise.resolve(chapterMockState.inputFileContent)),
}));

vi.mock("fs", () => ({
  createReadStream: vi.fn(() => chapterMockState.sourceFileStream),
}));

import { runArchiveChapterCommand } from "../../src/cli/archive-chapter.js";

describe("cli/archive-chapter", () => {
  const originalStdinIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    chapterMockState.addCalls.length = 0;
    chapterMockState.editableCalls.length = 0;
    chapterMockState.generatedGraphCalls.length = 0;
    chapterMockState.generatedSummaryCalls.length = 0;
    chapterMockState.loadConfigCalls.length = 0;
    chapterMockState.removeCalls.length = 0;
    chapterMockState.resetCalls.length = 0;
    chapterMockState.setSourceCalls.length = 0;
    chapterMockState.setSummaryCalls.length = 0;
    chapterMockState.textWrites.length = 0;
    setStdinTTY(false);
  });

  afterEach(() => {
    setStdinTTY(originalStdinIsTTY);
  });

  it("prints chapter list with stages", async () => {
    await runArchiveChapterCommand({
      action: "list",
      path: "/tmp/book.sdpub",
    });

    expect(chapterMockState.editableCalls).toStrictEqual(["/tmp/book.sdpub"]);
    expect(chapterMockState.textWrites).toStrictEqual([
      "[1] planned    Part I\n  [2] sourced    Chapter 1\n",
    ]);
  });

  it("adds a chapter and prints the new chapter id", async () => {
    await runArchiveChapterCommand({
      action: "add",
      parentChapterId: 1,
      path: "/tmp/book.sdpub",
      title: "New Chapter",
    });

    expect(chapterMockState.addCalls).toStrictEqual([
      {
        parentChapterId: 1,
        title: "New Chapter",
      },
    ]);
    expect(chapterMockState.textWrites[0]).toContain("Chapter: 3\n");
  });

  it("reads source content from --input", async () => {
    await runArchiveChapterCommand({
      action: "set-source",
      chapterId: 2,
      inputFormat: "markdown",
      inputPath: "/tmp/chapter.md",
      path: "/tmp/book.sdpub",
    });

    expect(chapterMockState.setSourceCalls).toStrictEqual([
      {
        chapterId: 2,
        streamText: "source file content",
      },
    ]);
  });

  it("reads summary content from --input", async () => {
    await runArchiveChapterCommand({
      action: "set-summary",
      chapterId: 2,
      inputPath: "/tmp/summary.txt",
      path: "/tmp/book.sdpub",
    });

    expect(chapterMockState.setSummaryCalls).toStrictEqual([
      {
        chapterId: 2,
        summary: "file content",
      },
    ]);
  });

  it("passes prompt to generate-graph", async () => {
    await runArchiveChapterCommand({
      action: "generate-graph",
      chapterId: 2,
      path: "/tmp/book.sdpub",
      prompt: "CLI prompt",
    });

    expect(chapterMockState.generatedGraphCalls).toHaveLength(1);
    expect(chapterMockState.generatedGraphCalls[0]).toMatchObject({
      chapterId: 2,
      options: {
        extractionPrompt: "CLI prompt",
      },
    });
  });

  it("removes chapters recursively when requested", async () => {
    await runArchiveChapterCommand({
      action: "remove",
      chapterId: 1,
      path: "/tmp/book.sdpub",
      recursive: true,
    });

    expect(chapterMockState.removeCalls).toStrictEqual([
      {
        chapterId: 1,
        options: {
          recursive: true,
        },
      },
    ]);
    expect(chapterMockState.textWrites).toStrictEqual(["Removed chapter 1.\n"]);
  });
});

function setStdinTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });
}

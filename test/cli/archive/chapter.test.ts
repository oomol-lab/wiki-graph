import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as CLISupport from "../../../packages/cli/src/support/index.js";

const chapterMockState = vi.hoisted(() => ({
  activeConflictChecks: [] as unknown[],
  activeJobChecks: [] as unknown[],
  addCalls: [] as unknown[],
  readCalls: [] as string[],
  writeCalls: [] as string[],
  inputFileContent: "file content",
  moveCalls: [] as unknown[],
  treeApplyCalls: [] as unknown[],
  tree: {
    chapters: [
      {
        children: [
          {
            children: [],
            title: "Chapter 1",
            uri: "wikg://chapter/part-i/chapter-1",
          },
        ],
        title: "Part I",
        uri: "wikg://chapter/part-i",
      },
    ],
  },
  listEntries: [
    {
      chapterId: 1,
      childCount: 1,
      depth: 0,
      fragmentCount: 0,
      key: "part-i",
      path: "part-i",
      stage: "planned",
      title: "Part I",
      tocPath: ["Part I"],
      uri: "wikg://chapter/part-i",
    },
    {
      childCount: 0,
      depth: 1,
      fragmentCount: 2,
      key: "chapter-1",
      path: "part-i/chapter-1",
      stage: "sourced",
      title: "Chapter 1",
      tocPath: ["Part I", "Chapter 1"],
      uri: "wikg://chapter/part-i/chapter-1",
    },
  ],
  removeCalls: [] as unknown[],
  resetCalls: [] as unknown[],
  setSourceCalls: [] as Array<{
    readonly chapterId: number;
    readonly streamText: string;
  }>,
  setSummaryCalls: [] as unknown[],
  setTitleCalls: [] as unknown[],
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
  key: "chapter-1",
  path: "part-i/chapter-1",
  stage: "sourced",
  title: "Chapter 1",
  tocPath: ["Part I", "Chapter 1"],
  uri: "wikg://chapter/part-i/chapter-1",
};

vi.mock(
  "../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js",
  () => ({
    WikiGraphArchiveFile: class {
      readonly #path: string;

      public constructor(path: string) {
        this.#path = path;
      }

      public async readDocument(
        operation: (document: unknown) => Promise<unknown>,
      ): Promise<unknown> {
        chapterMockState.readCalls.push(this.#path);
        return await operation({});
      }

      public async write(
        operation: (document: unknown) => Promise<unknown>,
      ): Promise<unknown> {
        chapterMockState.writeCalls.push(this.#path);
        return await operation({});
      }
    },
  }),
);

vi.mock("../../../packages/core/src/api/index.js", () => ({
  addChapter: vi.fn((_document: unknown, options: unknown) => {
    chapterMockState.addCalls.push(options);
    return Promise.resolve({
      ...chapterDetails,
      chapterId: 3,
      stage: "planned",
      path: "new-chapter",
      title: "New Chapter",
      uri: "wikg://chapter/new-chapter",
    });
  }),
  assertNoActiveBuildJobs: vi.fn((input: unknown) => {
    chapterMockState.activeJobChecks.push(input);
    return Promise.resolve();
  }),
  assertNoActiveBuildJobConflicts: vi.fn((input: unknown) => {
    chapterMockState.activeConflictChecks.push(input);
    return Promise.resolve();
  }),
  getChapterDetails: vi.fn(() => Promise.resolve(chapterDetails)),
  getChapterTree: vi.fn(() => Promise.resolve(chapterMockState.tree)),
  listChapters: vi.fn(() => Promise.resolve(chapterMockState.listEntries)),
  moveChapter: vi.fn(
    (_document: unknown, chapterId: number, options: unknown) => {
      chapterMockState.moveCalls.push({
        chapterId,
        options,
      });
      return Promise.resolve(chapterDetails);
    },
  ),
  parseChapterTreeInput: vi.fn((input: unknown) => input),
  applyChapterTree: vi.fn(
    (_document: unknown, tree: unknown, options: unknown) => {
      chapterMockState.treeApplyCalls.push({
        options,
        tree,
      });
      return Promise.resolve({
        changed: true,
        moved: [
          {
            newIndex: 0,
            newParentUri: null,
            newPath: ["chapter-1"],
            newUri: "wikg://chapter/chapter-1",
            oldIndex: 0,
            oldParentUri: "wikg://chapter/part-i",
            oldPath: ["part-i", "chapter-1"],
            oldUri: "wikg://chapter/part-i/chapter-1",
          },
        ],
        renamed: [
          {
            uri: "wikg://chapter/part-i/chapter-1",
            newTitle: null,
            oldTitle: "Chapter 1",
          },
        ],
        unchanged: 1,
      });
    },
  ),
  removeChapter: vi.fn(
    (_document: unknown, chapterId: number, options: unknown) => {
      chapterMockState.removeCalls.push({
        chapterId,
        options,
      });
      return Promise.resolve();
    },
  ),
  resolveChapterPath: vi.fn((_document: unknown, chapterPath: string) => {
    const chapterIds = new Map<string, number>([
      ["part-i", 1],
      ["part-i/chapter-1", 2],
      ["new-chapter", 3],
    ]);

    return Promise.resolve(chapterIds.get(chapterPath));
  }),
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
      return {
        ...chapterDetails,
        chapterId,
        stage: "sourced",
      };
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
  setChapterTitle: vi.fn(
    (_document: unknown, chapterId: number, title: string | null) => {
      chapterMockState.setTitleCalls.push({
        chapterId,
        title,
      });
      return Promise.resolve({
        ...chapterDetails,
        title: title === null || title.trim() === "" ? null : title.trim(),
      });
    },
  ),
}));

vi.mock("../../../packages/core/src/runtime/common/data-dir.js", () => ({
  resolveDataDirPath: vi.fn(() => "/tmp/data"),
}));

vi.mock("../../../packages/core/src/external/llm/index.js", () => ({
  LLM: class {
    public constructor(_options: unknown) {}
  },
}));

vi.mock(
  "../../../packages/cli/src/support/index.js",
  async (importOriginal) => {
    const actual = await importOriginal<typeof CLISupport>();

    return {
      ...actual,
      readTextStreamFromStdin: vi.fn(() => chapterMockState.stdinStream),
      writeTextToStdout: vi.fn((text: string) => {
        chapterMockState.textWrites.push(text);
        return Promise.resolve();
      }),
    };
  },
);

vi.mock("fs/promises", () => ({
  readFile: vi.fn(() => Promise.resolve(chapterMockState.inputFileContent)),
}));

vi.mock("fs", () => ({
  createReadStream: vi.fn(() => chapterMockState.sourceFileStream),
}));

import { runArchiveChapterCommand } from "../../../packages/cli/src/commands/index.js";

describe("cli/archive-chapter", () => {
  const originalStdinIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    chapterMockState.activeConflictChecks.length = 0;
    chapterMockState.activeJobChecks.length = 0;
    chapterMockState.addCalls.length = 0;
    chapterMockState.readCalls.length = 0;
    chapterMockState.writeCalls.length = 0;
    chapterMockState.moveCalls.length = 0;
    chapterMockState.removeCalls.length = 0;
    chapterMockState.resetCalls.length = 0;
    chapterMockState.setSourceCalls.length = 0;
    chapterMockState.setSummaryCalls.length = 0;
    chapterMockState.setTitleCalls.length = 0;
    chapterMockState.treeApplyCalls.length = 0;
    chapterMockState.textWrites.length = 0;
    setStdinTTY(false);
  });

  afterEach(() => {
    setStdinTTY(originalStdinIsTTY);
  });

  it("prints chapter list with stages", async () => {
    await runArchiveChapterCommand({
      action: "list",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.readCalls).toStrictEqual(["/tmp/book.wikg"]);
    expect(chapterMockState.writeCalls).toStrictEqual([]);
    expect(chapterMockState.textWrites).toStrictEqual([
      "[planned] Part I (wikg://chapter/part-i)\n  [source] Chapter 1 (wikg://chapter/part-i/chapter-1)\n",
    ]);
  });

  it("prints chapter list as JSON", async () => {
    await runArchiveChapterCommand({
      action: "list",
      json: true,
      path: "/tmp/book.wikg",
    });

    expect(JSON.parse(chapterMockState.textWrites[0] ?? "")).toStrictEqual({
      chapters: [
        {
          stage: "planned",
          title: "Part I",
          uri: "wikg://chapter/part-i",
        },
        {
          stage: "source",
          title: "Chapter 1",
          uri: "wikg://chapter/part-i/chapter-1",
        },
      ],
    });
  });

  it("adds a chapter and prints the new chapter id", async () => {
    await runArchiveChapterCommand({
      action: "add",
      parentChapterPath: "part-i",
      path: "/tmp/book.wikg",
      title: "New Chapter",
    });

    expect(chapterMockState.addCalls).toStrictEqual([
      {
        parentChapterId: 1,
        title: "New Chapter",
      },
    ]);
    expect(chapterMockState.textWrites[0]).toContain(
      "Chapter: wikg://chapter/new-chapter\n",
    );
  });

  it("adds a chapter and prints JSON when requested", async () => {
    await runArchiveChapterCommand({
      action: "add",
      json: true,
      path: "/tmp/book.wikg",
      title: "New Chapter",
    });

    expect(JSON.parse(chapterMockState.textWrites[0] ?? "")).toStrictEqual({
      childCount: 0,
      graphReady: false,
      hasSummary: false,
      sourceUnits: 2,
      stage: "planned",
      title: "New Chapter",
      uri: "wikg://chapter/new-chapter",
    });
  });

  it("adds a sourced chapter from --input", async () => {
    await runArchiveChapterCommand({
      action: "add",
      inputPath: "/tmp/chapter.md",
      path: "/tmp/book.wikg",
      title: "New Chapter",
    });

    expect(chapterMockState.addCalls).toStrictEqual([
      {
        title: "New Chapter",
      },
    ]);
    expect(chapterMockState.setSourceCalls).toStrictEqual([
      {
        chapterId: 3,
        streamText: "file content",
      },
    ]);
    expect(chapterMockState.textWrites[0]).toContain("Stage: source\n");
  });

  it("adds a sourced chapter from stdin when --input is dash", async () => {
    await runArchiveChapterCommand({
      action: "add",
      inputPath: "-",
      path: "/tmp/book.wikg",
      title: "New Chapter",
    });

    expect(chapterMockState.setSourceCalls).toStrictEqual([
      {
        chapterId: 3,
        streamText: "stdin content",
      },
    ]);
    expect(chapterMockState.textWrites[0]).toContain("Stage: source\n");
  });

  it("reads source content from --input", async () => {
    await runArchiveChapterCommand({
      action: "set-source",
      chapterPath: "part-i/chapter-1",
      inputPath: "/tmp/chapter.md",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.setSourceCalls).toStrictEqual([
      {
        chapterId: 2,
        streamText: "file content",
      },
    ]);
  });

  it("reads source content from stdin when --input is dash", async () => {
    await runArchiveChapterCommand({
      action: "set-source",
      chapterPath: "part-i/chapter-1",
      inputPath: "-",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.setSourceCalls).toStrictEqual([
      {
        chapterId: 2,
        streamText: "stdin content",
      },
    ]);
  });

  it("reads source content from a positional value", async () => {
    await runArchiveChapterCommand({
      action: "set-source",
      chapterPath: "part-i/chapter-1",
      inputValue: "inline source",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.setSourceCalls).toStrictEqual([
      {
        chapterId: 2,
        streamText: "inline source",
      },
    ]);
  });

  it("rejects missing source input without reading implicit stdin", async () => {
    await expect(
      runArchiveChapterCommand({
        action: "set-source",
        chapterPath: "part-i/chapter-1",
        path: "/tmp/book.wikg",
      }),
    ).rejects.toThrow(
      "Missing input. Pass a positional value, use --input <path>, or use --input - for stdin.",
    );

    expect(chapterMockState.setSourceCalls).toStrictEqual([]);
  });

  it("reads summary content from --input", async () => {
    await runArchiveChapterCommand({
      action: "set-summary",
      chapterPath: "part-i/chapter-1",
      inputPath: "/tmp/summary.txt",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.setSummaryCalls).toStrictEqual([
      {
        chapterId: 2,
        summary: "file content",
      },
    ]);
  });

  it("reads summary content from stdin when --input is dash", async () => {
    await runArchiveChapterCommand({
      action: "set-summary",
      chapterPath: "part-i/chapter-1",
      inputPath: "-",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.setSummaryCalls).toStrictEqual([
      {
        chapterId: 2,
        summary: "stdin content",
      },
    ]);
  });

  it("reads summary content from a positional value", async () => {
    await runArchiveChapterCommand({
      action: "set-summary",
      chapterPath: "part-i/chapter-1",
      inputValue: "inline summary",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.setSummaryCalls).toStrictEqual([
      {
        chapterId: 2,
        summary: "inline summary",
      },
    ]);
  });

  it("rejects missing summary input without reading implicit stdin", async () => {
    await expect(
      runArchiveChapterCommand({
        action: "set-summary",
        chapterPath: "part-i/chapter-1",
        path: "/tmp/book.wikg",
      }),
    ).rejects.toThrow(
      "Missing input. Pass a positional value, use --input <path>, or use --input - for stdin.",
    );

    expect(chapterMockState.setSummaryCalls).toStrictEqual([]);
  });

  it("prints summary set result as JSON when requested", async () => {
    await runArchiveChapterCommand({
      action: "set-summary",
      chapterPath: "part-i/chapter-1",
      inputValue: "inline summary",
      json: true,
      path: "/tmp/book.wikg",
    });

    expect(JSON.parse(chapterMockState.textWrites[0] ?? "")).toStrictEqual({
      childCount: 0,
      graphReady: false,
      hasSummary: true,
      sourceUnits: 2,
      stage: "reading-summary",
      title: "Chapter 1",
      uri: "wikg://chapter/part-i/chapter-1",
    });
  });

  it("sets a chapter title", async () => {
    await runArchiveChapterCommand({
      action: "set-title",
      chapterPath: "part-i/chapter-1",
      path: "/tmp/book.wikg",
      title: "Renamed Chapter",
    });

    expect(chapterMockState.setTitleCalls).toStrictEqual([
      {
        chapterId: 2,
        title: "Renamed Chapter",
      },
    ]);
    expect(chapterMockState.textWrites[0]).toContain("Title: Renamed Chapter");
  });

  it("clears a chapter title", async () => {
    await runArchiveChapterCommand({
      action: "set-title",
      chapterPath: "part-i/chapter-1",
      clearTitle: true,
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.activeJobChecks).toStrictEqual([
      {
        archivePath: "/tmp/book.wikg",
        chapterIds: [2],
        operation: "Setting chapter title",
      },
    ]);
    expect(chapterMockState.setTitleCalls).toStrictEqual([
      {
        chapterId: 2,
        title: null,
      },
    ]);
  });

  it("moves a chapter", async () => {
    await runArchiveChapterCommand({
      action: "move",
      chapterPath: "part-i/chapter-1",
      first: true,
      parentChapterPath: "part-i",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.activeConflictChecks).toStrictEqual([
      {
        archivePath: "/tmp/book.wikg",
        operation: "Moving chapter",
        scope: { kind: "archive" },
      },
    ]);
    expect(chapterMockState.moveCalls).toStrictEqual([
      {
        chapterId: 2,
        options: {
          first: true,
          parentChapterId: 1,
        },
      },
    ]);
    expect(chapterMockState.textWrites[0]).toContain(
      "Chapter: wikg://chapter/part-i/chapter-1\n",
    );
  });

  it("prints and applies chapter trees", async () => {
    await runArchiveChapterCommand({
      action: "tree",
      path: "/tmp/book.wikg",
      treeAction: "show",
    });

    expect(chapterMockState.textWrites[0]).toBe(
      ["└─ Part I (part-i)", "   └─ Chapter 1 (chapter-1)", ""].join("\n"),
    );

    await runArchiveChapterCommand({
      action: "tree",
      json: true,
      path: "/tmp/book.wikg",
      treeAction: "show",
    });

    expect(chapterMockState.textWrites.at(-1)).toContain('"title": "Part I"');

    chapterMockState.inputFileContent = JSON.stringify({
      chapters: [
        {
          children: [],
          uri: "wikg://chapter/part-i/chapter-1",
          title: null,
        },
        {
          children: [],
          uri: "wikg://chapter/part-i",
        },
      ],
    });
    await runArchiveChapterCommand({
      action: "tree",
      dryRun: true,
      inputPath: "/tmp/tree.json",
      path: "/tmp/book.wikg",
      treeAction: "apply",
    });

    expect(chapterMockState.treeApplyCalls).toStrictEqual([
      {
        options: {
          dryRun: true,
        },
        tree: {
          chapters: [
            {
              children: [],
              uri: "wikg://chapter/part-i/chapter-1",
              title: null,
            },
            {
              children: [],
              uri: "wikg://chapter/part-i",
            },
          ],
        },
      },
    ]);
    expect(chapterMockState.textWrites.at(-1)).toContain(
      "Dry run: chapter tree not changed.",
    );
    expect(chapterMockState.activeConflictChecks).toStrictEqual([]);
  });

  it("applies chapter tree from stdin when --input is dash", async () => {
    chapterMockState.stdinStream = [
      JSON.stringify({
        chapters: [
          {
            children: [],
            title: "Chapter 1",
            uri: "wikg://chapter/part-i/chapter-1",
          },
        ],
      }),
    ];

    await runArchiveChapterCommand({
      action: "tree",
      inputPath: "-",
      path: "/tmp/book.wikg",
      treeAction: "apply",
    });

    expect(chapterMockState.treeApplyCalls).toStrictEqual([
      {
        options: {
          dryRun: false,
        },
        tree: {
          chapters: [
            {
              children: [],
              uri: "wikg://chapter/part-i/chapter-1",
              title: "Chapter 1",
            },
          ],
        },
      },
    ]);
  });

  it("rejects missing chapter tree input without reading implicit stdin", async () => {
    await expect(
      runArchiveChapterCommand({
        action: "tree",
        path: "/tmp/book.wikg",
        treeAction: "apply",
      }),
    ).rejects.toThrow(
      "Missing input. Pass a positional value, use --input <path>, or use --input - for stdin.",
    );

    expect(chapterMockState.treeApplyCalls).toStrictEqual([]);
  });

  it("removes chapters recursively when requested", async () => {
    await runArchiveChapterCommand({
      action: "remove",
      chapterPath: "part-i",
      path: "/tmp/book.wikg",
      recursive: true,
    });

    expect(chapterMockState.activeConflictChecks).toStrictEqual([
      {
        archivePath: "/tmp/book.wikg",
        operation: "Removing chapter",
        scope: { kind: "archive" },
      },
    ]);
    expect(chapterMockState.removeCalls).toStrictEqual([
      {
        chapterId: 1,
        options: {
          recursive: true,
        },
      },
    ]);
    expect(chapterMockState.textWrites).toStrictEqual([
      "Removed chapter wikg://chapter/part-i.\n",
    ]);
  });
});

function setStdinTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });
}

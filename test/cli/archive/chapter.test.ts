import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as CLIQueueAdd from "../../../packages/cli/src/commands/queue/add.js";
import type * as CLISupport from "../../../packages/cli/src/support/index.js";
import { NodeFile } from "../../../packages/cli/src/runtime/node-platform.js";
import type * as Core from "wiki-graph-core";
vi.mock("wiki-graph-core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  ensureWikiGraphArchiveSchemaCurrent: vi.fn(() => Promise.resolve()),
}));

const chapterMockState = vi.hoisted(() => ({
  activeConflictChecks: [] as unknown[],
  activeJobChecks: [] as unknown[],
  addCalls: [] as unknown[],
  buildJobCalls: [] as unknown[],
  readCalls: [] as string[],
  writeCalls: [] as string[],
  inputFileContent: "file content",
  moveCalls: [] as unknown[],
  treeApplyCalls: [] as unknown[],
  workerStartCalls: 0,
  tree: {
    chapters: [
      {
        children: [
          {
            children: [],
            title: "Chapter 1",
            uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
          },
        ],
        title: "Part I",
        uri: "wikg://chapter/a1b2c3d4e5f6",
      },
    ],
  },
  listEntries: [
    {
      chapterId: 1,
      childCount: 1,
      depth: 0,
      fragmentCount: 0,
      key: "a1b2c3d4e5f6",
      path: "a1b2c3d4e5f6",
      stage: "planned",
      title: "Part I",
      tocPath: ["Part I"],
      uri: "wikg://chapter/a1b2c3d4e5f6",
    },
    {
      chapterId: 2,
      childCount: 0,
      depth: 1,
      fragmentCount: 2,
      key: "b2c3d4e5f6a1",
      path: "a1b2c3d4e5f6/b2c3d4e5f6a1",
      stage: "sourced",
      title: "Chapter 1",
      tocPath: ["Part I", "Chapter 1"],
      uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
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
  key: "b2c3d4e5f6a1",
  path: "a1b2c3d4e5f6/b2c3d4e5f6a1",
  stage: "sourced",
  title: "Chapter 1",
  tocPath: ["Part I", "Chapter 1"],
  uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
};

vi.mock(
  "../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js",
  () => ({
    WikiGraphArchiveFile: class {
      readonly #path: string;

      public constructor(path: string | { readonly path: string }) {
        this.#path = typeof path === "string" ? path : path.path;
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

vi.mock(
  "../../../packages/cli/src/commands/queue/add.js",
  async (importOriginal) => {
    const actual = await importOriginal<typeof CLIQueueAdd>();

    return {
      ...actual,
      tryStartQueueWorker: vi.fn(() => {
        chapterMockState.workerStartCalls += 1;
      }),
    };
  },
);

vi.mock("../../../packages/core/src/api/index.js", () => ({
  addChapter: vi.fn((_document: unknown, options: unknown) => {
    chapterMockState.addCalls.push(options);
    return Promise.resolve({
      ...chapterDetails,
      chapterId: 3,
      stage: "planned",
      path: "c3d4e5f6a1b2",
      title: "New Chapter",
      uri: "wikg://chapter/c3d4e5f6a1b2",
    });
  }),
  addBuildJob: vi.fn((options: unknown) => {
    chapterMockState.buildJobCalls.push(options);
    return Promise.resolve({
      ...(typeof options === "object" && options !== null ? options : {}),
      jobId: "job-index-1",
      state: "queued",
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
            newPath: ["b2c3d4e5f6a1"],
            newUri: "wikg://chapter/b2c3d4e5f6a1",
            oldIndex: 0,
            oldParentUri: "wikg://chapter/a1b2c3d4e5f6",
            oldPath: ["a1b2c3d4e5f6", "b2c3d4e5f6a1"],
            oldUri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
          },
        ],
        renamed: [
          {
            uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
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
      ["a1b2c3d4e5f6", 1],
      ["a1b2c3d4e5f6/b2c3d4e5f6a1", 2],
      ["c3d4e5f6a1b2", 3],
    ]);

    return Promise.resolve(chapterIds.get(chapterPath));
  }),
  resolveChapterPathReadonly: vi.fn(
    (_document: unknown, chapterPath: string) => {
      const chapterIds = new Map<string, number>([
        ["a1b2c3d4e5f6", 1],
        ["a1b2c3d4e5f6/b2c3d4e5f6a1", 2],
        ["c3d4e5f6a1b2", 3],
      ]);

      return Promise.resolve(chapterIds.get(chapterPath));
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
  realpath: vi.fn((path: string) => Promise.resolve(path)),
  stat: vi.fn(() =>
    Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
  ),
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
    chapterMockState.buildJobCalls.length = 0;
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
    chapterMockState.workerStartCalls = 0;
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
      "[planned] Part I (wikg://chapter/a1b2c3d4e5f6)\n  [source] Chapter 1 (wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1)\n",
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
          uri: "wikg://chapter/a1b2c3d4e5f6",
        },
        {
          stage: "source",
          title: "Chapter 1",
          uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
        },
      ],
    });
  });

  it("adds a chapter and prints the new chapter id", async () => {
    await runArchiveChapterCommand({
      action: "add",
      parentChapterPath: "a1b2c3d4e5f6",
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
      "Chapter: wikg://chapter/c3d4e5f6a1b2\n",
    );
    expect(chapterMockState.textWrites[0]).toContain(
      "Located URI: wikg:///tmp/book.wikg/chapter/c3d4e5f6a1b2\n",
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
      locatedUri: "wikg:///tmp/book.wikg/chapter/c3d4e5f6a1b2",
      sourceUnits: 2,
      stage: "planned",
      title: "New Chapter",
      uri: "wikg://chapter/c3d4e5f6a1b2",
    });
  });

  it("queues a chapter index artifact build job", async () => {
    await runArchiveChapterCommand({
      action: "build-index-artifact",
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
      indexArtifactKind: "embedding-source",
      indexArtifactTarget: "index-embedding-source",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.buildJobCalls).toStrictEqual([
      {
        archive: new NodeFile("/tmp/book.wikg"),
        chapterId: 2,
        target: "index-embedding-source",
      },
    ]);
    expect(chapterMockState.textWrites).toStrictEqual([
      [
        'Job job-index-1 queued index-embedding-source chapter "Chapter 1" (wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1)',
        "Chapter URI: wikg:///tmp/book.wikg/chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
        "Job is queued; the requested artifact or generated data is not ready until the job succeeds.",
        "Watch: wg wikg://local/job/job-index-1 watch",
        "",
      ].join("\n"),
    ]);
    expect(chapterMockState.workerStartCalls).toBe(1);
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
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
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
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
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
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
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
        chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
        path: "/tmp/book.wikg",
      }),
    ).rejects.toThrow(
      "Missing input. Pass a positional value, use --input <path>, or use --input - for stdin.",
    );

    expect(chapterMockState.setSourceCalls).toStrictEqual([]);
  });

  it("explains every supported source input when source text is empty", async () => {
    await expect(
      runArchiveChapterCommand({
        action: "set-source",
        chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
        inputValue: "  \n",
        path: "/tmp/book.wikg",
      }),
    ).rejects.toThrow(
      "Source input is empty. Pass non-empty positional text, use --input <path>, or use --input - for stdin.",
    );

    expect(chapterMockState.setSourceCalls).toStrictEqual([]);
  });

  it("reads summary content from --input", async () => {
    await runArchiveChapterCommand({
      action: "set-summary",
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
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
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
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
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
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
        chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
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
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
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
      uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
    });
  });

  it("sets a chapter title", async () => {
    await runArchiveChapterCommand({
      action: "set-title",
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
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
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
      clearTitle: true,
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.activeJobChecks).toStrictEqual([
      {
        archive: new NodeFile("/tmp/book.wikg"),
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
      chapterPath: "a1b2c3d4e5f6/b2c3d4e5f6a1",
      first: true,
      parentChapterPath: "a1b2c3d4e5f6",
      path: "/tmp/book.wikg",
    });

    expect(chapterMockState.activeConflictChecks).toStrictEqual([
      {
        archive: new NodeFile("/tmp/book.wikg"),
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
      "Chapter: wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1\n",
    );
  });

  it("prints and applies chapter trees", async () => {
    await runArchiveChapterCommand({
      action: "tree",
      path: "/tmp/book.wikg",
      treeAction: "show",
    });

    expect(chapterMockState.textWrites[0]).toBe(
      ["└─ Part I (a1b2c3d4e5f6)", "   └─ Chapter 1 (b2c3d4e5f6a1)", ""].join(
        "\n",
      ),
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
          uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
          title: null,
        },
        {
          children: [],
          uri: "wikg://chapter/a1b2c3d4e5f6",
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
              uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
              title: null,
            },
            {
              children: [],
              uri: "wikg://chapter/a1b2c3d4e5f6",
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
            uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
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
              uri: "wikg://chapter/a1b2c3d4e5f6/b2c3d4e5f6a1",
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
      chapterPath: "a1b2c3d4e5f6",
      path: "/tmp/book.wikg",
      recursive: true,
    });

    expect(chapterMockState.activeConflictChecks).toStrictEqual([
      {
        archive: new NodeFile("/tmp/book.wikg"),
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
      "Removed chapter wikg://chapter/a1b2c3d4e5f6.\n",
    ]);
  });
});

function setStdinTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });
}

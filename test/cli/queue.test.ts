import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queueMockState = vi.hoisted(() => ({
  activeError: undefined as Error | undefined,
  activeJobChecks: [] as unknown[],
  addCalls: [] as unknown[],
  buildGraphCalls: [] as unknown[],
  buildKnowledgeGraphCalls: [] as unknown[],
  buildSummaryCalls: [] as unknown[],
  chapterStage: "sourced" as "planned" | "sourced" | "graphed" | "summarized",
  chapters: [] as Array<{
    readonly chapterId: number;
    readonly stage: "planned" | "sourced" | "graphed" | "summarized";
    readonly words: number;
  }>,
  commitGraphCalls: [] as unknown[],
  commitKnowledgeGraphCalls: [] as unknown[],
  commitSummaryCalls: [] as unknown[],
  createStageLLMCalls: [] as unknown[],
  inputRevisionAssertions: [] as unknown[],
  inputRevisionRecords: [] as unknown[],
  cliConfig: {} as {
    readonly concurrent?: {
      readonly job?: number;
      readonly request?: number;
    };
    readonly wikispine?: {
      readonly command?: string;
      readonly dataDir?: string;
      readonly endpoint?: string;
      readonly provider?: "cli" | "fetch";
    };
  },
  loadRequiredStageConfigCalls: [] as unknown[],
  loadRequiredStageConfigError: undefined as Error | undefined,
  revision: 1,
  events: [] as unknown[],
  getJobIds: [] as string[],
  jobs: [] as unknown[],
  buildInputStage: "sourced" as
    | "planned"
    | "sourced"
    | "graphed"
    | "summarized",
  job: {
    archivePath: "book.wikg",
    cachePath: "/tmp/job-cache",
    chapterId: 12,
    eventsPath: "events.ndjson",
    jobId: "job-1",
    logPath: "/tmp/job-logs",
    state: "succeeded",
    target: "reading-summary",
    workspacePath: "/tmp/job-workspace",
  } as Record<string, unknown>,
  readDocumentCalls: [] as string[],
  readChapterStageError: undefined as Error | undefined,
  openPaths: [] as string[],
  resolveJobIds: [] as string[],
  runWorkerOptions: undefined as
    | {
        readonly concurrency: number;
        readonly executeJob: (job: unknown, reporter: unknown) => Promise<void>;
      }
    | undefined,
  stepLog: [] as string[],
  textWrites: [] as string[],
  writeCalls: [] as string[],
}));

vi.mock("../../packages/core/src/wikg/wiki-graph-archive-file.js", () => ({
  WikiGraphArchiveFile: class {
    readonly #path: string;

    public constructor(path: string) {
      this.#path = path;
    }

    public async read(
      operation: (digest: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      queueMockState.openPaths.push(this.#path);
      return await operation({
        readChapterStage: () => {
          if (queueMockState.readChapterStageError !== undefined) {
            throw queueMockState.readChapterStageError;
          }

          return Promise.resolve(queueMockState.chapterStage);
        },
      });
    }

    public async readDocument(
      operation: (document: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      queueMockState.readDocumentCalls.push(this.#path);
      queueMockState.stepLog.push("read:start");
      try {
        return await operation({
          serials: {
            getRevision: () => Promise.resolve(queueMockState.revision),
          },
        });
      } finally {
        queueMockState.stepLog.push("read:end");
      }
    }

    public async write(
      operation: (document: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      queueMockState.writeCalls.push(this.#path);
      queueMockState.stepLog.push("write:start");
      try {
        return await operation({
          serials: {
            getRevision: () => Promise.resolve(queueMockState.revision),
          },
        });
      } finally {
        queueMockState.stepLog.push("write:end");
      }
    }
  },
}));

vi.mock("../../packages/core/src/facade/index.js", () => ({
  addBuildJob: vi.fn((options: unknown) => {
    queueMockState.addCalls.push(options);
    return Promise.resolve({
      archivePath: "book.wikg",
      chapterId: 12,
      jobId: "job-1",
      state: "queued",
      target: "reading-summary",
    });
  }),
  assertNoActiveBuildJobs: vi.fn((input: unknown) => {
    queueMockState.activeJobChecks.push(input);
    if (queueMockState.activeError !== undefined) {
      throw queueMockState.activeError;
    }
    return Promise.resolve();
  }),
  assertBuildJobInputRevision: vi.fn((input: unknown) => {
    queueMockState.inputRevisionAssertions.push(input);
    return Promise.resolve();
  }),
  boostBuildJob: vi.fn(),
  buildChapterGraphArtifact: vi.fn((_chapterId: number, options: unknown) => {
    queueMockState.stepLog.push("build-graph");
    queueMockState.buildGraphCalls.push(options);
    return Promise.resolve({
      chapterId: 12,
      documentPath: "/tmp/job-workspace/graph-document",
    });
  }),
  buildChapterSummaryArtifactFromSnapshot: vi.fn(
    (_chapterId: number, options: unknown) => {
      queueMockState.stepLog.push("build-summary");
      queueMockState.buildSummaryCalls.push(options);
      return Promise.resolve("summary text");
    },
  ),
  cancelBuildJob: vi.fn(),
  cleanBuildJobs: vi.fn(),
  commitChapterGraphArtifact: vi.fn(() => {
    queueMockState.stepLog.push("commit-graph");
    queueMockState.commitGraphCalls.push({});
    queueMockState.buildInputStage = "graphed";
    queueMockState.revision = 2;
    return Promise.resolve({
      chapterId: 12,
      stage: "graphed",
      words: 4,
    });
  }),
  commitChapterKnowledgeGraphArtifact: vi.fn(
    (_document: unknown, artifact: unknown) => {
      queueMockState.stepLog.push("commit-knowledge-graph");
      queueMockState.commitKnowledgeGraphCalls.push(artifact);
      return Promise.resolve({
        chapterId: 12,
        mentionLinks: 0,
        mentions: 2,
      });
    },
  ),
  commitChapterSummaryArtifact: vi.fn(() => {
    queueMockState.stepLog.push("commit-summary");
    queueMockState.commitSummaryCalls.push({});
    queueMockState.revision = 3;
    return Promise.resolve({
      chapterId: 12,
      stage: "summarized",
      words: 4,
    });
  }),
  getBuildJob: vi.fn((jobId: string) => {
    queueMockState.getJobIds.push(jobId);
    return Promise.resolve(queueMockState.job);
  }),
  generateChapterKnowledgeGraphArtifactFromSnapshot: vi.fn(
    (_chapterId: number, _snapshot: unknown, options: unknown) => {
      queueMockState.stepLog.push("build-knowledge-graph");
      queueMockState.buildKnowledgeGraphCalls.push(options);
      return Promise.resolve({
        chapterId: 12,
        manifestPath: "/tmp/job-workspace/knowledge-graph/manifest.json",
      });
    },
  ),
  listBuildJobs: vi.fn(() => Promise.resolve(queueMockState.jobs)),
  listChapters: vi.fn(() => Promise.resolve(queueMockState.chapters)),
  pauseBuildJob: vi.fn(),
  readBuildJobEvents: vi.fn(() => Promise.resolve(queueMockState.events)),
  recordBuildJobInputRevision: vi.fn((input: unknown) => {
    queueMockState.inputRevisionRecords.push(input);
    return Promise.resolve(queueMockState.job);
  }),
  resolveBuildJobId: vi.fn((jobId: string) => {
    queueMockState.resolveJobIds.push(jobId);
    return Promise.resolve(jobId === "job-1-short" ? "job-1-full" : jobId);
  }),
  resumeBuildJob: vi.fn(),
  runBuildJobWorker: vi.fn(
    (options: typeof queueMockState.runWorkerOptions) => {
      queueMockState.runWorkerOptions = options;
      return Promise.resolve();
    },
  ),
  readChapterBuildInput: vi.fn(() =>
    Promise.resolve({
      details: {
        chapterId: 12,
        stage: queueMockState.buildInputStage,
        words: 4,
      },
      revision: queueMockState.revision,
      sourceText: ["Alpha beta."],
    }),
  ),
  snapshotChapterKnowledgeGraphInput: vi.fn(() => {
    queueMockState.stepLog.push("snapshot-knowledge-graph");
    return Promise.resolve({
      details: {
        chapterId: 12,
        stage: "sourced",
      },
      fragments: [],
    });
  }),
  snapshotChapterSummaryInput: vi.fn(() => {
    queueMockState.stepLog.push("snapshot-summary");
    return Promise.resolve({
      filePath: "/tmp/job-workspace/summary-input.json",
    });
  }),
  updateBuildJobTarget: vi.fn(),
}));

vi.mock("../../packages/cli/src/cli/io.js", () => ({
  writeTextToStdout: vi.fn((text: string) => {
    queueMockState.textWrites.push(text);
    return Promise.resolve();
  }),
}));

vi.mock("../../packages/cli/src/cli/config.js", () => ({
  loadCLIConfig: vi.fn(() => Promise.resolve(queueMockState.cliConfig)),
}));

vi.mock("../../packages/cli/src/cli/stage-runtime.js", () => ({
  createStageLLM: vi.fn((_config: unknown, options: unknown) => {
    queueMockState.createStageLLMCalls.push(options);
    return {};
  }),
  loadRequiredStageConfig: vi.fn((options: unknown) => {
    queueMockState.loadRequiredStageConfigCalls.push(options);
    if (queueMockState.loadRequiredStageConfigError !== undefined) {
      return Promise.reject(queueMockState.loadRequiredStageConfigError);
    }

    return Promise.resolve({
      ...queueMockState.cliConfig,
      prompt: "Keep key beats",
    });
  }),
  resolveExtractionPrompt: vi.fn((prompt: string | undefined) => prompt ?? ""),
  resolveKnowledgeGraphRecallPrompt: vi.fn(
    (prompt: string | undefined) => prompt ?? "Default KG recall",
  ),
}));

import {
  runQueueCommand,
  runQueueWorker,
} from "../../packages/cli/src/cli/commands/index.js";

describe("cli/queue", () => {
  const originalDisableAutostart =
    process.env.WIKIGRAPH_QUEUE_DISABLE_AUTOSTART;

  beforeEach(() => {
    queueMockState.activeError = undefined;
    queueMockState.activeJobChecks.length = 0;
    queueMockState.addCalls.length = 0;
    queueMockState.buildGraphCalls.length = 0;
    queueMockState.buildKnowledgeGraphCalls.length = 0;
    queueMockState.buildSummaryCalls.length = 0;
    queueMockState.buildInputStage = "sourced";
    queueMockState.chapterStage = "sourced";
    queueMockState.chapters = [];
    queueMockState.commitGraphCalls.length = 0;
    queueMockState.commitKnowledgeGraphCalls.length = 0;
    queueMockState.commitSummaryCalls.length = 0;
    queueMockState.createStageLLMCalls.length = 0;
    queueMockState.events = [];
    queueMockState.getJobIds.length = 0;
    queueMockState.inputRevisionAssertions.length = 0;
    queueMockState.inputRevisionRecords.length = 0;
    queueMockState.cliConfig = {};
    queueMockState.loadRequiredStageConfigCalls.length = 0;
    queueMockState.loadRequiredStageConfigError = undefined;
    queueMockState.jobs = [];
    queueMockState.job = {
      archiveKey: "archive-key",
      archivePath: "book.wikg",
      cachePath: "/tmp/job-cache",
      chapterId: 12,
      createdAt: 1,
      eventsPath: "events.ndjson",
      jobId: "job-1",
      logPath: "/tmp/job-logs",
      ownerId: "owner-1",
      queueRank: 10,
      state: "succeeded",
      target: "reading-summary",
      updatedAt: 2,
      workspacePath: "/tmp/job-workspace",
    };
    queueMockState.openPaths.length = 0;
    queueMockState.readDocumentCalls.length = 0;
    queueMockState.readChapterStageError = undefined;
    queueMockState.revision = 1;
    queueMockState.resolveJobIds.length = 0;
    queueMockState.runWorkerOptions = undefined;
    queueMockState.stepLog.length = 0;
    queueMockState.textWrites.length = 0;
    queueMockState.writeCalls.length = 0;
    queueMockState.chapters = [
      {
        chapterId: 12,
        stage: "sourced",
        words: 800,
      },
    ];
    process.env.WIKIGRAPH_QUEUE_DISABLE_AUTOSTART = "1";
  });

  afterEach(() => {
    if (originalDisableAutostart === undefined) {
      delete process.env.WIKIGRAPH_QUEUE_DISABLE_AUTOSTART;
      return;
    }

    process.env.WIKIGRAPH_QUEUE_DISABLE_AUTOSTART = originalDisableAutostart;
  });

  it("checks archive source before the cost gate", async () => {
    await expect(
      runQueueCommand({
        action: "add",
        archivePath: "book.wikg",
        chapterId: 12,
        target: "reading-summary",
      }),
    ).rejects.toThrow("consume tokens");

    expect(queueMockState.openPaths).toStrictEqual(["book.wikg"]);
    expect(queueMockState.activeJobChecks).toStrictEqual([]);
    expect(queueMockState.addCalls).toStrictEqual([]);
  });

  it("reports missing chapters before the cost gate", async () => {
    queueMockState.readChapterStageError = new Error(
      "Chapter 12 does not exist",
    );

    await expect(
      runQueueCommand({
        action: "add",
        archivePath: "book.wikg",
        chapterId: 12,
        target: "reading-summary",
      }),
    ).rejects.toThrow("Chapter 12 does not exist");

    expect(queueMockState.activeJobChecks).toStrictEqual([]);
    expect(queueMockState.addCalls).toStrictEqual([]);
  });

  it("reports planned chapters before the cost gate", async () => {
    queueMockState.chapterStage = "planned";

    await expect(
      runQueueCommand({
        action: "add",
        archivePath: "book.wikg",
        chapterId: 12,
        target: "reading-summary",
      }),
    ).rejects.toThrow("Set source before queueing");

    expect(queueMockState.activeJobChecks).toStrictEqual([]);
    expect(queueMockState.addCalls).toStrictEqual([]);
  });

  it("adds a job after the cost is accepted", async () => {
    await runQueueCommand({
      acceptCost: true,
      action: "add",
      archivePath: "book.wikg",
      boost: true,
      chapterId: 12,
      target: "reading-graph",
    });

    expect(queueMockState.addCalls).toStrictEqual([
      {
        archivePath: "book.wikg",
        boost: true,
        chapterId: 12,
        target: "reading-graph",
      },
    ]);
    expect(queueMockState.loadRequiredStageConfigCalls).toStrictEqual([{}]);
    expect(queueMockState.textWrites.join("")).toContain("Job job-1 queued");
    expect(queueMockState.textWrites.join("")).toContain("Estimate:");
    expect(queueMockState.textWrites.join("")).toContain(
      "Work: reading-graph over 1 chapter / 800 words",
    );
    expect(queueMockState.textWrites.join("")).toContain(
      "Current concurrency: job=3 request=6",
    );
    expect(queueMockState.textWrites.join("")).toContain(
      "Watch: wg wikg://local/job/job-1 watch",
    );
  });

  it("prints a created chapter job as json", async () => {
    await runQueueCommand({
      acceptCost: true,
      action: "add",
      archivePath: "book.wikg",
      chapterId: 12,
      json: true,
      target: "reading-graph",
    });

    expect(JSON.parse(queueMockState.textWrites.join(""))).toMatchObject({
      archivePath: "book.wikg",
      chapterId: 12,
      estimate: {
        chapters: 1,
        concurrent: {
          job: 3,
          request: 6,
        },
        target: "reading-graph",
        words: 800,
      },
      jobId: "job-1",
      state: "queued",
      target: "reading-summary",
      watchCommand: "wg wikg://local/job/job-1 watch",
    });
  });

  it("prints archive job add results as json", async () => {
    queueMockState.chapters = [
      {
        chapterId: 11,
        stage: "planned",
        words: 0,
      },
      {
        chapterId: 12,
        stage: "sourced",
        words: 800,
      },
    ];

    await runQueueCommand({
      acceptCost: true,
      action: "add",
      archivePath: "book.wikg",
      json: true,
      target: "reading-graph",
    });

    expect(JSON.parse(queueMockState.textWrites.join(""))).toMatchObject({
      created: [
        {
          archivePath: "book.wikg",
          chapterId: 12,
          jobId: "job-1",
          state: "queued",
        },
      ],
      estimate: {
        chapters: 1,
        target: "reading-graph",
        words: 800,
      },
      skipped: [
        {
          chapterId: 11,
          reason: "planned",
        },
      ],
    });
  });

  it("suggests job concurrency for multi-chapter archive job add", async () => {
    queueMockState.chapters = [
      {
        chapterId: 11,
        stage: "sourced",
        words: 400,
      },
      {
        chapterId: 12,
        stage: "graphed",
        words: 800,
      },
    ];

    await runQueueCommand({
      acceptCost: true,
      action: "add",
      archivePath: "book.wikg",
      target: "reading-summary",
    });

    expect(queueMockState.textWrites.join("")).toContain("Created: 2");
    expect(queueMockState.textWrites.join("")).toContain(
      "Work: reading-summary over 2 chapters / 1200 words",
    );
    expect(queueMockState.textWrites.join("")).toContain(
      "Includes prerequisite Reading Graph work where missing.",
    );
    expect(queueMockState.textWrites.join("")).toContain(
      "Command: wg wikg://local/config/concurrent put job 4",
    );
  });

  it("includes prerequisite work in archive job add json estimates", async () => {
    queueMockState.chapters = [
      {
        chapterId: 11,
        stage: "sourced",
        words: 400,
      },
      {
        chapterId: 12,
        stage: "graphed",
        words: 800,
      },
    ];

    await runQueueCommand({
      acceptCost: true,
      action: "add",
      archivePath: "book.wikg",
      json: true,
      target: "reading-summary",
    });

    expect(JSON.parse(queueMockState.textWrites.join(""))).toMatchObject({
      estimate: {
        includesPrerequisites: true,
        steps: [
          {
            chapters: 1,
            prerequisite: true,
            task: "reading-graph",
            words: 400,
          },
          {
            chapters: 2,
            prerequisite: false,
            task: "reading-summary",
            words: 1200,
          },
        ],
        target: "reading-summary",
        tokens: {
          cacheableInput: 62000,
          input: 76000,
          output: 6400,
        },
        words: 1200,
      },
    });
  });

  it("rejects job add before enqueueing when llm config is missing", async () => {
    queueMockState.loadRequiredStageConfigError = new Error(
      "Missing LLM configuration.",
    );

    await expect(
      runQueueCommand({
        acceptCost: true,
        action: "add",
        archivePath: "book.wikg",
        chapterId: 12,
        llmJSON: '{"model":"inline-model"}',
        target: "reading-graph",
      }),
    ).rejects.toThrow("Missing LLM configuration.");

    expect(queueMockState.loadRequiredStageConfigCalls).toStrictEqual([
      {
        llmJSON: '{"model":"inline-model"}',
      },
    ]);
    expect(queueMockState.addCalls).toStrictEqual([]);
    expect(queueMockState.textWrites).toStrictEqual([]);
  });

  it("rejects knowledge graph job add when wikispine is not configured", async () => {
    await expect(
      runQueueCommand({
        acceptCost: true,
        action: "add",
        archivePath: "book.wikg",
        chapterId: 12,
        target: "knowledge-graph",
      }),
    ).rejects.toThrow("Knowledge Graph requires WikiSpine.");

    expect(queueMockState.addCalls).toStrictEqual([]);
    expect(queueMockState.textWrites).toStrictEqual([]);
  });

  it("prints a header for human queue lists", async () => {
    queueMockState.jobs = [
      {
        archiveKey: "archive-key",
        archivePath: "/books/book.wikg",
        chapterId: 12,
        createdAt: 1,
        currentStep: "reading-summary",
        eventsPath: "events.ndjson",
        jobId: "job-1-full",
        queueRank: 1,
        state: "running",
        target: "reading-summary",
        updatedAt: 2,
        workspacePath: "/tmp/job-workspace",
      },
    ];

    await runQueueCommand({
      action: "list",
    });

    expect(queueMockState.textWrites).toStrictEqual([
      "JOB      STATE     STEP    TARGET  CHAPTER ARCHIVE\njob-1-fu running   reading-summary reading-summary      12 book.wikg\n",
    ]);
  });

  it("prints queue list json", async () => {
    queueMockState.jobs = [
      {
        archiveKey: "archive-key",
        archivePath: "/books/book.wikg",
        chapterId: 12,
        createdAt: 1,
        eventsPath: "events.ndjson",
        jobId: "job-1-full",
        llmJSON: JSON.stringify({
          apiKey: "secret-key",
          baseUrl: "https://example.test/v1",
          model: "example-model",
          provider: "openai-compatible",
        }),
        queueRank: 1,
        state: "queued",
        target: "reading-graph",
        updatedAt: 2,
        workspacePath: "/tmp/job-workspace",
      },
    ];

    await runQueueCommand({
      action: "list",
      json: true,
    });

    expect(queueMockState.textWrites.join("")).not.toContain("secret-key");
    expect(queueMockState.textWrites.join("")).not.toContain("baseUrl");
    expect(queueMockState.textWrites.join("")).not.toContain(
      "https://example.test/v1",
    );
    expect(JSON.parse(queueMockState.textWrites.join(""))).toStrictEqual({
      items: [
        {
          archiveKey: "archive-key",
          archivePath: "/books/book.wikg",
          chapterId: 12,
          createdAt: 1,
          eventsPath: "events.ndjson",
          jobId: "job-1-full",
          llm: {
            configured: true,
            hasApiKey: true,
            hasBaseURL: true,
            model: "example-model",
            provider: "openai-compatible",
          },
          queueRank: 1,
          state: "queued",
          target: "reading-graph",
          updatedAt: 2,
          workspacePath: "/tmp/job-workspace",
        },
      ],
    });
  });

  it("prints queue status json after resolving short job ids", async () => {
    queueMockState.job = {
      ...queueMockState.job,
      llmJSON: JSON.stringify({
        apiKey: "secret-key",
        llm: {
          baseURL: "https://nested.example.test/v1",
          model: "nested-model",
          provider: "openai-compatible",
        },
      }),
    };

    await runQueueCommand({
      action: "status",
      jobId: "job-1-short",
      json: true,
    });

    expect(queueMockState.resolveJobIds).toStrictEqual(["job-1-short"]);
    expect(queueMockState.textWrites.join("")).not.toContain("secret-key");
    expect(queueMockState.textWrites.join("")).not.toContain(
      "https://nested.example.test/v1",
    );
    expect(JSON.parse(queueMockState.textWrites.join(""))).toMatchObject({
      archiveKey: "archive-key",
      jobId: "job-1",
      llm: {
        configured: true,
        hasApiKey: false,
        hasBaseURL: true,
        model: "nested-model",
        provider: "openai-compatible",
      },
      state: "succeeded",
    });
  });

  it("runs LLM build work outside archive write scopes", async () => {
    queueMockState.job = {
      ...queueMockState.job,
      state: "running",
    };

    await runQueueWorker();

    const reporter = {
      addOutputCharacters: vi.fn(() => Promise.resolve()),
      setTotals: vi.fn(() => Promise.resolve()),
      stepCompleted: vi.fn(() => Promise.resolve()),
      stepStarted: vi.fn(() => Promise.resolve()),
      updatePhase: vi.fn(() => Promise.resolve()),
      updateWords: vi.fn(() => Promise.resolve()),
    };

    await queueMockState.runWorkerOptions!.executeJob(
      queueMockState.job,
      reporter,
    );

    expect(queueMockState.stepLog).toStrictEqual([
      "read:start",
      "read:end",
      "build-graph",
      "write:start",
      "commit-graph",
      "write:end",
      "read:start",
      "read:end",
      "read:start",
      "snapshot-summary",
      "read:end",
      "build-summary",
      "write:start",
      "commit-summary",
      "write:end",
    ]);
    expect(queueMockState.writeCalls).toStrictEqual(["book.wikg", "book.wikg"]);
    expect(queueMockState.buildGraphCalls).toHaveLength(1);
    expect(queueMockState.buildSummaryCalls).toHaveLength(1);
    expect(queueMockState.buildSummaryCalls[0]).toMatchObject({
      snapshotPath: "/tmp/job-workspace/summary-input.json",
      workspacePath: "/tmp/job-workspace",
    });
    expect(queueMockState.createStageLLMCalls[0]).toMatchObject({
      cacheDirPath: "/tmp/job-cache",
      logDirPath: "/tmp/job-logs",
    });
    expect(queueMockState.buildSummaryCalls[0]).not.toHaveProperty(
      "sourceDocumentPath",
    );
    expect(queueMockState.inputRevisionRecords).toStrictEqual([
      {
        currentRevision: 1,
        jobId: "job-1",
        ownerId: "owner-1",
      },
      {
        currentRevision: 2,
        jobId: "job-1",
        ownerId: "owner-1",
      },
    ]);
    expect(queueMockState.inputRevisionAssertions).toStrictEqual([
      {
        currentRevision: 1,
        jobId: "job-1",
        ownerId: "owner-1",
      },
      {
        currentRevision: 2,
        jobId: "job-1",
        ownerId: "owner-1",
      },
      {
        currentRevision: 2,
        jobId: "job-1",
        ownerId: "owner-1",
      },
    ]);
  });

  it("uses default queue concurrency for worker slots", async () => {
    await runQueueWorker();

    expect(queueMockState.runWorkerOptions?.concurrency).toBe(3);
  });

  it("uses configured queue concurrency for worker slots", async () => {
    queueMockState.cliConfig = {
      concurrent: {
        job: 5,
      },
    };

    await runQueueWorker();

    expect(queueMockState.runWorkerOptions?.concurrency).toBe(5);
  });

  it("runs knowledge graph work without reading graph or summary builds", async () => {
    queueMockState.cliConfig = {
      wikispine: {
        provider: "fetch",
      },
    };
    queueMockState.job = {
      ...queueMockState.job,
      state: "running",
      target: "knowledge-graph",
    };

    await runQueueWorker();

    const reporter = {
      addOutputCharacters: vi.fn(() => Promise.resolve()),
      setTotals: vi.fn(() => Promise.resolve()),
      stepCompleted: vi.fn(() => Promise.resolve()),
      stepStarted: vi.fn(() => Promise.resolve()),
      updatePhase: vi.fn(() => Promise.resolve()),
      updateWords: vi.fn(() => Promise.resolve()),
    };

    await queueMockState.runWorkerOptions!.executeJob(
      queueMockState.job,
      reporter,
    );

    expect(queueMockState.stepLog).toStrictEqual([
      "read:start",
      "read:end",
      "read:start",
      "snapshot-knowledge-graph",
      "read:end",
      "build-knowledge-graph",
      "write:start",
      "commit-knowledge-graph",
      "write:end",
    ]);
    expect(queueMockState.buildKnowledgeGraphCalls).toHaveLength(1);
    expect(queueMockState.buildKnowledgeGraphCalls[0]).toMatchObject({
      policyPrompt: "Keep key beats",
      progressTracker: reporter,
      wikispine: {
        provider: "fetch",
      },
      workspacePath: "/tmp/job-workspace",
    });
    expect(queueMockState.commitKnowledgeGraphCalls).toStrictEqual([
      {
        chapterId: 12,
        manifestPath: "/tmp/job-workspace/knowledge-graph/manifest.json",
      },
    ]);
    expect(queueMockState.inputRevisionRecords).toStrictEqual([
      {
        currentRevision: 1,
        jobId: "job-1",
        ownerId: "owner-1",
      },
    ]);
    expect(queueMockState.inputRevisionAssertions).toStrictEqual([
      {
        currentRevision: 1,
        jobId: "job-1",
        ownerId: "owner-1",
      },
      {
        currentRevision: 1,
        jobId: "job-1",
        ownerId: "owner-1",
      },
    ]);
    expect(queueMockState.buildGraphCalls).toStrictEqual([]);
    expect(queueMockState.buildSummaryCalls).toStrictEqual([]);
    expect(queueMockState.commitGraphCalls).toStrictEqual([]);
    expect(queueMockState.commitSummaryCalls).toStrictEqual([]);
  });

  it("writes every watch jsonl event without closing stdout", async () => {
    queueMockState.events = [
      {
        at: 1,
        jobId: "job-1",
        seq: 1,
        state: "queued",
        type: "created",
      },
      {
        at: 2,
        jobId: "job-1",
        seq: 2,
        state: "succeeded",
        type: "succeeded",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: true,
    });

    expect(queueMockState.textWrites).toStrictEqual([
      '{"at":1,"seq":1,"jobId":"job-1","type":"created","state":"queued"}\n',
      '{"at":2,"seq":2,"jobId":"job-1","type":"succeeded","state":"succeeded"}\n',
    ]);
  });

  it("rejects knowledge graph work when wikispine is not configured", async () => {
    queueMockState.job = {
      ...queueMockState.job,
      state: "running",
      target: "knowledge-graph",
    };

    await runQueueWorker();

    const reporter = {
      addOutputCharacters: vi.fn(() => Promise.resolve()),
      setTotals: vi.fn(() => Promise.resolve()),
      stepCompleted: vi.fn(() => Promise.resolve()),
      stepStarted: vi.fn(() => Promise.resolve()),
      updatePhase: vi.fn(() => Promise.resolve()),
      updateWords: vi.fn(() => Promise.resolve()),
    };

    await expect(
      queueMockState.runWorkerOptions!.executeJob(queueMockState.job, reporter),
    ).rejects.toThrow("Knowledge Graph requires WikiSpine.");
    expect(queueMockState.buildKnowledgeGraphCalls).toStrictEqual([]);
    expect(queueMockState.writeCalls).toStrictEqual([]);
  });

  it("resolves short job ids before watching", async () => {
    queueMockState.events = [
      {
        at: 1,
        jobId: "job-1-full",
        seq: 1,
        state: "succeeded",
        type: "succeeded",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1-short",
      jsonl: true,
    });

    expect(queueMockState.resolveJobIds).toStrictEqual(["job-1-short"]);
    expect(queueMockState.getJobIds).toStrictEqual(["job-1-full"]);
  });

  it("prints jsonl progress with only the active step progress", async () => {
    queueMockState.events = [
      {
        at: 1,
        counters: [
          {
            done: 4520,
            name: "words",
            total: 4520,
            unit: "word",
          },
        ],
        jobId: "job-1",
        seq: 1,
        step: "reading-summary",
        tokens: {
          inputTokens: 1200,
          outputTokens: 200,
        },
        type: "status_snapshot",
      },
      {
        at: 2,
        jobId: "job-1",
        seq: 2,
        state: "succeeded",
        type: "succeeded",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: true,
    });

    expect(JSON.parse(queueMockState.textWrites[0] ?? "")).toStrictEqual({
      at: 1,
      counters: [{ done: 4520, name: "words", total: 4520, unit: "word" }],
      jobId: "job-1",
      seq: 1,
      step: "reading-summary",
      tokens: { inputTokens: 1200, outputTokens: 200 },
      type: "status_snapshot",
    });
    expect(queueMockState.textWrites[0]).not.toContain("graphWords");
    expect(queueMockState.textWrites[0]).not.toContain("readingSummaryWords");
    expect(queueMockState.textWrites[1]).toBe(
      '{"at":2,"seq":2,"jobId":"job-1","type":"succeeded","state":"succeeded"}\n',
    );
  });

  it("prints only the active progress step in human watch output", async () => {
    queueMockState.events = [
      {
        at: 1,
        counters: [
          {
            done: 4520,
            name: "words",
            total: 4520,
            unit: "word",
          },
        ],
        jobId: "job-1",
        seq: 1,
        step: "reading-summary",
        tokens: {
          inputTokens: 1200,
          outputTokens: 200,
        },
        type: "status_snapshot",
      },
      {
        at: 2,
        jobId: "job-1",
        seq: 2,
        state: "succeeded",
        type: "succeeded",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: false,
    });

    expect(queueMockState.textWrites).toStrictEqual([
      "summarizing words 4520/4520 [tokens input: 1200 / output: 200]\n",
      "succeeded\n",
    ]);
  });

  it("prints reading graph word progress as extracting", async () => {
    queueMockState.events = [
      {
        at: 1,
        counters: [
          {
            done: 128,
            name: "words",
            total: 2431,
            unit: "word",
          },
        ],
        jobId: "job-1",
        seq: 1,
        step: "reading-graph",
        tokens: {
          outputTokens: 614,
        },
        type: "status_snapshot",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: false,
    });

    expect(queueMockState.textWrites).toStrictEqual([
      "extracting words 128/2431 [tokens output: 614]\n",
    ]);
  });

  it("prints knowledge graph step plan in execution order", async () => {
    queueMockState.events = [
      {
        at: 1,
        jobId: "job-1",
        seq: 1,
        step: "knowledge-graph",
        type: "step_started",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: false,
    });

    expect(queueMockState.textWrites).toStrictEqual([
      "knowledge-graph started\nsteps: matching -> screening -> enrichment -> grounding -> relation-discovery -> committing\n",
    ]);
  });

  it("prints committing phase progress in human watch output", async () => {
    queueMockState.events = [
      {
        at: 1,
        counters: [
          {
            done: 1,
            name: "items",
            total: 1,
            unit: "item",
          },
        ],
        jobId: "job-1",
        phase: "committing",
        seq: 1,
        step: "knowledge-graph",
        type: "status_snapshot",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: false,
    });

    expect(queueMockState.textWrites).toStrictEqual(["committing items 1/1\n"]);
  });

  it("prints knowledge graph phase progress without word counters", async () => {
    queueMockState.events = [
      {
        at: 1,
        counters: [
          {
            done: 5,
            name: "windows",
            total: 19,
            unit: "window",
          },
        ],
        jobId: "job-1",
        phase: "grounding",
        seq: 1,
        step: "knowledge-graph",
        tokens: {
          outputTokens: 6500,
        },
        type: "status_snapshot",
      },
      {
        at: 2,
        jobId: "job-1",
        seq: 2,
        state: "succeeded",
        type: "succeeded",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: false,
    });

    expect(queueMockState.textWrites).toStrictEqual([
      "grounding windows 5/19 [tokens output: 6500]\n",
      "succeeded\n",
    ]);
  });

  it("prints knowledge graph phase detail when available", async () => {
    queueMockState.events = [
      {
        at: 1,
        counters: [
          {
            done: 25,
            name: "linked-page",
            total: 80,
            unit: "page",
          },
        ],
        jobId: "job-1",
        phase: "enrichment",
        seq: 1,
        step: "knowledge-graph",
        tokens: {
          outputTokens: 6500,
        },
        type: "status_snapshot",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: false,
    });

    expect(queueMockState.textWrites).toStrictEqual([
      "enrichment linked-page 25/80 pages [tokens output: 6500]\n",
    ]);
  });

  it("prints matching text character progress", async () => {
    queueMockState.events = [
      {
        at: 1,
        counters: [
          {
            done: 128,
            name: "text",
            total: 4096,
            unit: "char",
          },
        ],
        jobId: "job-1",
        phase: "matching",
        seq: 1,
        step: "knowledge-graph",
        type: "status_snapshot",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: false,
    });

    expect(queueMockState.textWrites).toStrictEqual([
      "matching text 128/4096 chars\n",
    ]);
  });

  it("includes knowledge graph phase progress in jsonl watch output", async () => {
    queueMockState.events = [
      {
        at: 1,
        counters: [
          {
            done: 5,
            name: "window",
            total: 19,
            unit: "window",
          },
        ],
        jobId: "job-1",
        phase: "grounding",
        seq: 1,
        step: "knowledge-graph",
        tokens: {
          outputTokens: 6500,
        },
        type: "status_snapshot",
      },
      {
        at: 2,
        jobId: "job-1",
        seq: 2,
        state: "succeeded",
        type: "succeeded",
      },
    ];

    await runQueueCommand({
      action: "watch",
      from: "beginning",
      jobId: "job-1",
      jsonl: true,
    });

    expect(JSON.parse(queueMockState.textWrites[0] ?? "")).toStrictEqual({
      at: 1,
      counters: [{ done: 5, name: "window", total: 19, unit: "window" }],
      jobId: "job-1",
      phase: "grounding",
      seq: 1,
      step: "knowledge-graph",
      tokens: { outputTokens: 6500 },
      type: "status_snapshot",
    });
  });
});

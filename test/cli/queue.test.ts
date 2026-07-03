import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queueMockState = vi.hoisted(() => ({
  activeError: undefined as Error | undefined,
  activeJobChecks: [] as unknown[],
  addCalls: [] as unknown[],
  buildGraphCalls: [] as unknown[],
  buildKnowledgeGraphCalls: [] as unknown[],
  buildSummaryCalls: [] as unknown[],
  chapterStage: "sourced" as "planned" | "sourced" | "graphed" | "summarized",
  commitGraphCalls: [] as unknown[],
  commitKnowledgeGraphCalls: [] as unknown[],
  commitSummaryCalls: [] as unknown[],
  inputRevisionAssertions: [] as unknown[],
  inputRevisionRecords: [] as unknown[],
  cliConfig: {} as {
    readonly concurrent?: {
      readonly job?: number;
      readonly request?: number;
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
    chapterId: 12,
    eventsPath: "events.ndjson",
    jobId: "job-1",
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

vi.mock("../../src/wikg/spine-digest-file.js", () => ({
  SpineDigestFile: class {
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

vi.mock("../../src/facade/index.js", () => ({
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
  generateChapterKnowledgeGraphArtifact: vi.fn(
    (_document: unknown, _chapterId: number, options: unknown) => {
      queueMockState.stepLog.push("build-knowledge-graph");
      queueMockState.buildKnowledgeGraphCalls.push(options);
      return Promise.resolve({
        chapterId: 12,
        manifestPath: "/tmp/job-workspace/knowledge-graph/manifest.json",
      });
    },
  ),
  listBuildJobs: vi.fn(() => Promise.resolve(queueMockState.jobs)),
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
  snapshotChapterSummaryInput: vi.fn(() => {
    queueMockState.stepLog.push("snapshot-summary");
    return Promise.resolve({
      filePath: "/tmp/job-workspace/summary-input.json",
    });
  }),
  updateBuildJobTarget: vi.fn(),
}));

vi.mock("../../src/cli/io.js", () => ({
  writeTextToStdout: vi.fn((text: string) => {
    queueMockState.textWrites.push(text);
    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/config.js", () => ({
  loadCLIConfig: vi.fn(() => Promise.resolve(queueMockState.cliConfig)),
}));

vi.mock("../../src/cli/stage-runtime.js", () => ({
  createStageLLM: vi.fn(() => ({})),
  loadRequiredStageConfig: vi.fn((options: unknown) => {
    queueMockState.loadRequiredStageConfigCalls.push(options);
    if (queueMockState.loadRequiredStageConfigError !== undefined) {
      return Promise.reject(queueMockState.loadRequiredStageConfigError);
    }

    return Promise.resolve({
      prompt: "Keep key beats",
    });
  }),
  resolveExtractionPrompt: vi.fn((prompt: string | undefined) => prompt ?? ""),
  resolveKnowledgeGraphRecallPrompt: vi.fn(
    (prompt: string | undefined) => prompt ?? "Default KG recall",
  ),
}));

import { runQueueCommand } from "../../src/cli/queue.js";

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
    queueMockState.commitGraphCalls.length = 0;
    queueMockState.commitKnowledgeGraphCalls.length = 0;
    queueMockState.commitSummaryCalls.length = 0;
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
      chapterId: 12,
      createdAt: 1,
      eventsPath: "events.ndjson",
      jobId: "job-1",
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

    expect(JSON.parse(queueMockState.textWrites.join(""))).toStrictEqual({
      items: [
        {
          archiveKey: "archive-key",
          archivePath: "/books/book.wikg",
          chapterId: 12,
          createdAt: 1,
          eventsPath: "events.ndjson",
          jobId: "job-1-full",
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
    await runQueueCommand({
      action: "status",
      jobId: "job-1-short",
      json: true,
    });

    expect(queueMockState.resolveJobIds).toStrictEqual(["job-1-short"]);
    expect(JSON.parse(queueMockState.textWrites.join(""))).toMatchObject({
      archiveKey: "archive-key",
      jobId: "job-1",
      state: "succeeded",
    });
  });

  it("runs LLM build work outside archive write scopes", async () => {
    queueMockState.job = {
      ...queueMockState.job,
      state: "running",
    };

    await runQueueCommand({
      action: "worker",
    });

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
    await runQueueCommand({
      action: "worker",
    });

    expect(queueMockState.runWorkerOptions?.concurrency).toBe(3);
  });

  it("uses configured queue concurrency for worker slots", async () => {
    queueMockState.cliConfig = {
      concurrent: {
        job: 5,
      },
    };

    await runQueueCommand({
      action: "worker",
    });

    expect(queueMockState.runWorkerOptions?.concurrency).toBe(5);
  });

  it("runs knowledge graph work without reading graph or summary builds", async () => {
    queueMockState.job = {
      ...queueMockState.job,
      state: "running",
      target: "knowledge-graph",
    };

    await runQueueCommand({
      action: "worker",
    });

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
      "build-knowledge-graph",
      "read:end",
      "write:start",
      "commit-knowledge-graph",
      "write:end",
    ]);
    expect(queueMockState.buildKnowledgeGraphCalls).toHaveLength(1);
    expect(queueMockState.buildKnowledgeGraphCalls[0]).toMatchObject({
      policyPrompt: "Keep key beats",
      progressTracker: reporter,
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
      "reading-summary words 4520/4520 [tokens input: 1200 / output: 200]\n",
      "succeeded\n",
    ]);
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

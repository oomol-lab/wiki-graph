import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queueMockState = vi.hoisted(() => ({
  activeError: undefined as Error | undefined,
  activeJobChecks: [] as unknown[],
  addCalls: [] as unknown[],
  buildGraphCalls: [] as unknown[],
  buildSummaryCalls: [] as unknown[],
  chapterStage: "sourced" as "planned" | "sourced" | "graphed" | "summarized",
  commitGraphCalls: [] as unknown[],
  commitSummaryCalls: [] as unknown[],
  events: [] as unknown[],
  getJobIds: [] as string[],
  jobs: [] as unknown[],
  buildInputStage: "sourced" as
    | "planned"
    | "sourced"
    | "graphed"
    | "summarized",
  job: {
    archivePath: "book.sdpub",
    chapterId: 12,
    eventsPath: "events.ndjson",
    jobId: "job-1",
    state: "succeeded",
    target: "summary",
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

vi.mock("../../src/facade/spine-digest-file.js", () => ({
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
        return await operation({});
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
        return await operation({});
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
      archivePath: "book.sdpub",
      chapterId: 12,
      jobId: "job-1",
      state: "queued",
      target: "summary",
    });
  }),
  assertNoActiveBuildJobs: vi.fn((input: unknown) => {
    queueMockState.activeJobChecks.push(input);
    if (queueMockState.activeError !== undefined) {
      throw queueMockState.activeError;
    }
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
    return Promise.resolve({
      chapterId: 12,
      stage: "graphed",
      words: 4,
    });
  }),
  commitChapterSummaryArtifact: vi.fn(() => {
    queueMockState.stepLog.push("commit-summary");
    queueMockState.commitSummaryCalls.push({});
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
  listBuildJobs: vi.fn(() => Promise.resolve(queueMockState.jobs)),
  pauseBuildJob: vi.fn(),
  readBuildJobEvents: vi.fn(() => Promise.resolve(queueMockState.events)),
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
  loadCLIConfig: vi.fn(() =>
    Promise.resolve({
      request: {
        concurrent: 2,
      },
    }),
  ),
}));

vi.mock("../../src/cli/stage-runtime.js", () => ({
  createStageLLM: vi.fn(() => ({})),
  loadRequiredStageConfig: vi.fn(() =>
    Promise.resolve({
      prompt: "Keep key beats",
    }),
  ),
  resolveExtractionPrompt: vi.fn((prompt: string | undefined) => prompt ?? ""),
}));

import { runQueueCommand } from "../../src/cli/queue.js";

describe("cli/queue", () => {
  const originalDisableAutostart =
    process.env.SPINEDIGEST_QUEUE_DISABLE_AUTOSTART;

  beforeEach(() => {
    queueMockState.activeError = undefined;
    queueMockState.activeJobChecks.length = 0;
    queueMockState.addCalls.length = 0;
    queueMockState.buildGraphCalls.length = 0;
    queueMockState.buildSummaryCalls.length = 0;
    queueMockState.buildInputStage = "sourced";
    queueMockState.chapterStage = "sourced";
    queueMockState.commitGraphCalls.length = 0;
    queueMockState.commitSummaryCalls.length = 0;
    queueMockState.events = [];
    queueMockState.getJobIds.length = 0;
    queueMockState.jobs = [];
    queueMockState.job = {
      archiveKey: "archive-key",
      archivePath: "book.sdpub",
      chapterId: 12,
      createdAt: 1,
      eventsPath: "events.ndjson",
      jobId: "job-1",
      queueRank: 10,
      state: "succeeded",
      target: "summary",
      updatedAt: 2,
      workspacePath: "/tmp/job-workspace",
    };
    queueMockState.openPaths.length = 0;
    queueMockState.readDocumentCalls.length = 0;
    queueMockState.readChapterStageError = undefined;
    queueMockState.resolveJobIds.length = 0;
    queueMockState.runWorkerOptions = undefined;
    queueMockState.stepLog.length = 0;
    queueMockState.textWrites.length = 0;
    queueMockState.writeCalls.length = 0;
    process.env.SPINEDIGEST_QUEUE_DISABLE_AUTOSTART = "1";
  });

  afterEach(() => {
    if (originalDisableAutostart === undefined) {
      delete process.env.SPINEDIGEST_QUEUE_DISABLE_AUTOSTART;
      return;
    }

    process.env.SPINEDIGEST_QUEUE_DISABLE_AUTOSTART = originalDisableAutostart;
  });

  it("checks archive and active job preconditions before the cost gate", async () => {
    await expect(
      runQueueCommand({
        action: "add",
        archivePath: "book.sdpub",
        chapterId: 12,
        target: "summary",
      }),
    ).rejects.toThrow("consume tokens");

    expect(queueMockState.openPaths).toStrictEqual(["book.sdpub"]);
    expect(queueMockState.activeJobChecks).toStrictEqual([
      {
        archivePath: "book.sdpub",
        chapterIds: [12],
        operation: "Queueing build job",
      },
    ]);
    expect(queueMockState.addCalls).toStrictEqual([]);
  });

  it("reports missing chapters before the cost gate", async () => {
    queueMockState.readChapterStageError = new Error(
      "Chapter 12 does not exist",
    );

    await expect(
      runQueueCommand({
        action: "add",
        archivePath: "book.sdpub",
        chapterId: 12,
        target: "summary",
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
        archivePath: "book.sdpub",
        chapterId: 12,
        target: "summary",
      }),
    ).rejects.toThrow("Set source before queueing");

    expect(queueMockState.activeJobChecks).toStrictEqual([]);
    expect(queueMockState.addCalls).toStrictEqual([]);
  });

  it("reports active job conflicts before the cost gate", async () => {
    queueMockState.activeError = new Error("active job conflict");

    await expect(
      runQueueCommand({
        action: "add",
        archivePath: "book.sdpub",
        chapterId: 12,
        target: "summary",
      }),
    ).rejects.toThrow("active job conflict");

    expect(queueMockState.addCalls).toStrictEqual([]);
  });

  it("adds a job after the cost is accepted", async () => {
    await runQueueCommand({
      acceptCost: true,
      action: "add",
      archivePath: "book.sdpub",
      boost: true,
      chapterId: 12,
      target: "graph",
    });

    expect(queueMockState.addCalls).toStrictEqual([
      {
        archivePath: "book.sdpub",
        boost: true,
        chapterId: 12,
        target: "graph",
      },
    ]);
    expect(queueMockState.textWrites.join("")).toContain("Job job-1 queued");
  });

  it("prints a header for human queue lists", async () => {
    queueMockState.jobs = [
      {
        archiveKey: "archive-key",
        archivePath: "/books/book.sdpub",
        chapterId: 12,
        createdAt: 1,
        currentStep: "summary",
        eventsPath: "events.ndjson",
        jobId: "job-1-full",
        queueRank: 1,
        state: "running",
        target: "summary",
        updatedAt: 2,
        workspacePath: "/tmp/job-workspace",
      },
    ];

    await runQueueCommand({
      action: "list",
    });

    expect(queueMockState.textWrites).toStrictEqual([
      "JOB      STATE     STEP    TARGET  CHAPTER ARCHIVE\njob-1-fu running   summary summary      12 book.sdpub\n",
    ]);
  });

  it("prints queue list json", async () => {
    queueMockState.jobs = [
      {
        archiveKey: "archive-key",
        archivePath: "/books/book.sdpub",
        chapterId: 12,
        createdAt: 1,
        eventsPath: "events.ndjson",
        jobId: "job-1-full",
        queueRank: 1,
        state: "queued",
        target: "graph",
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
          archivePath: "/books/book.sdpub",
          chapterId: 12,
          createdAt: 1,
          eventsPath: "events.ndjson",
          jobId: "job-1-full",
          queueRank: 1,
          state: "queued",
          target: "graph",
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
    expect(queueMockState.writeCalls).toStrictEqual([
      "book.sdpub",
      "book.sdpub",
    ]);
    expect(queueMockState.buildGraphCalls).toHaveLength(1);
    expect(queueMockState.buildSummaryCalls).toHaveLength(1);
    expect(queueMockState.buildSummaryCalls[0]).toMatchObject({
      snapshotPath: "/tmp/job-workspace/summary-input.json",
      workspacePath: "/tmp/job-workspace",
    });
    expect(queueMockState.buildSummaryCalls[0]).not.toHaveProperty(
      "sourceDocumentPath",
    );
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
      `${JSON.stringify(queueMockState.events[0])}\n`,
      `${JSON.stringify(queueMockState.events[1])}\n`,
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
        graphWords: 4520,
        jobId: "job-1",
        outputTokens: 200,
        seq: 1,
        step: "summary",
        summaryWords: 9040,
        totalGraphWords: 4520,
        totalSummaryWords: 4520,
        type: "progress_snapshot",
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

    expect(queueMockState.textWrites[0]).toBe(
      `${JSON.stringify({
        at: 1,
        jobId: "job-1",
        outputTokens: 200,
        seq: 1,
        step: "summary",
        totalWords: 4520,
        type: "progress_snapshot",
        words: 4520,
      })}\n`,
    );
    expect(queueMockState.textWrites[0]).not.toContain("graphWords");
    expect(queueMockState.textWrites[0]).not.toContain("summaryWords");
    expect(queueMockState.textWrites[1]).toBe(
      `${JSON.stringify(queueMockState.events[1])}\n`,
    );
  });

  it("prints only the active progress step in human watch output", async () => {
    queueMockState.events = [
      {
        at: 1,
        graphWords: 4520,
        jobId: "job-1",
        outputTokens: 200,
        seq: 1,
        step: "summary",
        summaryWords: 9040,
        totalGraphWords: 4520,
        totalSummaryWords: 4520,
        type: "progress_snapshot",
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
      "progress summary 4520/4520 output ~200 tokens\n",
      "succeeded\n",
    ]);
  });
});

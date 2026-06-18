import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queueMockState = vi.hoisted(() => ({
  activeError: undefined as Error | undefined,
  activeJobChecks: [] as unknown[],
  addCalls: [] as unknown[],
  chapterStage: "sourced" as "planned" | "sourced" | "graphed" | "summarized",
  events: [] as unknown[],
  getJobIds: [] as string[],
  job: {
    eventsPath: "events.ndjson",
    jobId: "job-1",
    state: "succeeded",
  },
  readChapterStageError: undefined as Error | undefined,
  openPaths: [] as string[],
  resolveJobIds: [] as string[],
  textWrites: [] as string[],
}));

vi.mock("../../src/facade/spine-digest-file.js", () => ({
  SpineDigestFile: class {
    readonly #path: string;

    public constructor(path: string) {
      this.#path = path;
    }

    public async openSession(
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
  cancelBuildJob: vi.fn(),
  cleanBuildJobs: vi.fn(),
  generateChapterGraph: vi.fn(),
  generateChapterSummary: vi.fn(),
  getBuildJob: vi.fn((jobId: string) => {
    queueMockState.getJobIds.push(jobId);
    return Promise.resolve(queueMockState.job);
  }),
  listBuildJobs: vi.fn(),
  pauseBuildJob: vi.fn(),
  readBuildJobEvents: vi.fn(() => Promise.resolve(queueMockState.events)),
  resolveBuildJobId: vi.fn((jobId: string) => {
    queueMockState.resolveJobIds.push(jobId);
    return Promise.resolve(jobId === "job-1-short" ? "job-1-full" : jobId);
  }),
  resumeBuildJob: vi.fn(),
  runBuildJobWorker: vi.fn(),
  updateBuildJobTarget: vi.fn(),
}));

vi.mock("../../src/cli/io.js", () => ({
  writeTextToStdout: vi.fn((text: string) => {
    queueMockState.textWrites.push(text);
    return Promise.resolve();
  }),
}));

import { runQueueCommand } from "../../src/cli/queue.js";

describe("cli/queue", () => {
  const originalDisableAutostart =
    process.env.SPINEDIGEST_QUEUE_DISABLE_AUTOSTART;

  beforeEach(() => {
    queueMockState.activeError = undefined;
    queueMockState.activeJobChecks.length = 0;
    queueMockState.addCalls.length = 0;
    queueMockState.chapterStage = "sourced";
    queueMockState.events = [];
    queueMockState.getJobIds.length = 0;
    queueMockState.job = {
      eventsPath: "events.ndjson",
      jobId: "job-1",
      state: "succeeded",
    };
    queueMockState.openPaths.length = 0;
    queueMockState.readChapterStageError = undefined;
    queueMockState.resolveJobIds.length = 0;
    queueMockState.textWrites.length = 0;
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

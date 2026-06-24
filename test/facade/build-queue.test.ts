import { access } from "fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { Database } from "../../src/document/index.js";
import {
  addBuildJob,
  getBuildJob,
  listBuildJobs,
  readBuildJobEvents,
  resolveBuildJobId,
  runBuildJobWorker,
  boostBuildJob,
  updateBuildJobTarget,
  cancelBuildJob,
} from "../../src/facade/index.js";
import { withTempDir } from "../helpers/temp.js";

const originalStateDir = process.env.SPINEDIGEST_STATE_DIR;

describe("facade/build-queue", () => {
  afterEach(() => {
    restoreEnv("SPINEDIGEST_STATE_DIR", originalStateDir);
  });

  it("allows only one active job for an archive chapter", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);

      await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "summary",
      });

      await expect(
        addBuildJob({
          archivePath: `${path}/book.sdpub`,
          chapterId: 1,
          target: "graph",
        }),
      ).rejects.toThrow();
    });
  });

  it("boosts queued jobs to the front without changing running state", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const first = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "summary",
      });
      const second = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 2,
        target: "summary",
      });

      await boostBuildJob(second.jobId);

      expect((await listBuildJobs()).map((job) => job.jobId)).toStrictEqual([
        second.jobId,
        first.jobId,
      ]);
    });
  });

  it("resolves unique job id prefixes and rejects ambiguous prefixes", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const first = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        jobId: "aaaaaaaa-1111-4111-8111-111111111111",
        target: "summary",
      });
      const second = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 2,
        jobId: "aaaaaaaa-2222-4222-8222-222222222222",
        target: "summary",
      });

      await expect(resolveBuildJobId("aaaaaaaa-1")).resolves.toBe(first.jobId);
      await expect(resolveBuildJobId(second.jobId.slice(0, 8))).rejects.toThrow(
        "ambiguous",
      );
      await expect(resolveBuildJobId("missing")).rejects.toThrow(
        "Build job not found",
      );
    });
  });

  it("rejects summary-to-graph downgrade after summary starts", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "summary",
      });
      let releaseWorker!: () => void;
      const workerRelease = new Promise<void>((resolveRelease) => {
        releaseWorker = resolveRelease;
      });
      let summaryStarted!: () => void;
      const summaryStartedSignal = new Promise<void>((resolveStarted) => {
        summaryStarted = resolveStarted;
      });
      const worker = runBuildJobWorker({
        concurrency: 1,
        executeJob: async (_job, reporter) => {
          await reporter.stepStarted("summary");
          summaryStarted();
          await workerRelease;
        },
        idleTimeoutMs: 0,
      });

      await summaryStartedSignal;
      await expect(updateBuildJobTarget(job.jobId, "graph")).rejects.toThrow(
        "Cannot downgrade",
      );
      await cancelBuildJob(job.jobId);
      releaseWorker();
      await worker;
    });
  });

  it("writes structured events and removes succeeded workspaces", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "graph",
      });

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async (_job, reporter) => {
          await reporter.setTotals({ totalGraphWords: 100 });
          await reporter.stepStarted("graph");
          await reporter.updateWords({ graphWords: 50 });
          await reporter.addOutputCharacters(400);
          await reporter.stepCompleted("graph");
        },
        idleTimeoutMs: 0,
      });

      const updated = await getBuildJob(job.jobId);
      const events = await readBuildJobEvents(job);

      expect(updated.state).toBe("succeeded");
      expect(events.map((event) => event.type)).toContain("succeeded");
      await expect(access(job.workspacePath)).rejects.toThrow();
    });
  });

  it("clamps progress words to configured totals", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "summary",
      });

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async (_job, reporter) => {
          await reporter.setTotals({
            totalGraphWords: 100,
            totalSummaryWords: 50,
          });
          await reporter.updateWords({
            graphWords: 150,
            summaryWords: 75,
          });
          await reporter.stepStarted("summary");
        },
        idleTimeoutMs: 0,
      });

      const snapshots = (await readBuildJobEvents(job)).filter(
        (event) => event.type === "progress_snapshot",
      );
      const latest = snapshots.at(-1);

      expect(latest).toMatchObject({
        graphWords: 100,
        summaryWords: 50,
        totalWords: 50,
        words: 50,
      });
    });
  });

  it("continues claiming queued jobs after one job fails", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const failedJob = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "summary",
      });
      const succeededJob = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 2,
        target: "summary",
      });

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: (job) => {
          if (job.jobId === failedJob.jobId) {
            throw new Error("planned failure");
          }

          return Promise.resolve();
        },
        idleTimeoutMs: 0,
      });

      expect(await getBuildJob(failedJob.jobId)).toMatchObject({
        state: "failed",
      });
      expect(await getBuildJob(succeededJob.jobId)).toMatchObject({
        state: "succeeded",
      });
    });
  });

  it("waits for transient sqlite locks while marking failed jobs", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "summary",
      });
      let releaseLockPromise: Promise<void> | undefined;

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async () => {
          const lock = await lockSqliteDatabaseBriefly(
            `${path}/state/build-queue.sqlite`,
          );
          releaseLockPromise = lock.released;
          throw new Error("planned failure");
        },
        idleTimeoutMs: 0,
      });

      await requirePromise(releaseLockPromise);
      expect(await getBuildJob(job.jobId)).toMatchObject({
        state: "failed",
      });
    });
  });

  it("recovers stale running jobs back to queued", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "graph",
      });

      await forceRunningPid(
        `${path}/state/build-queue.sqlite`,
        job.jobId,
        99999999,
      );

      const jobs = await listBuildJobs();
      const updated = jobs.find((item) => item.jobId === job.jobId);

      expect(updated?.state).toBe("queued");
      expect(
        (await readBuildJobEvents(job)).map((event) => event.type),
      ).toContain("requeued");
    });
  });

  it("refills idle worker slots while other jobs are still running", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "graph",
      });

      let firstStarted!: () => void;
      let secondStarted!: () => void;
      let releaseFirst!: () => void;
      let releaseSecond!: () => void;
      const firstStartedSignal = new Promise<void>((resolveStarted) => {
        firstStarted = resolveStarted;
      });
      const secondStartedSignal = new Promise<void>((resolveStarted) => {
        secondStarted = resolveStarted;
      });
      const firstReleaseSignal = new Promise<void>((resolveRelease) => {
        releaseFirst = resolveRelease;
      });
      const secondReleaseSignal = new Promise<void>((resolveRelease) => {
        releaseSecond = resolveRelease;
      });

      const worker = runBuildJobWorker({
        concurrency: 2,
        executeJob: async (job) => {
          if (job.chapterId === 1) {
            firstStarted();
            await firstReleaseSignal;
            return;
          }

          secondStarted();
          await secondReleaseSignal;
        },
        idleTimeoutMs: 0,
      });

      await firstStartedSignal;
      await addBuildJob({
        archivePath: `${path}/other-book.sdpub`,
        chapterId: 2,
        target: "graph",
      });
      await withTimeout(
        secondStartedSignal,
        "Timed out waiting for idle queue slot to claim the second job.",
      );

      releaseFirst();
      releaseSecond();
      await worker;
    });
  });

  it("runs multiple jobs for the same archive when worker concurrency allows it", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "graph",
      });
      await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 2,
        target: "graph",
      });

      let firstStarted!: () => void;
      let secondStarted!: () => void;
      let releaseFirst!: () => void;
      let releaseSecond!: () => void;
      const firstStartedSignal = new Promise<void>((resolveStarted) => {
        firstStarted = resolveStarted;
      });
      const secondStartedSignal = new Promise<void>((resolveStarted) => {
        secondStarted = resolveStarted;
      });
      const firstReleaseSignal = new Promise<void>((resolveRelease) => {
        releaseFirst = resolveRelease;
      });
      const secondReleaseSignal = new Promise<void>((resolveRelease) => {
        releaseSecond = resolveRelease;
      });
      let startedCount = 0;

      const worker = runBuildJobWorker({
        concurrency: 2,
        executeJob: async () => {
          startedCount += 1;
          if (startedCount === 1) {
            firstStarted();
            await firstReleaseSignal;
            return;
          }

          secondStarted();
          await secondReleaseSignal;
        },
        idleTimeoutMs: 0,
      });

      await firstStartedSignal;
      await secondStartedSignal;

      expect((await listBuildJobs()).map((job) => job.state)).toStrictEqual([
        "running",
        "running",
      ]);

      releaseFirst();
      releaseSecond();
      await worker;
    });
  });

  it("keeps queue reads responsive while idle slots wait for work", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "graph",
      });

      let releaseJob!: () => void;
      const releaseSignal = new Promise<void>((resolveRelease) => {
        releaseJob = resolveRelease;
      });

      const worker = runBuildJobWorker({
        concurrency: 4,
        executeJob: async () => {
          await releaseSignal;
        },
        idleTimeoutMs: 2_000,
      });

      await withTimeout(
        waitForRunningJob(),
        "Timed out waiting for the first queue slot to become running.",
      );

      await expect(
        withTimeout(
          listBuildJobs({ all: true }),
          "Timed out waiting for queue list while worker slots were idle.",
        ),
      ).resolves.toHaveLength(1);

      releaseJob();
      await worker;
    });
  });

  async function waitForRunningJob(): Promise<void> {
    await waitForRunningJobCount(1);
  }

  async function waitForRunningJobCount(count: number): Promise<void> {
    while (true) {
      if (
        (await listBuildJobs()).filter((job) => job.state === "running")
          .length >= count
      ) {
        return;
      }
      await delay(50);
    }
  }

  it("lists multiple running jobs when worker concurrency allows it", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "graph",
      });
      await addBuildJob({
        archivePath: `${path}/other-book.sdpub`,
        chapterId: 2,
        target: "graph",
      });

      let firstStarted!: () => void;
      let secondStarted!: () => void;
      let releaseJobs!: () => void;
      const firstStartedSignal = new Promise<void>((resolveStarted) => {
        firstStarted = resolveStarted;
      });
      const secondStartedSignal = new Promise<void>((resolveStarted) => {
        secondStarted = resolveStarted;
      });
      const releaseSignal = new Promise<void>((resolveRelease) => {
        releaseJobs = resolveRelease;
      });

      const worker = runBuildJobWorker({
        concurrency: 2,
        executeJob: async (job) => {
          if (job.chapterId === 1) {
            firstStarted();
          } else if (job.chapterId === 2) {
            secondStarted();
          }

          await releaseSignal;
        },
        idleTimeoutMs: 0,
      });

      await withTimeout(
        Promise.all([firstStartedSignal, secondStartedSignal]),
        "Timed out waiting for both queue slots to become running.",
      );

      expect((await listBuildJobs()).map((job) => job.state)).toStrictEqual([
        "running",
        "running",
      ]);

      releaseJobs();
      await worker;
    });
  });
});

async function forceRunningPid(
  databasePath: string,
  jobId: string,
  pid: number,
): Promise<void> {
  const database = await Database.open(
    databasePath,
    "CREATE TABLE IF NOT EXISTS build_jobs (job_id TEXT PRIMARY KEY);",
  );

  try {
    await database.run(
      `
UPDATE build_jobs
SET state = 'running', owner_pid = ?, owner_id = 'test-owner'
WHERE job_id = ?
`,
      [pid, jobId],
    );
  } finally {
    await database.close();
  }
}

async function lockSqliteDatabaseBriefly(
  databasePath: string,
): Promise<{ readonly released: Promise<void> }> {
  const database = await Database.open(
    databasePath,
    "CREATE TABLE IF NOT EXISTS build_jobs (job_id TEXT PRIMARY KEY);",
  );

  await database.run("BEGIN EXCLUSIVE");

  return {
    released: new Promise<void>((resolveRelease, rejectRelease) => {
      setTimeout(() => {
        void (async () => {
          try {
            await database.run("COMMIT");
            await database.close();
            resolveRelease();
          } catch (error) {
            rejectRelease(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        })();
      }, 100);
    }),
  };
}

function requirePromise<T>(promise: Promise<T> | undefined): Promise<T> {
  if (promise === undefined) {
    throw new Error("Expected promise to be assigned.");
  }

  return promise;
}

function useStateDir(path: string): void {
  process.env.SPINEDIGEST_STATE_DIR = path;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

async function withTimeout<T>(
  promise: Promise<T>,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, 2_000);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

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

  it("recovers stale running jobs back to queued", async () => {
    await withTempDir("spinedigest-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.sdpub`,
        chapterId: 1,
        target: "graph",
      });

      await forceRunningPid(`${path}/state/state.sqlite`, job.jobId, 99999999);

      const jobs = await listBuildJobs();
      const updated = jobs.find((item) => item.jobId === job.jobId);

      expect(updated?.state).toBe("queued");
      expect(
        (await readBuildJobEvents(job)).map((event) => event.type),
      ).toContain("requeued");
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

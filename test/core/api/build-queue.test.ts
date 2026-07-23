import { access, writeFile } from "fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { Database } from "../../../packages/core/src/document/index.js";
import {
  addBuildJob,
  assertBuildJobInputRevision,
  assertNoActiveBuildJobConflicts,
  getBuildJob,
  listBuildJobs,
  readBuildJobEvents,
  resolveBuildJobId,
  runBuildJobWorker,
  boostBuildJob,
  updateBuildJobTarget,
  cancelBuildJob,
  recordBuildJobInputRevision,
} from "../../../packages/core/src/api/index.js";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../packages/core/src/runtime/common/wiki-graph/dir.js";
import { withTempDir } from "../../helpers/temp.js";

const originalStateDir = getWikiGraphStateDirectoryPathForTesting();

describe("facade/build-queue", () => {
  afterEach(() => {
    restoreWikiGraphStateDir(originalStateDir);
  });

  it("merges active reading lane jobs for an archive chapter", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);

      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-graph",
      });

      const merged = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-summary",
      });

      expect(merged.jobId).toBe(job.jobId);
      expect(merged.target).toBe("reading-summary");
      expect(await listBuildJobs()).toHaveLength(1);
      expect(
        (await readBuildJobEvents(job)).some(
          (event) => event.type === "target_changed",
        ),
      ).toBe(true);
    });
  });

  it("allows reading and knowledge graph lanes to run for the same chapter", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);

      const reading = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-summary",
      });
      const knowledge = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "knowledge-graph",
      });

      expect(knowledge.jobId).not.toBe(reading.jobId);
      expect((await listBuildJobs()).map((item) => item.target).sort()).toEqual(
        ["knowledge-graph", "reading-summary"],
      );
    });
  });

  it("boosts queued jobs to the front without changing running state", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const first = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-summary",
      });
      const second = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 2,
        target: "reading-summary",
      });

      await boostBuildJob(second.jobId);

      expect((await listBuildJobs()).map((job) => job.jobId)).toStrictEqual([
        second.jobId,
        first.jobId,
      ]);
    });
  });

  it("resolves unique job id prefixes and rejects ambiguous prefixes", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const first = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        jobId: "aaaaaaaa-1111-4111-8111-111111111111",
        target: "reading-summary",
      });
      const second = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 2,
        jobId: "aaaaaaaa-2222-4222-8222-222222222222",
        target: "reading-summary",
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
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-summary",
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
          await reporter.stepStarted("reading-summary");
          summaryStarted();
          await workerRelease;
          await reporter.throwIfStopped();
        },
        idleTimeoutMs: 0,
      });

      await summaryStartedSignal;
      await expect(
        updateBuildJobTarget(job.jobId, "reading-graph"),
      ).rejects.toThrow("Cannot downgrade");
      await cancelBuildJob(job.jobId);
      releaseWorker();
      await worker;
    });
  });

  it("rejects target changes that would collide with an active lane", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const reading = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-summary",
      });
      await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "knowledge-graph",
      });

      await expect(
        updateBuildJobTarget(reading.jobId, "knowledge-graph"),
      ).rejects.toThrow("already has active knowledge-graph job");
    });
  });

  it("blocks archive scoped mutations when any build job is active", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 2,
        target: "reading-summary",
      });

      await expect(
        assertNoActiveBuildJobConflicts({
          archivePath: `${path}/book.wikg`,
          operation: "Changing chapter tree",
          scope: { kind: "archive" },
        }),
      ).rejects.toThrow("Changing chapter tree is blocked");
      await expect(
        assertNoActiveBuildJobConflicts({
          archivePath: `${path}/book.wikg`,
          operation: "Setting unrelated chapter source",
          scope: { chapterIds: [1], kind: "chapter" },
        }),
      ).resolves.toBeUndefined();
    });
  });

  it("records and validates running job input revisions", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-summary",
      });

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async (runningJob) => {
          const recorded = await recordBuildJobInputRevision({
            currentRevision: 3,
            jobId: runningJob.jobId,
            ownerId: runningJob.ownerId!,
          });

          expect(recorded.inputRevision).toBe(3);
          await expect(
            assertBuildJobInputRevision({
              currentRevision: 3,
              jobId: runningJob.jobId,
              ownerId: runningJob.ownerId!,
            }),
          ).resolves.toBeUndefined();
          await expect(
            assertBuildJobInputRevision({
              currentRevision: 4,
              jobId: runningJob.jobId,
              ownerId: runningJob.ownerId!,
            }),
          ).rejects.toThrow("changed while job");
        },
        idleTimeoutMs: 0,
      });

      await expect(getBuildJob(job.jobId)).resolves.toMatchObject({
        inputRevision: 3,
        state: "succeeded",
      });
    });
  });

  it("writes structured events and keeps job cache and logs after removing succeeded work", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-graph",
      });

      expect(job.workspacePath).toBe(`${path}/state/jobs/work/${job.jobId}`);
      expect(job.cachePath).toBe(`${path}/state/jobs/cache/${job.jobId}`);
      expect(job.logPath).toBe(`${path}/state/jobs/logs/${job.jobId}`);
      expect(job.eventsPath).toBe(
        `${path}/state/jobs/events/${job.jobId}.ndjson`,
      );

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async (runningJob, reporter) => {
          await writeFile(`${runningJob.cachePath}/request.txt`, "cache");
          await writeFile(`${runningJob.logPath}/run.log`, "log");
          await reporter.setTotals({ totalGraphWords: 100 });
          await reporter.stepStarted("reading-graph");
          await reporter.updateWords({ graphWords: 50 });
          await reporter.addOutputCharacters(400);
          await reporter.stepCompleted("reading-graph");
        },
        idleTimeoutMs: 0,
      });

      const updated = await getBuildJob(job.jobId);
      const events = await readBuildJobEvents(job);

      expect(updated.state).toBe("succeeded");
      expect(events.map((event) => event.type)).toContain("succeeded");
      await expect(access(job.workspacePath)).rejects.toThrow();
      await expect(access(job.cachePath)).resolves.toBeUndefined();
      await expect(access(job.logPath)).resolves.toBeUndefined();
      await expect(access(job.eventsPath)).resolves.toBeUndefined();
    });
  });

  it("clamps progress words to configured totals", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-summary",
      });

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async (_job, reporter) => {
          await reporter.setTotals({
            totalGraphWords: 100,
            totalReadingSummaryWords: 50,
          });
          await reporter.updateWords({
            graphWords: 150,
            readingSummaryWords: 75,
          });
          await reporter.stepStarted("reading-summary");
        },
        idleTimeoutMs: 0,
      });

      const snapshots = (await readBuildJobEvents(job)).filter(
        (event) => event.type === "status_snapshot",
      );
      const latest = snapshots.at(-1);

      expect(latest).toMatchObject({
        counters: [
          {
            done: 50,
            name: "words",
            total: 50,
            unit: "word",
          },
        ],
      });
    });
  });

  it("records structured phase progress in snapshots", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "knowledge-graph",
      });

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async (_job, reporter) => {
          await reporter.setTotals({ totalGraphWords: 4888 });
          await reporter.stepStarted("knowledge-graph");
          await reporter.updatePhase({
            done: 3,
            phase: "grounding",
            total: 5,
            unit: "window",
          });
        },
        idleTimeoutMs: 0,
      });

      const snapshots = (await readBuildJobEvents(job)).filter(
        (event) => event.type === "status_snapshot",
      );
      const latest = snapshots.at(-1);

      expect(latest?.counters.some((counter) => counter.name === "words")).toBe(
        false,
      );
      expect(latest).toMatchObject({
        counters: [
          {
            done: 3,
            name: "windows",
            total: 5,
            unit: "window",
          },
        ],
        phase: "grounding",
        step: "knowledge-graph",
      });
    });
  });

  it("throttles non-forced phase progress snapshots", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "knowledge-graph",
      });

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async (_job, reporter) => {
          await reporter.stepStarted("knowledge-graph");
          await reporter.updatePhase({
            done: 0,
            phase: "matching",
            phaseDetail: "text",
            total: 100,
            unit: "char",
          });
          await reporter.updatePhase({
            done: 50,
            force: false,
            phase: "matching",
            phaseDetail: "text",
            total: 100,
            unit: "char",
          });
          await reporter.updatePhase({
            done: 100,
            phase: "matching",
            phaseDetail: "text",
            total: 100,
            unit: "char",
          });
        },
        idleTimeoutMs: 0,
      });

      const snapshots = (await readBuildJobEvents(job)).filter(
        (event) => event.type === "status_snapshot",
      );

      expect(
        snapshots.map((snapshot) =>
          snapshot.counters.find((counter) => counter.name === "text"),
        ),
      ).toStrictEqual([
        undefined,
        { done: 0, name: "text", total: 100, unit: "char" },
        { done: 100, name: "text", total: 100, unit: "char" },
      ]);
    });
  });

  it("keeps multiple counters for one progress phase", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "knowledge-graph",
      });

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async (_job, reporter) => {
          await reporter.stepStarted("knowledge-graph");
          await reporter.updatePhase({
            done: 600,
            phase: "enrichment",
            total: 3811,
            unit: "qid",
          });
          await reporter.updatePhase({
            done: 600,
            phase: "enrichment",
            phaseDetail: "entity",
            total: 3811,
            unit: "record",
          });
          await reporter.updatePhase({
            done: 58,
            phase: "enrichment",
            phaseDetail: "page",
            total: 58,
            unit: "page",
          });
        },
        idleTimeoutMs: 0,
      });

      const snapshots = (await readBuildJobEvents(job)).filter(
        (event) => event.type === "status_snapshot",
      );
      const latest = snapshots.at(-1);

      expect(latest).toMatchObject({
        counters: [
          { done: 600, name: "qids", total: 3811, unit: "qid" },
          { done: 600, name: "entity", total: 3811, unit: "record" },
          { done: 58, name: "page", total: 58, unit: "page" },
        ],
        phase: "enrichment",
        step: "knowledge-graph",
      });
    });
  });

  it("marks running jobs canceling before the worker confirms cancellation", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const first = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "knowledge-graph",
      });
      const second = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 2,
        target: "knowledge-graph",
      });
      let firstStarted!: () => void;
      let secondStarted!: () => void;
      let releaseCanceledJob!: () => void;
      const firstStartedSignal = new Promise<void>((resolveStarted) => {
        firstStarted = resolveStarted;
      });
      const secondStartedSignal = new Promise<void>((resolveStarted) => {
        secondStarted = resolveStarted;
      });
      const releaseCanceledJobSignal = new Promise<void>((resolveRelease) => {
        releaseCanceledJob = resolveRelease;
      });

      const worker = runBuildJobWorker({
        concurrency: 1,
        executeJob: async (job, reporter) => {
          if (job.jobId === first.jobId) {
            firstStarted();
            await releaseCanceledJobSignal;
            await reporter.updatePhase({
              done: 1,
              phase: "relation-discovery",
              total: 1,
              unit: "window",
            });
            return;
          }

          secondStarted();
        },
        idleTimeoutMs: 0,
      });

      await firstStartedSignal;
      expect((await cancelBuildJob(first.jobId)).state).toBe("canceling");
      expect((await getBuildJob(first.jobId)).state).toBe("canceling");
      releaseCanceledJob();
      await withTimeout(
        secondStartedSignal,
        "Timed out waiting for worker to continue after canceled job.",
      );
      await worker;

      expect((await getBuildJob(first.jobId)).state).toBe("canceled");
      expect((await getBuildJob(second.jobId)).state).toBe("succeeded");
      expect(
        (await readBuildJobEvents(first)).map((event) => event.type),
      ).toStrictEqual(expect.arrayContaining(["canceling", "canceled"]));
      expect(
        (await readBuildJobEvents(first)).map((event) => event.type),
      ).not.toContain("failed");
    });
  });

  it("aborts the running job context when a job is canceled", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "knowledge-graph",
      });
      let started!: () => void;
      const startedSignal = new Promise<void>((resolveStarted) => {
        started = resolveStarted;
      });
      let aborted = false;

      const worker = runBuildJobWorker({
        concurrency: 1,
        executeJob: async (_job, _reporter, context) => {
          started();
          await new Promise<void>((resolveAbort) => {
            if (context.signal.aborted) {
              resolveAbort();
              return;
            }

            context.signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                resolveAbort();
              },
              { once: true },
            );
          });
        },
        idleTimeoutMs: 0,
      });

      await startedSignal;
      await cancelBuildJob(job.jobId);
      await withTimeout(
        worker,
        "Timed out waiting for canceled job context to abort.",
      );

      expect(aborted).toBe(true);
      expect((await getBuildJob(job.jobId)).state).toBe("canceled");
    });
  });

  it("serializes concurrent progress snapshots", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "knowledge-graph",
      });

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async (_job, reporter) => {
          await reporter.stepStarted("knowledge-graph");
          await Promise.all(
            Array.from({ length: 20 }, async (_value, index) => {
              await reporter.updatePhase({
                done: index + 1,
                phase: "screening",
                total: 20,
                unit: "window",
              });
            }),
          );
        },
        idleTimeoutMs: 0,
      });

      const events = await readBuildJobEvents(job);

      expect(events.map((event) => event.seq)).toStrictEqual(
        Array.from({ length: events.length }, (_value, index) => index + 1),
      );
    });
  });

  it("continues claiming queued jobs after one job fails", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const failedJob = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-summary",
      });
      const succeededJob = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 2,
        target: "reading-summary",
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
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-summary",
      });
      let releaseLockPromise: Promise<void> | undefined;

      await runBuildJobWorker({
        concurrency: 1,
        executeJob: async () => {
          const lock = await lockSqliteDatabaseBriefly(
            `${path}/state/jobs/job.sqlite`,
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

  it("fails stale running jobs and removes their workspace", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      const job = await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-graph",
      });

      await forceRunningPid(
        `${path}/state/jobs/job.sqlite`,
        job.jobId,
        99999999,
      );

      const jobs = await listBuildJobs();
      const updated = jobs.find((item) => item.jobId === job.jobId);

      expect(updated).toBeUndefined();
      await expect(getBuildJob(job.jobId)).resolves.toMatchObject({
        state: "failed",
      });
      expect(
        (await readBuildJobEvents(job)).filter(
          (event) => event.type === "failed",
        ),
      ).toHaveLength(1);
      await expect(access(job.workspacePath)).rejects.toThrow();
    });
  });

  it("refills idle worker slots while other jobs are still running", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-graph",
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
        archivePath: `${path}/other-book.wikg`,
        chapterId: 2,
        target: "reading-graph",
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
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-graph",
      });
      await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 2,
        target: "reading-graph",
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
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-graph",
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

      await waitForRunningJob(
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

  async function waitForRunningJob(message: string): Promise<void> {
    await waitForRunningJobCount(1, message);
  }

  async function waitForRunningJobCount(
    count: number,
    message: string,
  ): Promise<void> {
    const deadline = Date.now() + 2_000;

    while (Date.now() < deadline) {
      if (
        (await listBuildJobs()).filter((job) => job.state === "running")
          .length >= count
      ) {
        return;
      }
      await delay(50);
    }

    throw new Error(message);
  }

  it("lists multiple running jobs when worker concurrency allows it", async () => {
    await withTempDir("wikigraph-build-queue-", async (path) => {
      useStateDir(`${path}/state`);
      await addBuildJob({
        archivePath: `${path}/book.wikg`,
        chapterId: 1,
        target: "reading-graph",
      });
      await addBuildJob({
        archivePath: `${path}/other-book.wikg`,
        chapterId: 2,
        target: "reading-graph",
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
  setWikiGraphStateDirectoryPathForTesting(path);
}

function restoreWikiGraphStateDir(value: string | undefined): void {
  setWikiGraphStateDirectoryPathForTesting(value);
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

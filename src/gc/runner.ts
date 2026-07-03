import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

import { resolveWikiGraphStateRootPath } from "../common/wiki-graph-temp.js";
import { runSearchCacheGc } from "../archive/query/index.js";
import { runBuildQueueGc } from "../facade/index.js";
import { runWikgCoordinatorGc } from "../wikg/index.js";
import { formatError } from "../utils/node-error.js";

import { tryAcquireGcLock } from "./lock.js";
import type { GcContext, GcJob, GcJobReport, GcRunReport } from "./types.js";

interface NamedGcJob {
  readonly name: string;
  readonly run: GcJob;
}

const GC_JOBS: readonly NamedGcJob[] = [
  {
    name: "wikg-coordinator",
    run: runWikgCoordinatorGc,
  },
  {
    name: "search-cache",
    run: runSearchCacheGc,
  },
  {
    name: "build-queue",
    run: runBuildQueueGc,
  },
  {
    name: "tmp",
    run: runTmpDirectoryGc,
  },
];
const OPPORTUNISTIC_GC_INTERVAL_MS = 10 * 60 * 1000;

export async function tryRunWikiGraphGc(
  options: {
    readonly dryRun?: boolean;
    readonly force?: boolean;
    readonly opportunistic?: boolean;
  } = {},
): Promise<GcRunReport> {
  const startedAt = Date.now();
  const stateDirectoryPath = resolveWikiGraphStateRootPath();
  const release = await tryAcquireGcLock();

  if (release === undefined) {
    return {
      finishedAt: Date.now(),
      freedBytes: 0,
      jobs: [],
      removed: 0,
      scanned: 0,
      skipped: true,
      startedAt,
    };
  }

  try {
    if (
      options.opportunistic === true &&
      !(await shouldRunOpportunisticGc(stateDirectoryPath, startedAt))
    ) {
      return {
        finishedAt: Date.now(),
        freedBytes: 0,
        jobs: [],
        removed: 0,
        scanned: 0,
        skipped: true,
        startedAt,
      };
    }

    const context: GcContext = {
      dryRun: options.dryRun === true,
      force: options.force === true,
      now: startedAt,
      stateDirectoryPath,
    };
    const jobs: GcJobReport[] = [];

    for (const job of GC_JOBS) {
      jobs.push(await runJob(job, context));
    }

    const report = {
      finishedAt: Date.now(),
      freedBytes: sum(jobs, "freedBytes"),
      jobs,
      removed: sum(jobs, "removed"),
      scanned: sum(jobs, "scanned"),
      skipped: false,
      startedAt,
    };

    await writeLastGcRunAt(stateDirectoryPath, report.finishedAt);
    return report;
  } finally {
    await release();
  }
}

async function runJob(
  job: NamedGcJob,
  context: GcContext,
): Promise<GcJobReport> {
  try {
    return {
      name: job.name,
      ...(await job.run(context)),
    };
  } catch (error) {
    return {
      error: formatError(error),
      freedBytes: 0,
      name: job.name,
      removed: 0,
      scanned: 0,
    };
  }
}

async function runTmpDirectoryGc(context: GcContext): Promise<{
  readonly freedBytes: number;
  readonly removed: number;
  readonly scanned: number;
}> {
  const { runTempDirectoryGc } = await import("./tmp-gc.js");

  return await runTempDirectoryGc(context);
}

function sum(jobs: readonly GcJobReport[], key: keyof GcJobReport): number {
  return jobs.reduce((total, job) => {
    const value = job[key];

    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

async function shouldRunOpportunisticGc(
  stateDirectoryPath: string,
  now: number,
): Promise<boolean> {
  const lastRunAt = Number(
    (
      await readFile(createLastGcRunPath(stateDirectoryPath), "utf8").catch(
        () => "",
      )
    ).trim(),
  );

  return (
    !Number.isFinite(lastRunAt) ||
    now - lastRunAt >= OPPORTUNISTIC_GC_INTERVAL_MS
  );
}

async function writeLastGcRunAt(
  stateDirectoryPath: string,
  at: number,
): Promise<void> {
  await mkdir(stateDirectoryPath, { recursive: true });
  await writeFile(createLastGcRunPath(stateDirectoryPath), `${at}\n`, "utf8");
}

function createLastGcRunPath(stateDirectoryPath: string): string {
  return join(stateDirectoryPath, "gc.last-run");
}

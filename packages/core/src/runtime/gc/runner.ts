import {
  ensureRelativeFile,
  getRelativeFile,
  getWikiGraphStorage,
  readFileText,
  writeFileContent,
} from "../platform/index.js";
import { runSearchCacheGc } from "../../retrieval/query/index.js";
import { runBuildQueueGc } from "../../api/index.js";
import { runWikgCoordinatorGc } from "../../storage/wikg/index.js";
import { runLibraryIndexGc } from "../../library/index.js";
import { runWikimediaCacheGc } from "../../external/wikipage/index.js";
import { formatError } from "../../utils/host-error.js";

import { tryAcquireGcLock } from "./lock.js";
import { runTempDirectoryGc } from "./temp.js";
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
    name: "library-index",
    run: runLibraryIndexGc,
  },
  {
    name: "build-queue",
    run: runBuildQueueGc,
  },
  {
    name: "wikimedia-cache",
    run: runWikimediaCacheGc,
  },
  {
    name: "tmp",
    run: runTempDirectoryGc,
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
      !(await shouldRunOpportunisticGc(startedAt))
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

    await writeLastGcRunAt(report.finishedAt).catch(() => undefined);
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

function sum(jobs: readonly GcJobReport[], key: keyof GcJobReport): number {
  return jobs.reduce((total, job) => {
    const value = job[key];

    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

async function shouldRunOpportunisticGc(now: number): Promise<boolean> {
  const file = await getRelativeFile(
    getWikiGraphStorage().library,
    "tmp/gc.last-run",
  );
  const lastRunAt = Number(
    (file === undefined ? "" : await readFileText(file).catch(() => "")).trim(),
  );

  return (
    !Number.isFinite(lastRunAt) ||
    now - lastRunAt >= OPPORTUNISTIC_GC_INTERVAL_MS
  );
}

async function writeLastGcRunAt(at: number): Promise<void> {
  const file = await ensureRelativeFile(
    getWikiGraphStorage().library,
    "tmp/gc.last-run",
  );
  await writeFileContent(file, `${at}\n`);
}

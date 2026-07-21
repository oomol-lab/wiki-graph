import { rm } from "fs/promises";
import { readPathSize, removeDisposableChildDirectories } from "../gc/files.js";
import type { GcContext, GcJobResult } from "../gc/index.js";
import { getBuildJobWorkspaceRootPath } from "./paths.js";
import { openBuildQueueDatabase } from "./database.js";
import { getNumber, mapBuildJob } from "./row.js";
import type { BuildJobState } from "./types.js";

export async function cleanBuildJobs(
  options: {
    readonly olderThanMs?: number;
    readonly states?: readonly BuildJobState[];
  } = {},
): Promise<number> {
  const state = await openBuildQueueDatabase();
  const cutoff = Date.now() - (options.olderThanMs ?? 7 * 24 * 60 * 60 * 1000);
  const states = options.states ?? ["succeeded", "failed", "canceled"];

  try {
    const placeholders = states.map(() => "?").join(", ");
    const jobs = await state.queryAll(
      `
SELECT *
FROM build_jobs
WHERE state IN (${placeholders})
  AND updated_at <= ?
`,
      [...states, cutoff],
      mapBuildJob,
    );

    for (const job of jobs) {
      await rm(job.workspacePath, { force: true, recursive: true });
      await rm(job.cachePath, { force: true, recursive: true });
      await rm(job.logPath, { force: true, recursive: true });
      await rm(job.eventsPath, { force: true });
      await state.run("DELETE FROM build_jobs WHERE job_id = ?", [job.jobId]);
    }

    return jobs.length;
  } finally {
    await state.close();
  }
}

export async function runBuildQueueGc(
  context: GcContext,
): Promise<GcJobResult> {
  const state = await openBuildQueueDatabase();
  const cutoff = context.force
    ? context.now
    : context.now - 7 * 24 * 60 * 60 * 1000;

  try {
    const scanned = await state.queryOne(
      "SELECT COUNT(*) AS count FROM build_jobs",
      undefined,
      (row) => getNumber(row, "count"),
    );
    const jobs = await state.queryAll(
      `
SELECT *
FROM build_jobs
WHERE state IN ('succeeded', 'failed', 'canceled')
  AND updated_at <= ?
`,
      [cutoff],
      mapBuildJob,
    );
    const childDirectories = context.dryRun
      ? { freedBytes: 0, removed: 0, scanned: 0 }
      : await removeDisposableChildDirectories(getBuildJobWorkspaceRootPath());
    let freedBytes = 0;

    for (const job of jobs) {
      freedBytes += await readPathSize(job.workspacePath);
      freedBytes += await readPathSize(job.cachePath);
      freedBytes += await readPathSize(job.logPath);
      freedBytes += await readPathSize(job.eventsPath);
      if (!context.dryRun) {
        await rm(job.workspacePath, { force: true, recursive: true });
        await rm(job.cachePath, { force: true, recursive: true });
        await rm(job.logPath, { force: true, recursive: true });
        await rm(job.eventsPath, { force: true });
        await state.run("DELETE FROM build_jobs WHERE job_id = ?", [job.jobId]);
      }
    }

    return {
      freedBytes: freedBytes + childDirectories.freedBytes,
      removed: jobs.length + childDirectories.removed,
      scanned: (scanned ?? 0) + childDirectories.scanned,
    };
  } finally {
    await state.close();
  }
}

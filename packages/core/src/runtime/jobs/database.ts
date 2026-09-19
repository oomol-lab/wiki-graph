import { Database, openWikiGraphStateDatabase } from "../../document/index.js";
import { getRelativeFile, getWikiGraphStorage } from "../platform/index.js";
import { BUILD_QUEUE_SCHEMA_SQL } from "./schema.js";
import { getNumber, getString, hydrateBuildJob, mapBuildJob } from "./row.js";
import type { BuildJob } from "./types.js";

export async function requireBuildJobById(
  state: Database,
  jobId: string,
): Promise<BuildJob> {
  const stored = await state.queryOne(
    "SELECT * FROM build_jobs WHERE job_id = ?",
    [jobId],
    mapBuildJob,
  );

  if (stored === undefined) {
    throw new Error(`Build job not found: ${jobId}`);
  }

  return await hydrateBuildJob(stored);
}

export async function resolveBuildJobIdInState(
  state: Database,
  jobIdPrefix: string,
): Promise<string> {
  const normalizedPrefix = jobIdPrefix.trim();

  if (normalizedPrefix === "") {
    throw new Error("Build job id is empty.");
  }

  const jobs = await state.queryAll(
    `
SELECT job_id
FROM build_jobs
WHERE substr(job_id, 1, ?) = ?
ORDER BY created_at DESC
`,
    [normalizedPrefix.length, normalizedPrefix],
    (row) => getString(row, "job_id"),
  );

  if (jobs.length === 0) {
    throw new Error(`Build job not found: ${jobIdPrefix}`);
  }
  if (jobs.length > 1) {
    throw new Error(
      `Build job id prefix is ambiguous: ${jobIdPrefix}. Matches: ${jobs.join(
        ", ",
      )}`,
    );
  }

  return jobs[0]!;
}

export async function readMaxQueueRank(state: Database): Promise<number> {
  return (
    (await state.queryOne(
      "SELECT COALESCE(MAX(queue_rank), 0) AS rank FROM build_jobs",
      undefined,
      (row) => getNumber(row, "rank"),
    )) ?? 0
  );
}

export async function readMinQueueRank(state: Database): Promise<number> {
  return (
    (await state.queryOne(
      "SELECT COALESCE(MIN(queue_rank), 0) AS rank FROM build_jobs",
      undefined,
      (row) => getNumber(row, "rank"),
    )) ?? 0
  );
}

export async function openBuildQueueDatabase(): Promise<Database> {
  const database = await openWikiGraphStateDatabase(
    "jobs/job.sqlite",
    BUILD_QUEUE_SCHEMA_SQL,
  );
  try {
    await database.run(`
      UPDATE build_jobs
      SET workspace_path = 'jobs/work/' || job_id,
          cache_path = 'jobs/cache/' || job_id,
          log_path = 'jobs/logs/' || job_id,
          events_path = 'jobs/events/' || job_id || '.ndjson'
      WHERE workspace_path NOT LIKE 'jobs/work/%'
         OR cache_path NOT LIKE 'jobs/cache/%'
         OR log_path NOT LIKE 'jobs/logs/%'
         OR events_path NOT LIKE 'jobs/events/%'
    `);
    return database;
  } catch (error) {
    await database.close().catch(() => undefined);
    throw error;
  }
}

export async function openReadonlyBuildQueueDatabase(): Promise<Database> {
  const file = await getRelativeFile(
    getWikiGraphStorage().library,
    "jobs/job.sqlite",
  );
  if (file === undefined) {
    throw new Error("Build queue is unavailable: jobs/job.sqlite");
  }
  return await Database.open(file, "", { mode: "readonly" });
}

import { openSharedStateDatabase } from "../../document/index.js";
import type { Database } from "../../document/index.js";
import { BUILD_QUEUE_SCHEMA_SQL } from "./schema.js";
import { getBuildQueueDatabasePath } from "./paths.js";
import { getNumber, getString, mapBuildJob } from "./row.js";
import type { BuildJob } from "./types.js";

export async function requireBuildJobById(
  state: Database,
  jobId: string,
): Promise<BuildJob> {
  const job = await state.queryOne(
    "SELECT * FROM build_jobs WHERE job_id = ?",
    [jobId],
    mapBuildJob,
  );

  if (job === undefined) {
    throw new Error(`Build job not found: ${jobId}`);
  }

  return job;
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
  return await openSharedStateDatabase(
    getBuildQueueDatabasePath(),
    BUILD_QUEUE_SCHEMA_SQL,
  );
}

export async function openReadonlyBuildQueueDatabase(): Promise<Database> {
  return await openBuildQueueDatabase();
}

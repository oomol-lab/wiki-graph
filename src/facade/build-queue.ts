import { createHash, randomUUID } from "crypto";
import { constants as fsConstants } from "fs";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";

import { Database } from "../document/index.js";

export const BUILD_JOB_STATES = [
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "canceled",
] as const;

export type BuildJobState = (typeof BUILD_JOB_STATES)[number];
export type BuildJobTarget = "graph" | "summary";

export interface BuildJob {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly chapterId: number;
  readonly createdAt: number;
  readonly currentStep?: BuildJobTarget;
  readonly errorJSON?: string;
  readonly eventsPath: string;
  readonly finishedAt?: number;
  readonly jobId: string;
  readonly llmJSON?: string;
  readonly ownerId?: string;
  readonly ownerPid?: number;
  readonly prompt?: string;
  readonly queueRank: number;
  readonly state: BuildJobState;
  readonly summaryStartedAt?: number;
  readonly target: BuildJobTarget;
  readonly updatedAt: number;
  readonly workspacePath: string;
}

export type BuildJobEvent =
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly state: BuildJobState;
      readonly type: "created" | "paused" | "resumed" | "boosted";
    }
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly from: BuildJobTarget;
      readonly to: BuildJobTarget;
      readonly type: "target_changed";
    }
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly state: "running";
      readonly type: "started";
    }
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly state: "queued";
      readonly type: "requeued";
    }
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly step: BuildJobTarget;
      readonly type: "step_started" | "step_completed";
    }
  | {
      readonly at: number;
      readonly graphWords: number;
      readonly jobId: string;
      readonly outputTokens: number;
      readonly seq: number;
      readonly step?: BuildJobTarget;
      readonly summaryWords: number;
      readonly totalGraphWords: number;
      readonly totalSummaryWords: number;
      readonly totalWords: number;
      readonly type: "progress_snapshot";
      readonly words: number;
    }
  | {
      readonly at: number;
      readonly error?: unknown;
      readonly jobId: string;
      readonly seq: number;
      readonly state: "failed" | "canceled" | "succeeded";
      readonly type: "failed" | "canceled" | "succeeded";
    };

export interface AddBuildJobOptions {
  readonly archivePath: string;
  readonly boost?: boolean;
  readonly chapterId: number;
  readonly jobId?: string;
  readonly llmJSON?: string;
  readonly prompt?: string;
  readonly target: BuildJobTarget;
}

export interface BuildJobListOptions {
  readonly activeOnly?: boolean;
  readonly all?: boolean;
  readonly archivePath?: string;
}

export interface BuildJobWorkerOptions {
  readonly concurrency: number;
  readonly executeJob: (
    job: BuildJob,
    reporter: BuildJobProgressReporter,
  ) => Promise<void>;
  readonly idleTimeoutMs?: number;
}

export interface BuildJobProgressReporter {
  addOutputCharacters(characters: number): Promise<void>;
  setTotals(input: {
    readonly totalGraphWords?: number;
    readonly totalSummaryWords?: number;
  }): Promise<void>;
  stepCompleted(step: BuildJobTarget): Promise<void>;
  stepStarted(step: BuildJobTarget): Promise<void>;
  updateWords(input: {
    readonly graphWords?: number;
    readonly summaryWords?: number;
  }): Promise<void>;
}

const BUILD_QUEUE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS build_jobs (
  job_id TEXT PRIMARY KEY,
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  chapter_id INTEGER NOT NULL,
  target TEXT NOT NULL,
  current_step TEXT,
  state TEXT NOT NULL,
  queue_rank INTEGER NOT NULL,
  workspace_path TEXT NOT NULL,
  events_path TEXT NOT NULL,
  llm_json TEXT,
  prompt TEXT,
  owner_id TEXT,
  owner_pid INTEGER,
  summary_started_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_json TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_build_jobs_active_chapter
ON build_jobs(archive_key, chapter_id)
WHERE state IN ('queued', 'running', 'paused');

CREATE INDEX IF NOT EXISTS idx_build_jobs_queue
ON build_jobs(state, queue_rank, updated_at);

CREATE TABLE IF NOT EXISTS build_worker_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_id TEXT,
  owner_pid INTEGER,
  heartbeat_at INTEGER
);

INSERT OR IGNORE INTO build_worker_lease (id)
VALUES (1);
`;

const ACTIVE_JOB_STATES = new Set<BuildJobState>([
  "queued",
  "running",
  "paused",
]);
const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;

export async function addBuildJob(
  options: AddBuildJobOptions,
): Promise<BuildJob> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    return await state.transaction(async () => {
      const archivePath = resolve(options.archivePath);
      const archiveKey = createArchiveKey(archivePath);
      const now = Date.now();
      const jobId = options.jobId ?? randomUUID();
      const workspacePath = await createJobWorkspacePath(archiveKey, jobId);
      const eventsPath = await createJobEventsPath(jobId);
      const queueRank =
        options.boost === true
          ? (await readMinQueueRank(state)) - 1
          : (await readMaxQueueRank(state)) + 1;

      await state.run(
        `
INSERT INTO build_jobs (
  job_id, archive_key, archive_path, chapter_id, target, state, queue_rank,
  workspace_path, events_path, llm_json, prompt, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
`,
        [
          jobId,
          archiveKey,
          archivePath,
          options.chapterId,
          options.target,
          queueRank,
          workspacePath,
          eventsPath,
          options.llmJSON ?? null,
          options.prompt ?? null,
          now,
          now,
        ],
      );

      const job = await requireBuildJobById(state, jobId);

      await appendBuildJobEvent(job, {
        at: now,
        jobId,
        seq: 0,
        state: "queued",
        type: "created",
      });
      return job;
    });
  } finally {
    await state.close();
  }
}

export async function listBuildJobs(
  options: BuildJobListOptions = {},
): Promise<BuildJob[]> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    const params: Array<number | string> = [];
    const filters: string[] = [];

    if (options.archivePath !== undefined) {
      params.push(createArchiveKey(resolve(options.archivePath)));
      filters.push("archive_key = ?");
    }
    if (options.activeOnly === true || options.all !== true) {
      filters.push("state IN ('queued', 'running', 'paused')");
    }

    return await state.queryAll(
      `
SELECT *
FROM build_jobs
${filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`}
ORDER BY
  CASE state
    WHEN 'running' THEN 0
    WHEN 'queued' THEN 1
    WHEN 'paused' THEN 2
    ELSE 3
  END,
  queue_rank ASC,
  updated_at DESC
`,
      params,
      mapBuildJob,
    );
  } finally {
    await state.close();
  }
}

export async function getBuildJob(jobId: string): Promise<BuildJob> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    return await requireBuildJobById(state, jobId);
  } finally {
    await state.close();
  }
}

export async function resolveBuildJobId(jobIdPrefix: string): Promise<string> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    return await resolveBuildJobIdInState(state, jobIdPrefix);
  } finally {
    await state.close();
  }
}

export async function pauseBuildJob(jobId: string): Promise<BuildJob> {
  return await updateBuildJobState(jobId, "paused", "paused", {
    allowedStates: ["queued", "running"],
  });
}

export async function resumeBuildJob(jobId: string): Promise<BuildJob> {
  return await updateBuildJobState(jobId, "queued", "resumed", {
    allowedStates: ["paused"],
    clearOwner: true,
  });
}

export async function cancelBuildJob(jobId: string): Promise<BuildJob> {
  return await updateBuildJobState(jobId, "canceled", "canceled", {
    allowedStates: ["queued", "running", "paused"],
    finished: true,
  });
}

export async function boostBuildJob(jobId: string): Promise<BuildJob> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    return await state.transaction(async () => {
      const job = await requireBuildJobById(state, jobId);

      if (job.state !== "queued") {
        throw new Error(
          `Only queued jobs can be boosted. Job ${jobId} is ${job.state}.`,
        );
      }

      const now = Date.now();
      await state.run(
        `
UPDATE build_jobs
SET queue_rank = ?, updated_at = ?
WHERE job_id = ?
`,
        [(await readMinQueueRank(state)) - 1, now, jobId],
      );

      const updated = await requireBuildJobById(state, jobId);
      await appendBuildJobEvent(updated, {
        at: now,
        jobId,
        seq: 0,
        state: "queued",
        type: "boosted",
      });
      return updated;
    });
  } finally {
    await state.close();
  }
}

export async function updateBuildJobTarget(
  jobId: string,
  target: BuildJobTarget,
): Promise<BuildJob> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    return await state.transaction(async () => {
      const job = await requireBuildJobById(state, jobId);

      if (!ACTIVE_JOB_STATES.has(job.state)) {
        throw new Error(`Cannot change target for ${job.state} job ${jobId}.`);
      }
      if (job.target === target) {
        return job;
      }
      if (job.target === "summary" && target === "graph") {
        if (
          job.summaryStartedAt !== undefined ||
          job.currentStep === "summary"
        ) {
          throw new Error(
            `Cannot downgrade job ${jobId} after summary has started. Cancel it explicitly instead.`,
          );
        }
      }

      const now = Date.now();
      await state.run(
        `
UPDATE build_jobs
SET target = ?, updated_at = ?
WHERE job_id = ?
`,
        [target, now, jobId],
      );

      const updated = await requireBuildJobById(state, jobId);
      await appendBuildJobEvent(updated, {
        at: now,
        from: job.target,
        jobId,
        seq: 0,
        to: target,
        type: "target_changed",
      });
      return updated;
    });
  } finally {
    await state.close();
  }
}

export async function assertNoActiveBuildJobs(input: {
  readonly archivePath: string;
  readonly chapterIds: readonly number[];
  readonly operation: string;
  readonly requiresTarget?: BuildJobTarget;
}): Promise<void> {
  if (input.chapterIds.length === 0) {
    return;
  }

  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    const archiveKey = createArchiveKey(resolve(input.archivePath));
    const placeholders = input.chapterIds.map(() => "?").join(", ");
    const params: Array<number | string> = [archiveKey, ...input.chapterIds];
    const targetFilter =
      input.requiresTarget === undefined ? "" : "AND target = ?";

    if (input.requiresTarget !== undefined) {
      params.push(input.requiresTarget);
    }

    const job = await state.queryOne(
      `
SELECT *
FROM build_jobs
WHERE archive_key = ?
  AND chapter_id IN (${placeholders})
  AND state IN ('queued', 'running', 'paused')
  ${targetFilter}
ORDER BY updated_at DESC
LIMIT 1
`,
      params,
      mapBuildJob,
    );

    if (job === undefined) {
      return;
    }

    throw new Error(
      `Chapter ${job.chapterId} has active ${job.target} job ${job.jobId}. ${input.operation} is blocked until the job is paused/canceled or completed.`,
    );
  } finally {
    await state.close();
  }
}

export async function runBuildJobWorker(
  options: BuildJobWorkerOptions,
): Promise<void> {
  const state = await openBuildQueueDatabase();
  const ownerId = `${process.pid}-${randomUUID()}`;
  const concurrency = Math.max(1, options.concurrency);
  const idleTimeoutMs = options.idleTimeoutMs ?? 10_000;
  let stopping = false;
  let busySlotCount = 0;
  let idleSince = Date.now();

  const stop = (): void => {
    stopping = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const heartbeat = setInterval(() => {
    void heartbeatBuildWorker(ownerId).catch(() => undefined);
  }, WORKER_HEARTBEAT_INTERVAL_MS);

  try {
    const acquired = await acquireBuildWorkerLease(state, ownerId);

    if (!acquired) {
      return;
    }

    const runSlot = async (): Promise<void> => {
      while (!stopping) {
        await heartbeatBuildWorker(ownerId, state);
        await recoverStaleBuildJobs(state);

        busySlotCount += 1;
        let job: BuildJob | undefined;

        try {
          job = await claimQueuedBuildJob(state, ownerId);
        } finally {
          if (job === undefined) {
            busySlotCount -= 1;
          }
        }

        if (job === undefined) {
          if (busySlotCount === 0 && Date.now() - idleSince >= idleTimeoutMs) {
            break;
          }
          await delay(500);
          continue;
        }

        idleSince = Date.now();

        try {
          await executeClaimedBuildJob(job, ownerId, options);
        } finally {
          busySlotCount -= 1;
          if (busySlotCount === 0) {
            idleSince = Date.now();
          }
        }
      }
    };

    await Promise.all(
      Array.from({ length: concurrency }, async () => await runSlot()),
    );
  } finally {
    clearInterval(heartbeat);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await releaseBuildWorkerLease(state, ownerId);
    await state.close();
  }
}

async function executeClaimedBuildJob(
  job: BuildJob,
  ownerId: string,
  options: BuildJobWorkerOptions,
): Promise<void> {
  const reporter = new BuildJobProgressAccumulator(job);

  try {
    await appendBuildJobEvent(job, {
      at: Date.now(),
      jobId: job.jobId,
      seq: 0,
      state: "running",
      type: "started",
    });
    await options.executeJob(job, reporter);
    await markBuildJobSucceeded(job.jobId, ownerId);
  } catch (error) {
    await markBuildJobFailed(job.jobId, ownerId, error);
  }
}

export async function readBuildJobEvents(
  job: Pick<BuildJob, "eventsPath">,
): Promise<BuildJobEvent[]> {
  let content: string;

  try {
    content = await readFile(job.eventsPath, "utf8");
  } catch {
    return [];
  }

  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as BuildJobEvent);
}

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
      await rm(job.eventsPath, { force: true });
      await state.run("DELETE FROM build_jobs WHERE job_id = ?", [job.jobId]);
    }

    return jobs.length;
  } finally {
    await state.close();
  }
}

async function updateBuildJobState(
  jobId: string,
  stateName: BuildJobState,
  eventType: Extract<BuildJobEvent["type"], "paused" | "resumed" | "canceled">,
  options: {
    readonly allowedStates: readonly BuildJobState[];
    readonly clearOwner?: boolean;
    readonly finished?: boolean;
  },
): Promise<BuildJob> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    return await state.transaction(async () => {
      const job = await requireBuildJobById(state, jobId);

      if (!options.allowedStates.includes(job.state)) {
        throw new Error(`Cannot ${eventType} ${job.state} job ${jobId}.`);
      }

      const now = Date.now();
      await state.run(
        `
UPDATE build_jobs
SET state = ?, updated_at = ?, finished_at = ?,
    owner_id = CASE WHEN ? = 1 THEN NULL ELSE owner_id END,
    owner_pid = CASE WHEN ? = 1 THEN NULL ELSE owner_pid END
WHERE job_id = ?
`,
        [
          stateName,
          now,
          options.finished === true ? now : null,
          options.clearOwner === true || options.finished === true ? 1 : 0,
          options.clearOwner === true || options.finished === true ? 1 : 0,
          jobId,
        ],
      );

      const updated = await requireBuildJobById(state, jobId);
      await appendBuildJobEvent(updated, {
        at: now,
        jobId,
        seq: 0,
        state: stateName as "queued" | "paused" | "canceled",
        type: eventType,
      } as BuildJobEvent);
      return updated;
    });
  } finally {
    await state.close();
  }
}

async function markBuildJobSucceeded(
  jobId: string,
  ownerId: string,
): Promise<void> {
  const state = await openBuildQueueDatabase();

  try {
    await state.transaction(async () => {
      const job = await requireBuildJobById(state, jobId);

      if (job.ownerId !== ownerId || job.state !== "running") {
        return;
      }

      const now = Date.now();
      await state.run(
        `
UPDATE build_jobs
SET state = 'succeeded', owner_id = NULL, owner_pid = NULL,
    current_step = NULL, finished_at = ?, updated_at = ?
WHERE job_id = ?
`,
        [now, now, jobId],
      );
      await appendBuildJobEvent(job, {
        at: now,
        jobId,
        seq: 0,
        state: "succeeded",
        type: "succeeded",
      });
      await rm(job.workspacePath, { force: true, recursive: true });
    });
  } finally {
    await state.close();
  }
}

async function markBuildJobFailed(
  jobId: string,
  ownerId: string,
  error: unknown,
): Promise<void> {
  const state = await openBuildQueueDatabase();

  try {
    await state.transaction(async () => {
      const job = await requireBuildJobById(state, jobId);

      if (job.ownerId !== ownerId || job.state !== "running") {
        return;
      }

      const now = Date.now();
      const errorJSON = JSON.stringify(formatErrorEvent(error));

      await state.run(
        `
UPDATE build_jobs
SET state = 'failed', owner_id = NULL, owner_pid = NULL,
    finished_at = ?, updated_at = ?, error_json = ?
WHERE job_id = ?
`,
        [now, now, errorJSON, jobId],
      );
      await appendBuildJobEvent(job, {
        at: now,
        error: formatErrorEvent(error),
        jobId,
        seq: 0,
        state: "failed",
        type: "failed",
      });
    });
  } finally {
    await state.close();
  }
}

async function claimQueuedBuildJob(
  state: Database,
  ownerId: string,
): Promise<BuildJob | undefined> {
  return await state.transaction(async () => {
    const job = await state.queryOne(
      `
SELECT *
FROM build_jobs
WHERE state = 'queued'
ORDER BY queue_rank ASC, created_at ASC
LIMIT 1
`,
      undefined,
      mapBuildJob,
    );

    if (job === undefined) {
      return undefined;
    }

    const now = Date.now();
    await state.run(
      `
UPDATE build_jobs
SET state = 'running', owner_id = ?, owner_pid = ?, updated_at = ?
WHERE job_id = ? AND state = 'queued'
`,
      [ownerId, process.pid, now, job.jobId],
    );

    return await requireBuildJobById(state, job.jobId);
  });
}

async function recoverStaleBuildJobs(state: Database): Promise<void> {
  const jobs = await state.queryAll(
    `
SELECT *
FROM build_jobs
WHERE state = 'running'
  AND owner_pid IS NOT NULL
`,
    undefined,
    mapBuildJob,
  );

  for (const job of jobs) {
    if (job.ownerPid !== undefined && isProcessAlive(job.ownerPid)) {
      continue;
    }

    const now = Date.now();
    await state.run(
      `
UPDATE build_jobs
SET state = 'queued', owner_id = NULL, owner_pid = NULL,
    current_step = NULL, updated_at = ?
WHERE job_id = ?
`,
      [now, job.jobId],
    );
    await appendBuildJobEvent(job, {
      at: now,
      jobId: job.jobId,
      seq: 0,
      state: "queued",
      type: "requeued",
    });
  }
}

async function acquireBuildWorkerLease(
  state: Database,
  ownerId: string,
): Promise<boolean> {
  await recoverStaleBuildWorkerLease(state);

  return await state.transaction(async () => {
    const lease = await state.queryOne(
      `
SELECT owner_pid
FROM build_worker_lease
WHERE id = 1
`,
      undefined,
      (row) => ({
        ownerPid:
          row.owner_pid === null ? undefined : getNumber(row, "owner_pid"),
      }),
    );

    if (lease?.ownerPid !== undefined && isProcessAlive(lease.ownerPid)) {
      return false;
    }

    await state.run(
      `
UPDATE build_worker_lease
SET owner_id = ?, owner_pid = ?, heartbeat_at = ?
WHERE id = 1
`,
      [ownerId, process.pid, Date.now()],
    );
    return true;
  });
}

async function heartbeatBuildWorker(
  ownerId: string,
  existingState?: Database,
): Promise<void> {
  const state = existingState ?? (await openBuildQueueDatabase());

  try {
    await state.run(
      `
UPDATE build_worker_lease
SET heartbeat_at = ?
WHERE id = 1 AND owner_id = ?
`,
      [Date.now(), ownerId],
    );
  } finally {
    if (existingState === undefined) {
      await state.close();
    }
  }
}

async function releaseBuildWorkerLease(
  state: Database,
  ownerId: string,
): Promise<void> {
  await state.run(
    `
UPDATE build_worker_lease
SET owner_id = NULL, owner_pid = NULL, heartbeat_at = NULL
WHERE id = 1 AND owner_id = ?
`,
    [ownerId],
  );
}

async function recoverStaleBuildWorkerLease(state: Database): Promise<void> {
  const lease = await state.queryOne(
    `
SELECT owner_id, owner_pid
FROM build_worker_lease
WHERE id = 1
`,
    undefined,
    (row) => ({
      ownerId: getOptionalString(row, "owner_id"),
      ownerPid:
        row.owner_pid === null ? undefined : getNumber(row, "owner_pid"),
    }),
  );

  if (lease?.ownerPid === undefined || isProcessAlive(lease.ownerPid)) {
    return;
  }

  await state.run(
    `
UPDATE build_worker_lease
SET owner_id = NULL, owner_pid = NULL, heartbeat_at = NULL
WHERE id = 1
`,
  );
}

async function requireBuildJobById(
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

async function resolveBuildJobIdInState(
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

async function appendBuildJobEvent(
  job: Pick<BuildJob, "eventsPath" | "jobId">,
  event: BuildJobEvent,
): Promise<void> {
  const seq = (await readLastBuildJobEventSeq(job)) + 1;
  const nextEvent = {
    ...event,
    jobId: job.jobId,
    seq,
  };

  await appendFile(job.eventsPath, `${JSON.stringify(nextEvent)}\n`, "utf8");
}

async function readLastBuildJobEventSeq(
  job: Pick<BuildJob, "eventsPath">,
): Promise<number> {
  const events = await readBuildJobEvents(job);

  return events.at(-1)?.seq ?? 0;
}

async function readMaxQueueRank(state: Database): Promise<number> {
  return (
    (await state.queryOne(
      "SELECT COALESCE(MAX(queue_rank), 0) AS rank FROM build_jobs",
      undefined,
      (row) => getNumber(row, "rank"),
    )) ?? 0
  );
}

async function readMinQueueRank(state: Database): Promise<number> {
  return (
    (await state.queryOne(
      "SELECT COALESCE(MIN(queue_rank), 0) AS rank FROM build_jobs",
      undefined,
      (row) => getNumber(row, "rank"),
    )) ?? 0
  );
}

async function openBuildQueueDatabase(): Promise<Database> {
  const directoryPath = getBuildQueueStateDirectoryPath();
  const databasePath = join(directoryPath, "build-queue.sqlite");

  await mkdir(directoryPath, { recursive: true });
  await copyLegacyStateDatabaseIfNeeded(directoryPath, databasePath);
  return await Database.open(databasePath, BUILD_QUEUE_SCHEMA_SQL);
}

async function createJobWorkspacePath(
  archiveKey: string,
  jobId: string,
): Promise<string> {
  const rootPath = join(
    getBuildQueueStateDirectoryPath(),
    "build-jobs",
    archiveKey,
  );

  await mkdir(rootPath, { recursive: true });
  return await mkdtemp(join(rootPath, `${jobId}-`));
}

async function createJobEventsPath(jobId: string): Promise<string> {
  const rootPath = join(getBuildQueueStateDirectoryPath(), "build-events");

  await mkdir(rootPath, { recursive: true });
  return join(rootPath, `${jobId}.ndjson`);
}

function getBuildQueueStateDirectoryPath(): string {
  const stateDirectoryPath = process.env.SPINEDIGEST_STATE_DIR;

  if (stateDirectoryPath !== undefined && stateDirectoryPath.trim() !== "") {
    return resolve(stateDirectoryPath);
  }

  return join(homedir(), ".spinedigest", "state");
}

async function copyLegacyStateDatabaseIfNeeded(
  directoryPath: string,
  databasePath: string,
): Promise<void> {
  try {
    if ((await stat(databasePath)).size > 0) {
      return;
    }
    await rm(databasePath, { force: true });
  } catch {
    await rm(databasePath, { force: true });
  }

  try {
    const legacyDatabasePath = join(directoryPath, "state.sqlite");

    if (!(await legacyDatabaseHasTable(legacyDatabasePath, "build_jobs"))) {
      return;
    }

    await copyFile(legacyDatabasePath, databasePath, fsConstants.COPYFILE_EXCL);
  } catch {
    return;
  }
}

async function legacyDatabaseHasTable(
  databasePath: string,
  tableName: string,
): Promise<boolean> {
  const database = await Database.open(databasePath, "");

  try {
    return (
      (await database.queryOne(
        "SELECT 1 AS matched FROM sqlite_master WHERE type = 'table' AND name = ?",
        [tableName],
        () => true,
      )) ?? false
    );
  } finally {
    await database.close();
  }
}

function mapBuildJob(row: Record<string, unknown>): BuildJob {
  const currentStep = parseOptionalBuildJobTarget(
    getOptionalString(row, "current_step"),
    "current_step",
  );
  const ownerId = getOptionalString(row, "owner_id");
  const ownerPid =
    row.owner_pid === null ? undefined : getNumber(row, "owner_pid");
  const summaryStartedAt =
    row.summary_started_at === null
      ? undefined
      : getNumber(row, "summary_started_at");
  const finishedAt =
    row.finished_at === null ? undefined : getNumber(row, "finished_at");
  const errorJSON = getOptionalString(row, "error_json");
  const llmJSON = getOptionalString(row, "llm_json");
  const prompt = getOptionalString(row, "prompt");

  return {
    archiveKey: getString(row, "archive_key"),
    archivePath: getString(row, "archive_path"),
    chapterId: getNumber(row, "chapter_id"),
    createdAt: getNumber(row, "created_at"),
    ...(currentStep === undefined ? {} : { currentStep }),
    ...(errorJSON === undefined ? {} : { errorJSON }),
    eventsPath: getString(row, "events_path"),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    jobId: getString(row, "job_id"),
    ...(llmJSON === undefined ? {} : { llmJSON }),
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(ownerPid === undefined ? {} : { ownerPid }),
    ...(prompt === undefined ? {} : { prompt }),
    queueRank: getNumber(row, "queue_rank"),
    state: parseBuildJobState(getString(row, "state")),
    ...(summaryStartedAt === undefined ? {} : { summaryStartedAt }),
    target: parseBuildJobTarget(getString(row, "target"), "target"),
    updatedAt: getNumber(row, "updated_at"),
    workspacePath: getString(row, "workspace_path"),
  };
}

function parseBuildJobState(value: string): BuildJobState {
  if (BUILD_JOB_STATES.includes(value as BuildJobState)) {
    return value as BuildJobState;
  }

  throw new Error(`Invalid build job state: ${value}`);
}

function parseBuildJobTarget(value: string, field: string): BuildJobTarget {
  if (value === "graph" || value === "summary") {
    return value;
  }

  throw new Error(`Invalid ${field}: ${value}`);
}

function parseOptionalBuildJobTarget(
  value: string | undefined,
  field: string,
): BuildJobTarget | undefined {
  return value === undefined ? undefined : parseBuildJobTarget(value, field);
}

function getString(row: Record<string, unknown>, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

function getNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}

function getOptionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

function createArchiveKey(archivePath: string): string {
  return createHash("sha256").update(resolve(archivePath)).digest("hex");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function formatErrorEvent(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return error;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

class BuildJobProgressAccumulator implements BuildJobProgressReporter {
  readonly #job: BuildJob;
  readonly #outputCharactersPerToken = 4;
  readonly #refreshIntervalMs = 5_000;
  #graphWords = 0;
  #lastSnapshotAt = 0;
  #outputCharacters = 0;
  #step: BuildJobTarget | undefined;
  #summaryWords = 0;
  #totalGraphWords = 0;
  #totalSummaryWords = 0;

  public constructor(job: BuildJob) {
    this.#job = job;
  }

  public async addOutputCharacters(characters: number): Promise<void> {
    this.#outputCharacters += characters;
    await this.#snapshot();
  }

  public async setTotals(input: {
    readonly totalGraphWords?: number;
    readonly totalSummaryWords?: number;
  }): Promise<void> {
    this.#totalGraphWords = input.totalGraphWords ?? this.#totalGraphWords;
    this.#totalSummaryWords =
      input.totalSummaryWords ?? this.#totalSummaryWords;
    await this.#snapshot(true);
  }

  public async stepStarted(step: BuildJobTarget): Promise<void> {
    this.#step = step;
    await markBuildJobStep(this.#job.jobId, step);
    await appendBuildJobEvent(this.#job, {
      at: Date.now(),
      jobId: this.#job.jobId,
      seq: 0,
      step,
      type: "step_started",
    });
    await this.#snapshot(true);
  }

  public async stepCompleted(step: BuildJobTarget): Promise<void> {
    this.#step = step;
    await appendBuildJobEvent(this.#job, {
      at: Date.now(),
      jobId: this.#job.jobId,
      seq: 0,
      step,
      type: "step_completed",
    });
    await this.#snapshot(true);
  }

  public async updateWords(input: {
    readonly graphWords?: number;
    readonly summaryWords?: number;
  }): Promise<void> {
    this.#graphWords =
      input.graphWords === undefined
        ? this.#graphWords
        : clampProgressWords(input.graphWords, this.#totalGraphWords);
    this.#summaryWords =
      input.summaryWords === undefined
        ? this.#summaryWords
        : clampProgressWords(input.summaryWords, this.#totalSummaryWords);
    await this.#snapshot();
  }

  async #snapshot(force = false): Promise<void> {
    const now = Date.now();

    if (!force && now - this.#lastSnapshotAt < this.#refreshIntervalMs) {
      return;
    }

    this.#lastSnapshotAt = now;
    await appendBuildJobEvent(this.#job, {
      at: now,
      graphWords: this.#graphWords,
      jobId: this.#job.jobId,
      outputTokens: Math.floor(
        this.#outputCharacters / this.#outputCharactersPerToken,
      ),
      seq: 0,
      ...(this.#step === undefined ? {} : { step: this.#step }),
      summaryWords: this.#summaryWords,
      totalGraphWords: this.#totalGraphWords,
      totalSummaryWords: this.#totalSummaryWords,
      totalWords: this.#getCurrentTotalWords(),
      type: "progress_snapshot",
      words: this.#getCurrentWords(),
    });
  }

  #getCurrentTotalWords(): number {
    switch (this.#step) {
      case "graph":
        return this.#totalGraphWords;
      case "summary":
        return this.#totalSummaryWords;
      case undefined:
        return 0;
    }
  }

  #getCurrentWords(): number {
    switch (this.#step) {
      case "graph":
        return this.#graphWords;
      case "summary":
        return this.#summaryWords;
      case undefined:
        return 0;
    }
  }
}

function clampProgressWords(words: number, totalWords: number): number {
  if (totalWords <= 0) {
    return Math.max(0, words);
  }

  return Math.min(totalWords, Math.max(0, words));
}

async function markBuildJobStep(
  jobId: string,
  step: BuildJobTarget,
): Promise<void> {
  const state = await openBuildQueueDatabase();

  try {
    await state.run(
      `
UPDATE build_jobs
SET current_step = ?,
    summary_started_at = CASE
      WHEN ? = 'summary' AND summary_started_at IS NULL THEN ?
      ELSE summary_started_at
    END,
    updated_at = ?
WHERE job_id = ?
`,
      [step, step, Date.now(), Date.now(), jobId],
    );
  } finally {
    await state.close();
  }
}

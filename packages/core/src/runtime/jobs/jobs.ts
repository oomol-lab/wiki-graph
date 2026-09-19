import { randomUuid } from "../../utils/crypto.js";
import type { Database } from "../../document/index.js";
import {
  createJobCache,
  createJobEvents,
  createJobLog,
  createJobWorkspace,
  getJobCachePath,
  getJobEventsPath,
  getJobLogPath,
  getJobWorkspacePath,
} from "./paths.js";
import { createArchiveKey } from "./helpers.js";
import { BuildJobStoppedError } from "./progress.js";
import { appendBuildJobEvent } from "./events.js";
import {
  openBuildQueueDatabase,
  openReadonlyBuildQueueDatabase,
  readMaxQueueRank,
  readMinQueueRank,
  requireBuildJobById,
  resolveBuildJobIdInState,
} from "./database.js";
import { recoverStaleBuildJobs } from "./recovery.js";
import { markBuildJobCanceled, markBuildJobCanceling } from "./state.js";
import { formatBuildJobLane, hydrateBuildJob, mapBuildJob } from "./row.js";
import type {
  AddBuildJobOptions,
  BuildJob,
  BuildJobEvent,
  BuildJobListOptions,
  BuildJobState,
  BuildJobTarget,
} from "./types.js";

const ACTIVE_JOB_STATES = new Set<BuildJobState>([
  "queued",
  "running",
  "canceling",
  "paused",
]);
export async function addBuildJob(
  options: AddBuildJobOptions,
): Promise<BuildJob> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    return await state.transaction(async () => {
      const archiveKey = createArchiveKey(options.archive);
      const now = Date.now();
      const existing = await findActiveBuildJobInLane(state, {
        archiveKey,
        chapterId: options.chapterId,
        target: options.target,
      });

      if (existing !== undefined) {
        return await mergeActiveBuildJob(state, existing, options, now);
      }

      const jobId = options.jobId ?? randomUuid();
      await Promise.all([
        createJobWorkspace(jobId),
        createJobCache(jobId),
        createJobLog(jobId),
        createJobEvents(jobId),
      ]);
      const queueRank =
        options.boost === true
          ? (await readMinQueueRank(state)) - 1
          : (await readMaxQueueRank(state)) + 1;

      await state.run(
        `
INSERT INTO build_jobs (
  job_id, archive_key, archive_path, chapter_id, target, state, queue_rank,
  workspace_path, cache_path, log_path, events_path, llm_json, prompt,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
        [
          jobId,
          archiveKey,
          options.archive.identity,
          options.chapterId,
          options.target,
          queueRank,
          getJobWorkspacePath(jobId),
          getJobCachePath(jobId),
          getJobLogPath(jobId),
          getJobEventsPath(jobId),
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

export async function recordBuildJobInputRevision(input: {
  readonly currentRevision: number;
  readonly jobId: string;
  readonly ownerId: string;
}): Promise<BuildJob> {
  const state = await openBuildQueueDatabase();

  try {
    await state.transaction(async () => {
      await state.run(
        `
UPDATE build_jobs
SET input_revision = ?,
    updated_at = ?
WHERE job_id = ?
  AND owner_id = ?
  AND state = 'running'
`,
        [input.currentRevision, Date.now(), input.jobId, input.ownerId],
      );
    });

    return await requireBuildJobById(state, input.jobId);
  } finally {
    await state.close();
  }
}

export async function assertBuildJobInputRevision(input: {
  readonly currentRevision: number;
  readonly jobId: string;
  readonly ownerId: string;
}): Promise<void> {
  const job = await getBuildJob(input.jobId);

  if (job.state !== "running" || job.ownerId !== input.ownerId) {
    throw new BuildJobStoppedError(
      `Job ${input.jobId} is ${job.state}. Stop current worker execution.`,
    );
  }
  if (job.inputRevision === undefined) {
    throw new Error(
      `Job ${input.jobId} has no recorded chapter input revision. Requeue the job before committing build output.`,
    );
  }
  if (job.inputRevision === input.currentRevision) {
    return;
  }

  throw new Error(
    `Chapter ${job.chapterId} changed while job ${job.jobId} was running. Requeue the job before committing build output.`,
  );
}

export async function listBuildJobs(
  options: BuildJobListOptions = {},
): Promise<BuildJob[]> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    const params: Array<number | string> = [];
    const filters: string[] = [];

    if (options.archive !== undefined) {
      params.push(createArchiveKey(options.archive));
      filters.push("archive_key = ?");
    }
    if (options.activeOnly === true || options.all !== true) {
      filters.push("state IN ('queued', 'running', 'canceling', 'paused')");
    }

    const jobs = await state.queryAll(
      `
SELECT *
FROM build_jobs
${filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`}
ORDER BY
  CASE state
    WHEN 'running' THEN 0
    WHEN 'canceling' THEN 1
    WHEN 'queued' THEN 2
    WHEN 'paused' THEN 3
    ELSE 4
  END,
  queue_rank ASC,
  updated_at DESC
`,
      params,
      mapBuildJob,
    );
    return await Promise.all(jobs.map(hydrateBuildJob));
  } finally {
    await state.close();
  }
}

async function findActiveBuildJobInLane(
  state: Database,
  input: {
    readonly archiveKey: string;
    readonly chapterId: number;
    readonly target: BuildJobTarget;
  },
): Promise<BuildJob | undefined> {
  const laneFilter = createBuildJobLaneFilter(input.target);

  const job = await state.queryOne(
    `
SELECT *
FROM build_jobs
WHERE archive_key = ?
  AND chapter_id = ?
  AND state IN ('queued', 'running', 'canceling', 'paused')
  AND ${laneFilter}
ORDER BY updated_at DESC
LIMIT 1
`,
    [input.archiveKey, input.chapterId],
    mapBuildJob,
  );
  return job === undefined ? undefined : await hydrateBuildJob(job);
}

function createBuildJobLaneFilter(target: BuildJobTarget): string {
  switch (target) {
    case "knowledge-graph":
      return "target = 'knowledge-graph'";
    case "reading-graph":
    case "reading-summary":
      return "target IN ('reading-graph', 'reading-summary')";
    case "index-fts":
      return "target = 'index-fts'";
    case "index-embedding-source":
      return "target = 'index-embedding-source'";
    case "index-embedding-summary":
      return "target = 'index-embedding-summary'";
  }
}

async function mergeActiveBuildJob(
  state: Database,
  job: BuildJob,
  options: AddBuildJobOptions,
  now: number,
): Promise<BuildJob> {
  const nextTarget =
    job.target === "reading-graph" && options.target === "reading-summary"
      ? "reading-summary"
      : job.target;
  const nextQueueRank =
    options.boost === true && job.state === "queued"
      ? (await readMinQueueRank(state)) - 1
      : job.queueRank;

  if (nextTarget === job.target && nextQueueRank === job.queueRank) {
    return job;
  }

  await state.run(
    `
UPDATE build_jobs
SET target = ?, queue_rank = ?, updated_at = ?
WHERE job_id = ?
`,
    [nextTarget, nextQueueRank, now, job.jobId],
  );

  const updated = await requireBuildJobById(state, job.jobId);

  if (nextTarget !== job.target) {
    await appendBuildJobEvent(updated, {
      at: now,
      from: job.target,
      jobId: job.jobId,
      seq: 0,
      to: nextTarget,
      type: "target_changed",
    });
  }
  if (nextQueueRank !== job.queueRank) {
    await appendBuildJobEvent(updated, {
      at: now,
      jobId: job.jobId,
      seq: 0,
      state: updated.state,
      type: "boosted",
    });
  }

  return updated;
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

export async function readBuildJobForStopCheck(
  jobId: string,
): Promise<BuildJob> {
  const state = await openReadonlyBuildQueueDatabase();

  try {
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
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    return await state.transaction(async () => {
      const job = await requireBuildJobById(state, jobId);

      if (job.state === "queued") {
        return job;
      }
      if (job.state !== "paused") {
        throw new Error(`Cannot resume ${job.state} job ${jobId}.`);
      }

      const now = Date.now();
      await state.run(
        `
UPDATE build_jobs
SET state = ?, updated_at = ?, finished_at = ?,
    owner_id = NULL,
    owner_pid = NULL
WHERE job_id = ?
`,
        ["queued", now, null, jobId],
      );

      const updated = await requireBuildJobById(state, jobId);
      await appendBuildJobEvent(updated, {
        at: now,
        jobId,
        seq: 0,
        state: "queued",
        type: "resumed",
      });
      return updated;
    });
  } finally {
    await state.close();
  }
}

export async function cancelBuildJob(jobId: string): Promise<BuildJob> {
  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    return await state.transaction(async () => {
      const job = await requireBuildJobById(state, jobId);

      if (job.state === "running") {
        return await markBuildJobCanceling(state, job);
      }
      if (job.state === "queued" || job.state === "paused") {
        return await markBuildJobCanceled(state, job);
      }

      throw new Error(`Cannot cancel ${job.state} job ${jobId}.`);
    });
  } finally {
    await state.close();
  }
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
      const existing = await findActiveBuildJobInLane(state, {
        archiveKey: job.archiveKey,
        chapterId: job.chapterId,
        target,
      });

      if (existing !== undefined && existing.jobId !== job.jobId) {
        throw new Error(
          `Chapter ${job.chapterId} already has active ${formatBuildJobLane(target)} job ${existing.jobId}.`,
        );
      }
      if (job.target === "reading-summary" && target === "reading-graph") {
        if (
          job.readingSummaryStartedAt !== undefined ||
          job.currentStep === "reading-summary"
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

async function updateBuildJobState(
  jobId: string,
  stateName: BuildJobState,
  eventType: Extract<BuildJobEvent["type"], "paused" | "resumed">,
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
        throw new Error(
          `Cannot ${formatBuildJobAction(eventType)} ${job.state} job ${jobId}.`,
        );
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
        state: stateName as "queued" | "paused",
        type: eventType,
      } as BuildJobEvent);
      return updated;
    });
  } finally {
    await state.close();
  }
}

function formatBuildJobAction(
  eventType: Extract<BuildJobEvent["type"], "paused" | "resumed">,
): "pause" | "resume" {
  return eventType === "paused" ? "pause" : "resume";
}

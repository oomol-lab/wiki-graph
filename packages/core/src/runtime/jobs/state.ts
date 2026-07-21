import { rm } from "fs/promises";
import type { Database } from "../../document/index.js";
import { formatErrorEvent } from "./helpers.js";
import { appendBuildJobEvent } from "./events.js";
import { openBuildQueueDatabase, requireBuildJobById } from "./database.js";
import type { BuildJob, BuildJobTarget } from "./types.js";

export async function markBuildJobCanceling(
  state: Database,
  job: BuildJob,
): Promise<BuildJob> {
  const now = Date.now();

  await state.run(
    `
UPDATE build_jobs
SET state = 'canceling', updated_at = ?
WHERE job_id = ? AND state = 'running'
`,
    [now, job.jobId],
  );

  const updated = await requireBuildJobById(state, job.jobId);
  await appendBuildJobEvent(updated, {
    at: now,
    jobId: job.jobId,
    seq: 0,
    state: "canceling",
    type: "canceling",
  });
  return updated;
}

export async function markBuildJobCanceled(
  state: Database,
  job: BuildJob,
): Promise<BuildJob> {
  const now = Date.now();

  await state.run(
    `
UPDATE build_jobs
SET state = 'canceled', owner_id = NULL, owner_pid = NULL,
    current_step = NULL, finished_at = ?, updated_at = ?
WHERE job_id = ?
`,
    [now, now, job.jobId],
  );

  const updated = await requireBuildJobById(state, job.jobId);
  await appendBuildJobEvent(updated, {
    at: now,
    jobId: job.jobId,
    seq: 0,
    state: "canceled",
    type: "canceled",
  });
  return updated;
}

export async function markBuildJobFailedInState(
  state: Database,
  job: BuildJob,
  error: unknown,
): Promise<void> {
  const now = Date.now();
  const formattedError = formatErrorEvent(error);
  const errorJSON = JSON.stringify(formattedError);

  await state.run(
    `
UPDATE build_jobs
SET state = 'failed', owner_id = NULL, owner_pid = NULL,
    current_step = NULL, finished_at = ?, updated_at = ?, error_json = ?
WHERE job_id = ?
`,
    [now, now, errorJSON, job.jobId],
  );
  await appendBuildJobEvent(job, {
    at: now,
    error: formattedError,
    jobId: job.jobId,
    seq: 0,
    state: "failed",
    type: "failed",
  });
}

export async function markBuildJobSucceeded(
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

export async function markBuildJobFailed(
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

      await markBuildJobFailedInState(state, job, error);
    });
  } finally {
    await state.close();
  }
}

export async function markBuildJobStopped(
  jobId: string,
  ownerId: string,
): Promise<void> {
  const state = await openBuildQueueDatabase();

  try {
    await state.transaction(async () => {
      const job = await requireBuildJobById(state, jobId);

      if (job.ownerId !== ownerId || job.state !== "canceling") {
        return;
      }

      await markBuildJobCanceled(state, job);
    });
  } finally {
    await state.close();
  }
}

export async function markBuildJobStep(
  jobId: string,
  step: BuildJobTarget,
): Promise<void> {
  const state = await openBuildQueueDatabase();

  try {
    await state.run(
      `
UPDATE build_jobs
SET current_step = ?,
    reading_summary_started_at = CASE
      WHEN ? = 'reading-summary' AND reading_summary_started_at IS NULL THEN ?
      ELSE reading_summary_started_at
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

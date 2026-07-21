import { randomUUID } from "crypto";
import type { Database } from "../../document/index.js";
import { delay, isProcessAlive } from "./helpers.js";
import {
  BuildJobProgressAccumulator,
  BuildJobStoppedError,
} from "./progress.js";
import { appendBuildJobEvent } from "./events.js";
import { openBuildQueueDatabase, requireBuildJobById } from "./database.js";
import { recoverStaleBuildJobs } from "./recovery.js";
import {
  markBuildJobFailed,
  markBuildJobStopped,
  markBuildJobStep,
  markBuildJobSucceeded,
} from "./state.js";
import { readBuildJobForStopCheck } from "./jobs.js";
import { getNumber, getOptionalString, mapBuildJob } from "./row.js";
import type { BuildJob, BuildJobWorkerOptions } from "./types.js";

const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;

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

  const stop = (_signal: NodeJS.Signals): void => {
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
  const reporter = new BuildJobProgressAccumulator(job, ownerId, {
    appendBuildJobEvent,
    markBuildJobStep,
    readBuildJobForStopCheck,
  });
  const abortController = new AbortController();
  const stopWatcher = setInterval(() => {
    void abortJobWhenStopped(job, ownerId, abortController).catch(
      () => undefined,
    );
  }, 500);

  try {
    await appendBuildJobEvent(job, {
      at: Date.now(),
      jobId: job.jobId,
      seq: 0,
      state: "running",
      type: "started",
    });
    await options.executeJob(job, reporter, {
      signal: abortController.signal,
    });
    await reporter.throwIfStopped();
    await markBuildJobSucceeded(job.jobId, ownerId);
  } catch (error) {
    if (
      error instanceof BuildJobStoppedError ||
      abortController.signal.aborted
    ) {
      await markBuildJobStopped(job.jobId, ownerId);
      return;
    }

    await markBuildJobFailed(job.jobId, ownerId, error);
  } finally {
    clearInterval(stopWatcher);
  }
}

async function abortJobWhenStopped(
  job: BuildJob,
  ownerId: string,
  abortController: AbortController,
): Promise<void> {
  if (abortController.signal.aborted) {
    return;
  }

  const latest = await readBuildJobForStopCheck(job.jobId);

  if (latest.state === "running" && latest.ownerId === ownerId) {
    return;
  }

  abortController.abort(
    new BuildJobStoppedError(
      `Job ${job.jobId} is ${latest.state}. Stop current worker execution.`,
    ),
  );
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

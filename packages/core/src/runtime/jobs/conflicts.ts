import type { File } from "../platform/index.js";
import { createArchiveKey } from "./helpers.js";
import { openBuildQueueDatabase } from "./database.js";
import { recoverStaleBuildJobs } from "./recovery.js";
import { mapBuildJob } from "./row.js";
import type { BuildJobConflictScope, BuildJobTarget } from "./types.js";
import { withStateLock } from "../../state-lock.js";

const ARCHIVE_BUILD_JOB_LOCK_SCOPE = "archive-build-jobs";

export async function withArchiveBuildJobCreationLock<T>(
  archive: File,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await withStateLock(
    {
      mode: "read",
      resourceKey: createArchiveKey(archive),
      scope: ARCHIVE_BUILD_JOB_LOCK_SCOPE,
      stateDatabaseName: "core.sqlite",
    },
    operation,
  );
}

export async function withArchiveBuildJobReplacementLock<T>(
  archive: File,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await withStateLock(
    {
      mode: "write",
      resourceKey: createArchiveKey(archive),
      scope: ARCHIVE_BUILD_JOB_LOCK_SCOPE,
      stateDatabaseName: "core.sqlite",
    },
    operation,
  );
}

export async function assertNoActiveBuildJobs(input: {
  readonly archive: File;
  readonly chapterIds: readonly number[];
  readonly operation: string;
  readonly requiresTarget?: BuildJobTarget;
}): Promise<void> {
  await assertNoActiveBuildJobConflicts({
    archive: input.archive,
    operation: input.operation,
    ...(input.requiresTarget === undefined
      ? {}
      : { requiresTarget: input.requiresTarget }),
    scope: { chapterIds: input.chapterIds, kind: "chapter" },
  });
}

export async function assertNoActiveBuildJobConflicts(input: {
  readonly archive: File;
  readonly operation: string;
  readonly requiresTarget?: BuildJobTarget;
  readonly scope: BuildJobConflictScope;
}): Promise<void> {
  if (input.scope.kind === "chapter" && input.scope.chapterIds.length === 0) {
    return;
  }

  const state = await openBuildQueueDatabase();

  try {
    await recoverStaleBuildJobs(state);
    const archiveKey = createArchiveKey(input.archive);
    const targetFilter =
      input.requiresTarget === undefined ? "" : "AND target = ?";
    const params: Array<number | string> = [archiveKey];
    let scopeFilter = "";

    if (input.scope.kind === "chapter") {
      const placeholders = input.scope.chapterIds.map(() => "?").join(", ");

      scopeFilter = `AND chapter_id IN (${placeholders})`;
      params.push(...input.scope.chapterIds);
    }
    if (input.requiresTarget !== undefined) {
      params.push(input.requiresTarget);
    }

    const job = await state.queryOne(
      `
SELECT *
FROM build_jobs
WHERE archive_key = ?
  ${scopeFilter}
  AND state IN ('queued', 'running', 'canceling', 'paused')
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

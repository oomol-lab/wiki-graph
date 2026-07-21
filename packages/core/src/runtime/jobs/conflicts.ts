import { resolve } from "path";
import { createArchiveKey } from "./helpers.js";
import { openBuildQueueDatabase } from "./database.js";
import { recoverStaleBuildJobs } from "./recovery.js";
import { mapBuildJob } from "./row.js";
import type { BuildJobConflictScope, BuildJobTarget } from "./types.js";

export async function assertNoActiveBuildJobs(input: {
  readonly archivePath: string;
  readonly chapterIds: readonly number[];
  readonly operation: string;
  readonly requiresTarget?: BuildJobTarget;
}): Promise<void> {
  await assertNoActiveBuildJobConflicts({
    archivePath: input.archivePath,
    operation: input.operation,
    ...(input.requiresTarget === undefined
      ? {}
      : { requiresTarget: input.requiresTarget }),
    scope: { chapterIds: input.chapterIds, kind: "chapter" },
  });
}

export async function assertNoActiveBuildJobConflicts(input: {
  readonly archivePath: string;
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
    const archiveKey = createArchiveKey(resolve(input.archivePath));
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

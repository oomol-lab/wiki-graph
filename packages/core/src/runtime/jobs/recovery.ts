import { rm } from "fs/promises";
import type { Database } from "../../document/index.js";
import { isProcessAlive } from "./helpers.js";
import { mapBuildJob } from "./row.js";
import { markBuildJobCanceled, markBuildJobFailedInState } from "./state.js";

export async function recoverStaleBuildJobs(state: Database): Promise<void> {
  const workspacePathsToDelete: string[] = [];

  await state.transaction(async () => {
    const jobs = await state.queryAll(
      `
SELECT *
FROM build_jobs
WHERE state IN ('running', 'canceling')
  AND owner_pid IS NOT NULL
`,
      undefined,
      mapBuildJob,
    );

    for (const job of jobs) {
      if (job.ownerPid !== undefined && isProcessAlive(job.ownerPid)) {
        continue;
      }

      if (job.state === "canceling") {
        await markBuildJobCanceled(state, job);
        continue;
      }

      await markBuildJobFailedInState(state, job, {
        message: "Build worker process disappeared before finishing the job.",
        name: "BuildJobWorkerLost",
      });
      workspacePathsToDelete.push(job.workspacePath);
    }
  });

  for (const workspacePath of workspacePathsToDelete) {
    await rm(workspacePath, { force: true, recursive: true });
  }
}

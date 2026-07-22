import {
  boostBuildJob,
  cancelBuildJob,
  cleanBuildJobs,
  getBuildJob,
  listBuildJobs,
  pauseBuildJob,
  resolveChapterPath,
  resolveBuildJobId,
  resumeBuildJob,
  updateBuildJobTarget,
  WikiGraphArchiveFile,
} from "wiki-graph-core";

import type { CLIQueueArguments } from "../../args/index.js";
import { loadRequiredStageConfig } from "../../runtime/index.js";
import { writeTextToStdout } from "../../support/index.js";
import {
  addArchiveJobs,
  addChapterJob,
  assertBuildCostAccepted,
  assertQueueAddReady,
  readQueueAddChapter,
  tryStartQueueWorker,
} from "./add.js";
import { createQueueAddEstimate } from "./estimate.js";
import { writeJobList, writeJobStatus, writeJobSummary } from "./output.js";
import { watchBuildJob } from "./watch.js";
import { requireKnowledgeGraphWikispineConfig } from "./worker.js";

export { runQueueWorker } from "./worker.js";

export async function runQueueCommand(args: CLIQueueArguments): Promise<void> {
  switch (args.action) {
    case "add": {
      const chapterId = await resolveQueueChapterId(args);
      if (chapterId !== undefined) {
        await assertQueueAddReady(args, chapterId);
      }
      assertBuildCostAccepted(args);
      const config = await loadRequiredStageConfig({
        ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      });
      if (args.target === "knowledge-graph") {
        requireKnowledgeGraphWikispineConfig(config);
      }

      if (chapterId === undefined) {
        await addArchiveJobs(args, config);
      } else {
        const chapter = await readQueueAddChapter(args, chapterId);
        const estimate = createQueueAddEstimate({
          chapters: [chapter],
          config,
          target: args.target ?? "reading-summary",
        });

        await writeJobSummary(await addChapterJob(args, chapterId), {
          estimate,
          json: args.json ?? false,
          watch: true,
        });
      }

      tryStartQueueWorker();
      return;
    }
    case "list":
      await writeJobList(
        await listBuildJobs({
          ...(args.activeOnly === undefined
            ? {}
            : { activeOnly: args.activeOnly }),
          ...(args.all === undefined ? {} : { all: args.all }),
          ...(args.archivePath === undefined
            ? {}
            : { archivePath: args.archivePath }),
        }),
        { json: args.json ?? false },
      );
      return;
    case "status":
      await writeJobStatus(await getBuildJob(await resolveQueueJobId(args)), {
        json: args.json ?? false,
      });
      return;
    case "watch":
      await watchBuildJob(await resolveQueueJobId(args), {
        from: args.from ?? "beginning",
        jsonl: args.jsonl ?? !process.stdout.isTTY,
      });
      return;
    case "pause":
      await writeJobSummary(await pauseBuildJob(await resolveQueueJobId(args)));
      return;
    case "resume":
      await writeJobSummary(
        await resumeBuildJob(await resolveQueueJobId(args)),
      );
      tryStartQueueWorker();
      return;
    case "cancel":
      await writeJobSummary(
        await cancelBuildJob(await resolveQueueJobId(args)),
      );
      return;
    case "boost":
      await writeJobSummary(await boostBuildJob(await resolveQueueJobId(args)));
      tryStartQueueWorker();
      return;
    case "target":
      await writeJobSummary(
        await updateBuildJobTarget(
          await resolveQueueJobId(args),
          args.target ?? "reading-summary",
        ),
      );
      tryStartQueueWorker();
      return;
    case "clean":
      await writeTextToStdout(`Cleaned ${await cleanBuildJobs()} jobs.\n`);
      return;
  }
}

async function resolveQueueJobId(args: CLIQueueArguments): Promise<string> {
  return await resolveBuildJobId(args.jobId!);
}

async function resolveQueueChapterId(
  args: CLIQueueArguments,
): Promise<number | undefined> {
  if (args.chapterId !== undefined) {
    return args.chapterId;
  }
  if (args.chapterPath === undefined) {
    return undefined;
  }

  let chapterId: number | undefined;
  await new WikiGraphArchiveFile(args.archivePath!).readDocument(
    async (document) => {
      chapterId = await resolveChapterPath(document, args.chapterPath!);
    },
  );
  return chapterId;
}

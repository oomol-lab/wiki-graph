import {
  cleanBuildJobs,
  resolveBuildJobId,
  type WikiGraphJobEnqueueOptions,
} from "wiki-graph-sdk";

import type { CLIQueueArguments } from "../../args/index.js";
import { loadCLIConfig } from "../../runtime/config.js";
import { getWikiGraphSDK } from "../../runtime/context.js";
import { writeTextToStdout } from "../../support/index.js";
import { assertBuildCostAccepted, tryStartQueueWorker } from "./add.js";
import { createQueueAddEstimate } from "./estimate.js";
import {
  writeArchiveAddSummary,
  writeJobList,
  writeJobStatus,
  writeJobSummary,
} from "./output.js";
import { watchBuildJob } from "./watch.js";
import { NodeFile } from "../../runtime/node-platform.js";

export { runQueueWorker } from "./worker.js";

export async function runQueueCommand(args: CLIQueueArguments): Promise<void> {
  switch (args.action) {
    case "add": {
      const enqueueOptions = createEnqueueOptions(args);
      const plan = await getWikiGraphSDK().jobs.planEnqueue(enqueueOptions);
      const target = args.target ?? "reading-summary";
      if (target !== "index-fts") {
        assertBuildCostAccepted(args);
      }
      const config = await loadCLIConfig({
        ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      });
      const result = await getWikiGraphSDK().jobs.enqueue(enqueueOptions);
      const singleSelection =
        (args.chapterId !== undefined ||
          args.chapterPath !== undefined ||
          args.chapterIds?.length === 1) &&
        plan.ready.length + plan.skipped.length === 1;
      if (result.created.length === 1 && singleSelection) {
        const created = result.created[0]!;
        const estimate = createQueueAddEstimate({
          chapters: [created.chapter],
          config,
          target,
        });
        await writeJobSummary(created.job.snapshot, {
          chapter: created.chapter,
          estimate,
          json: args.json ?? false,
          watch: true,
        });
      } else {
        await writeArchiveAddSummary({
          archivePath: args.archivePath!,
          created: result.created.map(({ chapter, job }) => ({
            chapter,
            job: job.snapshot,
          })),
          ...(result.created.length === 0
            ? {}
            : {
                estimate: createQueueAddEstimate({
                  chapters: result.created.map((item) => item.chapter),
                  config,
                  target,
                }),
              }),
          json: args.json ?? false,
          skipped: result.skipped,
        });
      }

      tryStartQueueWorker();
      return;
    }
    case "list":
      await writeJobList(
        (
          await getWikiGraphSDK().jobs.list({
            ...(args.activeOnly === undefined
              ? {}
              : { activeOnly: args.activeOnly }),
            ...(args.all === undefined ? {} : { all: args.all }),
            ...(args.archivePath === undefined
              ? {}
              : { archive: new NodeFile(args.archivePath) }),
          })
        ).map((job) => job.snapshot),
        { json: args.json ?? false },
      );
      return;
    case "status":
      await writeJobStatus(await (await getQueueJob(args)).status(), {
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
      await writeJobSummary(await (await getQueueJob(args)).pause());
      return;
    case "resume":
      await writeJobSummary(await (await getQueueJob(args)).resume());
      tryStartQueueWorker();
      return;
    case "cancel":
      await writeJobSummary(await (await getQueueJob(args)).cancel());
      return;
    case "boost":
      await writeJobSummary(await (await getQueueJob(args)).boost());
      tryStartQueueWorker();
      return;
    case "target":
      await writeJobSummary(
        await (
          await getQueueJob(args)
        ).setTarget(args.target ?? "reading-summary"),
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

async function getQueueJob(args: CLIQueueArguments) {
  return await getWikiGraphSDK().jobs.get(await resolveQueueJobId(args));
}

function createEnqueueOptions(
  args: CLIQueueArguments,
): WikiGraphJobEnqueueOptions {
  return {
    archive: args.archivePath!,
    ...(args.boost === undefined ? {} : { boost: args.boost }),
    ...(args.chapterId === undefined ? {} : { chapterId: args.chapterId }),
    ...(args.chapterIds === undefined ? {} : { chapterIds: args.chapterIds }),
    ...(args.chapterPath === undefined
      ? {}
      : { chapterPath: args.chapterPath }),
    ...(args.depth === undefined ? {} : { depth: args.depth }),
    ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
    ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
    target: args.target ?? "reading-summary",
  };
}

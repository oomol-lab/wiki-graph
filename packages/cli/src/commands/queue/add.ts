import type {
  WikiGraphJobSnapshot as BuildJob,
  ChapterEntry,
} from "wiki-graph-sdk";

import type { CLIQueueArguments } from "../../args/index.js";
import type { CLIConfig } from "../../runtime/config.js";
import { isCLIQueueAutostartEnabled } from "../../runtime/context.js";
import { getWikiGraphSDK } from "../../runtime/context.js";
import { spawnInternalChild } from "../../runtime/internal-child.js";
import { createQueueAddEstimate } from "./estimate.js";
import { writeArchiveAddSummary } from "./output.js";
import { parseCLIArchiveTarget } from "../../support/archive-target.js";

export async function addChapterJob(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<BuildJob> {
  const result = await getWikiGraphSDK().jobs.enqueue({
    archive: parseCLIArchiveTarget(args.archivePath!),
    boost: args.boost ?? false,
    chapterId,
    ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
    ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
    target: args.target ?? "reading-summary",
  });
  const created = result.created[0];
  if (created === undefined)
    throw new Error(`Chapter ${chapterId} was not queued.`);
  return created.job.snapshot;
}

export async function addArchiveJobs(
  args: CLIQueueArguments,
  config: CLIConfig,
): Promise<void> {
  const result = await getWikiGraphSDK().jobs.enqueue({
    archive: parseCLIArchiveTarget(args.archivePath!),
    boost: args.boost ?? false,
    ...(args.chapterIds === undefined ? {} : { chapterIds: args.chapterIds }),
    ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
    ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
    target: args.target ?? "reading-summary",
  });
  const created = result.created.map(({ chapter, job }) => ({
    chapter,
    job: job.snapshot,
  }));

  await writeArchiveAddSummary({
    archivePath: args.archivePath!,
    created,
    ...(created.length === 0
      ? {}
      : {
          estimate: createQueueAddEstimate({
            chapters: created.map((item) => item.chapter),
            config,
            target: args.target ?? "reading-summary",
          }),
        }),
    json: args.json ?? false,
    skipped: result.skipped,
  });
}

export async function assertQueueAddReady(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<void> {
  await getWikiGraphSDK().jobs.planEnqueue({
    archive: parseCLIArchiveTarget(args.archivePath!),
    chapterId,
    ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
    target: args.target ?? "reading-summary",
  });
}

export async function readQueueAddChapter(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<ChapterEntry> {
  const archive = await getWikiGraphSDK().archives.open(
    parseCLIArchiveTarget(args.archivePath!),
  );
  const matched = (await archive.listChapters()).find(
    (chapter) => chapter.chapterId === chapterId,
  );
  if (matched === undefined)
    throw new Error(`Chapter ${chapterId} does not exist.`);
  return matched;
}

export function assertBuildCostAccepted(args: CLIQueueArguments): void {
  if (args.acceptCost === true) {
    return;
  }

  throw new Error(
    "Generation tasks can call an LLM, consume tokens, incur provider charges, and run for minutes to hours on large archives. Run `wg <archive-uri> inspect`, then rerun `wg wikg://local/job add` with --accept-cost if the cost and wait time are acceptable.",
  );
}

export function tryStartQueueWorker(): void {
  if (!isCLIQueueAutostartEnabled()) {
    return;
  }

  const child = spawnInternalChild("queue-worker", {
    detached: true,
  });

  child.unref();
}

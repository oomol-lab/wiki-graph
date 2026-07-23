import {
  addBuildJob,
  listChapters,
  type BuildJob,
  type ChapterEntry,
} from "wiki-graph-core";
import { WikiGraphArchiveFile } from "wiki-graph-core";

import type { CLIQueueArguments } from "../../args/index.js";
import type { CLIConfig } from "../../runtime/config.js";
import { spawnInternalChild } from "../../runtime/internal-child.js";
import { createQueueAddEstimate } from "./estimate.js";
import { writeArchiveAddSummary } from "./output.js";

export async function addChapterJob(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<BuildJob> {
  return await addBuildJob({
    archivePath: args.archivePath!,
    boost: args.boost ?? false,
    chapterId,
    ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
    ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
    target: args.target ?? "reading-summary",
  });
}

export async function addArchiveJobs(
  args: CLIQueueArguments,
  config: CLIConfig,
): Promise<void> {
  const created: Array<{
    readonly chapter: ChapterEntry;
    readonly job: BuildJob;
  }> = [];
  const skipped: Array<{
    readonly chapterId: number;
    readonly reason: string;
  }> = [];

  await new WikiGraphArchiveFile(args.archivePath!).readDocument(
    async (document) => {
      const chapterIdSet =
        args.chapterIds === undefined ? undefined : new Set(args.chapterIds);

      for (const chapter of await listChapters(document)) {
        if (
          chapterIdSet !== undefined &&
          !chapterIdSet.has(chapter.chapterId)
        ) {
          continue;
        }
        if (chapter.stage === "planned") {
          skipped.push({
            chapterId: chapter.chapterId,
            reason: "planned",
          });
          continue;
        }

        try {
          created.push({
            chapter,
            job: await addChapterJob(args, chapter.chapterId),
          });
        } catch (error) {
          skipped.push({
            chapterId: chapter.chapterId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );

  await writeArchiveAddSummary({
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
    skipped,
  });
}

export async function assertQueueAddReady(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<void> {
  let chapter: ChapterEntry | undefined;
  await new WikiGraphArchiveFile(args.archivePath!).readDocument(
    async (document) => {
      chapter = (await listChapters(document)).find(
        (entry) => entry.chapterId === chapterId,
      );
    },
  );

  if (chapter === undefined) {
    throw new Error(`Chapter does not exist.`);
  }
  const chapterUri = chapter.uri;

  await new WikiGraphArchiveFile(args.archivePath!).read(async (digest) => {
    if ((await digest.readChapterStage(chapterId)) === "planned") {
      throw new Error(
        `Chapter ${chapterUri} is planned. Set source before queueing a build job.`,
      );
    }
  });
}

export async function readQueueAddChapter(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<ChapterEntry> {
  let matched: ChapterEntry | undefined;

  await new WikiGraphArchiveFile(args.archivePath!).readDocument(
    async (document) => {
      matched = (await listChapters(document)).find(
        (chapter) => chapter.chapterId === chapterId,
      );
    },
  );

  if (matched === undefined) {
    throw new Error(`Chapter ${chapterId} does not exist.`);
  }

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
  if (process.env.WIKIGRAPH_QUEUE_DISABLE_AUTOSTART === "1") {
    return;
  }

  const child = spawnInternalChild("queue-worker", {
    detached: true,
  });

  child.unref();
}

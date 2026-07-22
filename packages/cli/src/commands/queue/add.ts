import { spawn } from "child_process";
import { fileURLToPath } from "url";

import {
  addBuildJob,
  listChapters,
  type BuildJob,
  type ChapterEntry,
} from "wiki-graph-core";
import { WikiGraphArchiveFile } from "wiki-graph-core";

import type { CLIQueueArguments } from "../../args/index.js";
import type { CLIConfig } from "../../runtime/config.js";
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
      for (const chapter of await listChapters(document)) {
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
  chapterId = args.chapterId!,
): Promise<void> {
  await new WikiGraphArchiveFile(args.archivePath!).read(async (digest) => {
    if ((await digest.readChapterStage(chapterId)) === "planned") {
      throw new Error(
        `Chapter ${chapterId} is planned. Set source before queueing a build job.`,
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

  const entryPath = fileURLToPath(
    new URL("../../../queue-worker.js", import.meta.url),
  );

  const child = spawn(process.execPath, [entryPath], {
    detached: true,
    env: {
      ...process.env,
      WIKIGRAPH_INTERNAL_WORKER: "queue-v1",
    },
    stdio: "ignore",
  });

  child.unref();
}

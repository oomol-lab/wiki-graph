import { listChapters, type BuildJob, type ChapterEntry } from "wiki-graph-sdk";
import { WikiGraphArchiveFile } from "wiki-graph-sdk";

import type { CLIQueueArguments } from "../../args/index.js";
import type { CLIConfig } from "../../runtime/config.js";
import { isCLIQueueAutostartEnabled } from "../../runtime/context.js";
import { getWikiGraphSDK } from "../../runtime/context.js";
import { spawnInternalChild } from "../../runtime/internal-child.js";
import { createQueueAddEstimate } from "./estimate.js";
import { writeArchiveAddSummary } from "./output.js";
import { NodeFile } from "../../runtime/node-platform.js";

export async function addChapterJob(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<BuildJob> {
  const job = await getWikiGraphSDK().jobs.create({
    archive: new NodeFile(args.archivePath!),
    boost: args.boost ?? false,
    chapterId,
    ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
    ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
    target: args.target ?? "reading-summary",
  });
  return job.snapshot;
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
    readonly chapter: ChapterEntry;
    readonly reason: string;
  }> = [];

  await new WikiGraphArchiveFile(new NodeFile(args.archivePath!)).readDocument(
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
            chapter,
            reason: "planned",
          });
          continue;
        }
        const target = args.target ?? "reading-summary";
        if (target === "index-embedding-summary") {
          const summary = await document.readSummary(chapter.chapterId);
          if (summary === undefined || summary.trim() === "") {
            skipped.push({
              chapter,
              reason: "missing summary",
            });
            continue;
          }
        }
        if (target === "knowledge-graph" || target === "reading-graph") {
          const artifact = await document.indexArtifacts.get(
            chapter.chapterId,
            "fts",
          );
          const revision = await document.serials.getRevision(
            chapter.chapterId,
          );
          if (artifact?.sourceRevision !== revision) {
            skipped.push({
              chapter,
              reason: "missing current FTS index artifact",
            });
            continue;
          }
        }

        try {
          created.push({
            chapter,
            job: await addChapterJob(args, chapter.chapterId),
          });
        } catch (error) {
          skipped.push({
            chapter,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );

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
    skipped,
  });
}

export async function assertQueueAddReady(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<void> {
  let chapter: ChapterEntry | undefined;
  await new WikiGraphArchiveFile(new NodeFile(args.archivePath!)).readDocument(
    async (document) => {
      chapter = (await listChapters(document)).find(
        (entry) => entry.chapterId === chapterId,
      );
    },
  );

  if (chapter === undefined) {
    throw new Error(`Chapter ${chapterId} does not exist.`);
  }

  await new WikiGraphArchiveFile(new NodeFile(args.archivePath!)).read(
    async (digest) => {
      if ((await digest.readChapterStage(chapterId)) === "planned") {
        throw new Error(
          `Chapter ${chapter!.uri} is planned. Set source before queueing a build job.`,
        );
      }
    },
  );

  const target = args.target ?? "reading-summary";
  if (
    target !== "index-embedding-summary" &&
    target !== "knowledge-graph" &&
    target !== "reading-graph"
  ) {
    return;
  }

  await new WikiGraphArchiveFile(new NodeFile(args.archivePath!)).readDocument(
    async (document) => {
      if (target === "index-embedding-summary") {
        const summary = await document.readSummary(chapterId);
        if (summary === undefined || summary.trim() === "") {
          throw new Error(
            `Chapter ${chapter!.uri} has no summary. Build a reading summary before queueing a summary embedding index artifact job.`,
          );
        }
      }
      if (target === "knowledge-graph" || target === "reading-graph") {
        const artifact = await document.indexArtifacts.get(chapterId, "fts");
        const revision = await document.serials.getRevision(chapterId);
        if (artifact?.sourceRevision !== revision) {
          throw new Error(
            `Chapter ${chapter!.uri} needs a current FTS index artifact before queueing ${target}.`,
          );
        }
      }
    },
  );
}

export async function readQueueAddChapter(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<ChapterEntry> {
  let matched: ChapterEntry | undefined;

  await new WikiGraphArchiveFile(new NodeFile(args.archivePath!)).readDocument(
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
  if (!isCLIQueueAutostartEnabled()) {
    return;
  }

  const child = spawnInternalChild("queue-worker", {
    detached: true,
  });

  child.unref();
}

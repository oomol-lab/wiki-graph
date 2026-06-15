import {
  advanceChapterStages,
  listChapters,
  type AdvanceChapterStagesResult,
  type ChapterEntry,
} from "../facade/index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";

import type { CLISdpubStageArguments } from "./args.js";
import { writeTextToStdout } from "./io.js";
import {
  createStageLLM,
  loadRequiredStageConfig,
  resolveExtractionPrompt,
} from "./stage-runtime.js";

export async function runSdpubStageCommand(
  args: CLISdpubStageArguments,
): Promise<void> {
  switch (args.action) {
    case "pending":
      await new SpineDigestFile(args.path).openEditableSession(
        async (document) => {
          await writePendingChapters(await listChapters(document));
        },
      );
      return;
    case "advance":
      await new SpineDigestFile(args.path).openEditableSession(
        async (document) => {
          const targetStage = args.targetStage ?? "summarized";

          if (targetStage === "planned") {
            await writeAdvanceResult({
              advanced: [],
              pending: [],
              skipped: [],
            });
            return;
          }

          const config = await loadRequiredStageConfig(args);
          const result = await advanceChapterStages(document, {
            ...(args.chapterId === undefined
              ? {}
              : { chapterId: args.chapterId }),
            extractionPrompt: resolveExtractionPrompt(
              args.prompt ?? config.prompt,
            ),
            llm: createStageLLM(config),
            targetStage,
          });

          await writeAdvanceResult(result);
        },
      );
      return;
  }
}

async function writePendingChapters(
  entries: readonly ChapterEntry[],
): Promise<void> {
  const pending = entries.filter((entry) => entry.stage !== "summarized");

  if (pending.length === 0) {
    await writeTextToStdout("No pending chapters.\n");
    return;
  }

  await writeTextToStdout(`${pending.map(formatChapterEntry).join("\n")}\n`);
}

async function writeAdvanceResult(
  result: AdvanceChapterStagesResult,
): Promise<void> {
  const lines = [
    `Advanced: ${result.advanced.length}`,
    `Pending: ${result.pending.length}`,
    `Skipped: ${result.skipped.length}`,
  ];

  if (result.pending.length > 0) {
    lines.push("", "Pending chapters:");
    lines.push(...result.pending.map(formatChapterEntry));
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function formatChapterEntry(entry: ChapterEntry): string {
  return `[${entry.chapterId}] ${entry.stage.padEnd(10)} ${formatTocPath(entry)}`;
}

function formatTocPath(entry: ChapterEntry): string {
  if (entry.tocPath.length === 0) {
    return entry.title ?? "[untitled]";
  }

  return entry.tocPath.join(" / ");
}

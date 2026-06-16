import { createReadStream } from "fs";
import { readFile } from "fs/promises";

import type { DirectoryDocument } from "../document/index.js";
import {
  addChapter,
  generateChapterGraph,
  generateChapterSummary,
  getChapterDetails,
  listChapters,
  removeChapter,
  resetChapter,
  setChapterSource,
  setChapterSummary,
  type ChapterDetails,
  type ChapterEntry,
} from "../facade/index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";

import type { CLIArchiveChapterArguments } from "./args.js";
import { readTextStreamFromStdin, writeTextToStdout } from "./io.js";
import {
  createStageLLM,
  loadRequiredStageConfig,
  resolveExtractionPrompt,
} from "./stage-runtime.js";

export async function runArchiveChapterCommand(
  args: CLIArchiveChapterArguments,
): Promise<void> {
  switch (args.action) {
    case "add":
      await runEditableCommand(args.path, async (document) => {
        const details = await addChapter(document, {
          ...(args.parentChapterId === undefined
            ? {}
            : { parentChapterId: args.parentChapterId }),
          ...(args.title === undefined ? {} : { title: args.title }),
        });

        await writeChapterDetails(details);
      });
      return;
    case "generate-graph":
      await runEditableCommand(args.path, async (document) => {
        const config = await loadRequiredStageConfig(args);
        const details = await generateChapterGraph(document, args.chapterId!, {
          extractionPrompt: resolveExtractionPrompt(
            args.prompt ?? config.prompt,
          ),
          llm: createStageLLM(config),
        });

        await writeChapterDetails(details);
      });
      return;
    case "generate-summary":
      await runEditableCommand(args.path, async (document) => {
        const config = await loadRequiredStageConfig(args);
        const details = await generateChapterSummary(
          document,
          args.chapterId!,
          {
            llm: createStageLLM(config),
          },
        );

        await writeChapterDetails(details);
      });
      return;
    case "list":
      await new SpineDigestFile(args.path).openEditableSession(
        async (document) => {
          await writeChapterList(await listChapters(document));
        },
      );
      return;
    case "remove":
      await runEditableCommand(args.path, async (document) => {
        await removeChapter(document, args.chapterId!, {
          recursive: args.recursive ?? false,
        });
        await writeTextToStdout(`Removed chapter ${args.chapterId!}.\n`);
      });
      return;
    case "reset":
      await runEditableCommand(args.path, async (document) => {
        const details = await resetChapter(
          document,
          args.chapterId!,
          args.resetStage!,
        );

        await writeChapterDetails(details);
      });
      return;
    case "set-source":
      await runEditableCommand(args.path, async (document) => {
        const details = await setChapterSource(
          document,
          args.chapterId!,
          createContentStream(args),
        );

        await writeChapterDetails(details);
      });
      return;
    case "set-summary":
      await runEditableCommand(args.path, async (document) => {
        const details = await setChapterSummary(
          document,
          args.chapterId!,
          await readContentText(args),
        );

        await writeChapterDetails(details);
      });
      return;
    case "status":
      await new SpineDigestFile(args.path).openEditableSession(
        async (document) => {
          await writeChapterDetails(
            await getChapterDetails(document, args.chapterId!),
          );
        },
      );
      return;
  }
}

async function runEditableCommand(
  path: string,
  operation: (document: DirectoryDocument) => Promise<void> | void,
): Promise<void> {
  await new SpineDigestFile(path).openEditableSession(operation);
}

function createContentStream(
  args: Pick<CLIArchiveChapterArguments, "inputPath">,
): AsyncIterable<string> {
  if (args.inputPath !== undefined) {
    return createReadStream(args.inputPath, { encoding: "utf8" });
  }
  if (process.stdin.isTTY) {
    throw new Error(
      "Missing --input. Pipe text into stdin or pass --input <path>.",
    );
  }

  return readTextStreamFromStdin();
}

async function readContentText(
  args: Pick<CLIArchiveChapterArguments, "inputPath">,
): Promise<string> {
  if (args.inputPath !== undefined) {
    return await readFile(args.inputPath, "utf8");
  }
  let content = "";

  for await (const chunk of createContentStream(args)) {
    content += chunk;
  }

  return content;
}

async function writeChapterDetails(details: ChapterDetails): Promise<void> {
  const lines = [
    `Chapter: ${details.chapterId}`,
    `Title: ${details.title ?? "[untitled]"}`,
    `Stage: ${details.stage}`,
    `Source Units: ${details.fragmentCount}`,
    `Children: ${details.childCount}`,
    `Graph: ${details.graphReady ? "yes" : "no"}`,
    `Summary: ${details.hasSummary ? "yes" : "no"}`,
  ];

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

async function writeChapterList(
  entries: readonly ChapterEntry[],
): Promise<void> {
  if (entries.length === 0) {
    await writeTextToStdout("No chapters.\n");
    return;
  }

  await writeTextToStdout(
    `${entries
      .map(
        (entry) =>
          `${"  ".repeat(entry.depth)}[${entry.chapterId}] ${entry.stage.padEnd(10)} ${entry.title ?? "[untitled]"}`,
      )
      .join("\n")}\n`,
  );
}

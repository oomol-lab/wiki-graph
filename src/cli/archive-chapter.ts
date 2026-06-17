import { createReadStream } from "fs";
import { readFile } from "fs/promises";
import { Readable } from "stream";

import type { DirectoryDocument } from "../document/index.js";
import {
  addChapter,
  getChapterDetails,
  listChapters,
  removeChapter,
  resetChapter,
  setChapterSource,
  setChapterSummary,
  setChapterTitle,
  type ChapterDetails,
  type ChapterEntry,
} from "../facade/index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";

import type { CLIArchiveChapterArguments } from "./args.js";
import { readTextStreamFromStdin, writeTextToStdout } from "./io.js";

export async function runArchiveChapterCommand(
  args: CLIArchiveChapterArguments,
): Promise<void> {
  switch (args.action) {
    case "add":
      await runEditableCommand(args.path, async (document) => {
        let details = await addChapter(document, {
          ...(args.parentChapterId === undefined
            ? {}
            : { parentChapterId: args.parentChapterId }),
          ...(args.title === undefined ? {} : { title: args.title }),
        });

        if (args.addStage === "sourced") {
          details = await setChapterSource(
            document,
            details.chapterId,
            Readable.from([await readRequiredSourceText(args)]),
          );
        }

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
          Readable.from([await readRequiredSourceText(args)]),
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
    case "set-title":
      await runEditableCommand(args.path, async (document) => {
        const details = await setChapterTitle(
          document,
          args.chapterId!,
          args.title,
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

async function readRequiredSourceText(
  args: Pick<CLIArchiveChapterArguments, "inputPath">,
): Promise<string> {
  const content = await readContentText(args);

  if (content.trim() === "") {
    throw new Error(
      "Source input is empty. Pass non-empty text with --input <path> or pipe text into stdin.",
    );
  }

  return content;
}

async function writeChapterDetails(details: ChapterDetails): Promise<void> {
  const lines = [
    `Chapter: ${details.chapterId}`,
    `Title: ${details.title ?? "[untitled]"}`,
    `Stage: ${formatStage(details.stage)}`,
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
          `${"  ".repeat(entry.depth)}[${entry.chapterId}] ${formatStage(entry.stage).padEnd(8)} ${entry.title ?? "[untitled]"}`,
      )
      .join("\n")}\n`,
  );
}

function formatStage(stage: ChapterEntry["stage"]): string {
  switch (stage) {
    case "planned":
      return "planned";
    case "sourced":
      return "source";
    case "graphed":
      return "graph";
    case "summarized":
      return "summary";
  }
}

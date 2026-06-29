import { createReadStream } from "fs";
import { readFile } from "fs/promises";
import { Readable } from "stream";

import type { DirectoryDocument } from "../document/index.js";
import {
  addChapter,
  applyChapterTree,
  assertNoActiveBuildJobs,
  getChapterDetails,
  getChapterTree,
  listChapters,
  moveChapter,
  parseChapterTreeInput,
  removeChapter,
  resetChapter,
  setChapterSource,
  setChapterSummary,
  setChapterTitle,
  type ChapterTree,
  type ChapterTreeApplyResult,
  type ChapterDetails,
  type ChapterEntry,
} from "../facade/index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";

import type { CLIArchiveChapterArguments } from "./args.js";
import { readTextStreamFromStdin, writeTextToStdout } from "./io.js";
import { formatCLIJSON } from "./json.js";

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
      await new SpineDigestFile(args.path).readDocument(async (document) => {
        await writeChapterList(await listChapters(document));
      });
      return;
    case "move":
      await runEditableCommand(args.path, async (document) => {
        await assertNoActiveBuildJobs({
          archivePath: args.path,
          chapterIds: collectChapterSubtreeIds(
            await getChapterTree(document),
            args.chapterId!,
          ),
          operation: "Moving chapter",
        });
        const details = await moveChapter(document, args.chapterId!, {
          ...(args.afterChapterId === undefined
            ? {}
            : { afterChapterId: args.afterChapterId }),
          ...(args.beforeChapterId === undefined
            ? {}
            : { beforeChapterId: args.beforeChapterId }),
          ...(args.first === undefined ? {} : { first: args.first }),
          ...(args.last === undefined ? {} : { last: args.last }),
          ...(args.moveToRoot === undefined ? {} : { root: args.moveToRoot }),
          ...(args.parentChapterId === undefined
            ? {}
            : { parentChapterId: args.parentChapterId }),
        });

        await writeChapterDetails(details);
      });
      return;
    case "remove":
      await runEditableCommand(args.path, async (document) => {
        await assertNoActiveBuildJobs({
          archivePath: args.path,
          chapterIds:
            args.recursive === true
              ? collectChapterSubtreeIds(
                  await getChapterTree(document),
                  args.chapterId!,
                )
              : [args.chapterId!],
          operation: "Removing chapter",
        });
        await removeChapter(document, args.chapterId!, {
          recursive: args.recursive ?? false,
        });
        await writeTextToStdout(`Removed chapter ${args.chapterId!}.\n`);
      });
      return;
    case "reset":
      await runEditableCommand(args.path, async (document) => {
        await assertResetAllowed(args.path, args.chapterId!, args.resetStage!);
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
        await assertNoActiveBuildJobs({
          archivePath: args.path,
          chapterIds: [args.chapterId!],
          operation: "Setting chapter source",
        });
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
        await assertNoActiveBuildJobs({
          archivePath: args.path,
          chapterIds: [args.chapterId!],
          operation: "Setting chapter summary",
          requiresTarget: "reading-summary",
        });
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
          args.clearTitle === true ? null : args.title,
        );

        await writeChapterDetails(details);
      });
      return;
    case "status":
      await new SpineDigestFile(args.path).readDocument(async (document) => {
        await writeChapterDetails(
          await getChapterDetails(document, args.chapterId!),
        );
      });
      return;
    case "tree":
      if (args.treeAction === "apply") {
        await runEditableCommand(args.path, async (document) => {
          await writeChapterTreeApplyResult(
            await applyChapterTree(
              document,
              parseChapterTreeInput(JSON.parse(await readContentText(args))),
              { dryRun: args.dryRun ?? false },
            ),
            args.dryRun ?? false,
          );
        });
        return;
      }

      await new SpineDigestFile(args.path).readDocument(async (document) => {
        await writeChapterTree(await getChapterTree(document));
      });
      return;
  }
}

async function runEditableCommand(
  path: string,
  operation: (document: DirectoryDocument) => Promise<void> | void,
): Promise<void> {
  await new SpineDigestFile(path).write(operation);
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

async function writeChapterTree(tree: ChapterTree): Promise<void> {
  await writeTextToStdout(formatCLIJSON(tree));
}

async function writeChapterTreeApplyResult(
  result: ChapterTreeApplyResult,
  dryRun: boolean,
): Promise<void> {
  const lines = [
    dryRun ? "Dry run: chapter tree not changed." : "Applied chapter tree.",
    `Changed: ${result.changed ? "yes" : "no"}`,
    `Moved: ${result.moved.length}`,
    `Renamed: ${result.renamed.length}`,
    `Unchanged: ${result.unchanged}`,
  ];

  for (const move of result.moved) {
    lines.push(
      `Move ${move.chapterId}: ${formatPath(move.oldPath)} [parent ${formatParent(move.oldParentChapterId)}, index ${move.oldIndex}] -> ${formatPath(move.newPath)} [parent ${formatParent(move.newParentChapterId)}, index ${move.newIndex}]`,
    );
  }
  for (const rename of result.renamed) {
    lines.push(
      `Rename ${rename.chapterId}: ${formatTitle(rename.oldTitle)} -> ${formatTitle(rename.newTitle)}`,
    );
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function formatParent(parentChapterId: number | null): string {
  return parentChapterId === null ? "root" : String(parentChapterId);
}

function formatPath(path: readonly string[]): string {
  return path.join(" / ");
}

function formatTitle(title: string | null): string {
  return title === null ? "null" : JSON.stringify(title);
}

function formatStage(stage: ChapterEntry["stage"]): string {
  switch (stage) {
    case "planned":
      return "planned";
    case "sourced":
      return "source";
    case "graphed":
      return "reading-graph";
    case "summarized":
      return "reading-summary";
  }
}

async function assertResetAllowed(
  archivePath: string,
  chapterId: number,
  stage: NonNullable<CLIArchiveChapterArguments["resetStage"]>,
): Promise<void> {
  switch (stage) {
    case "planned":
      await assertNoActiveBuildJobs({
        archivePath,
        chapterIds: [chapterId],
        operation: "Resetting chapter to planned",
      });
      return;
    case "sourced":
      await assertNoActiveBuildJobs({
        archivePath,
        chapterIds: [chapterId],
        operation: "Resetting chapter graph",
        requiresTarget: "reading-graph",
      });
      await assertNoActiveBuildJobs({
        archivePath,
        chapterIds: [chapterId],
        operation: "Resetting chapter summary",
        requiresTarget: "reading-summary",
      });
      return;
    case "graphed":
      await assertNoActiveBuildJobs({
        archivePath,
        chapterIds: [chapterId],
        operation: "Resetting chapter summary",
        requiresTarget: "reading-summary",
      });
      return;
  }
}

function collectChapterSubtreeIds(
  tree: ChapterTree,
  chapterId: number,
): readonly number[] {
  for (const node of tree.chapters) {
    const ids = collectChapterSubtreeIdsFromNode(node, chapterId);

    if (ids.length > 0) {
      return ids;
    }
  }

  return [chapterId];
}

function collectChapterSubtreeIdsFromNode(
  node: ChapterTree["chapters"][number],
  chapterId: number,
): readonly number[] {
  if (node.id === chapterId) {
    return collectAllChapterIds(node);
  }

  for (const child of node.children) {
    const ids = collectChapterSubtreeIdsFromNode(child, chapterId);

    if (ids.length > 0) {
      return ids;
    }
  }

  return [];
}

function collectAllChapterIds(
  node: ChapterTree["chapters"][number],
): readonly number[] {
  return [
    node.id,
    ...node.children.flatMap((child) => collectAllChapterIds(child)),
  ];
}

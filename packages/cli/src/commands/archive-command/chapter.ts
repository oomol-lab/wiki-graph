import { readFile } from "fs/promises";
import { Readable } from "stream";

import type { DirectoryDocument } from "wiki-graph-core";
import {
  addChapter,
  applyChapterTree,
  assertNoActiveBuildJobConflicts,
  assertNoActiveBuildJobs,
  getChapterTree,
  listChapters,
  moveChapter,
  parseChapterTreeInput,
  removeChapter,
  resetChapter,
  resolveChapterPath,
  setChapterSource,
  setChapterSummary,
  setChapterTitle,
  type ChapterTree,
  type ChapterTreeApplyResult,
  type ChapterDetails,
  type ChapterEntry,
} from "wiki-graph-core";
import { WikiGraphArchiveFile } from "wiki-graph-core";

import type { CLIArchiveChapterArguments } from "../../args/index.js";
import {
  readTextStreamFromStdin,
  writeTextToStdout,
} from "../../support/index.js";
import { formatCLIJSON } from "../../support/index.js";

export async function runArchiveChapterCommand(
  args: CLIArchiveChapterArguments,
): Promise<void> {
  switch (args.action) {
    case "add":
      await runEditableCommand(args.path, async (document) => {
        const parentChapterId = await resolveOptionalChapterPath(
          document,
          args.parentChapterPath,
        );
        await assertNoActiveBuildJobConflicts({
          archivePath: args.path,
          operation: "Adding chapter",
          scope: { kind: "archive" },
        });
        let details = await addChapter(document, {
          ...(parentChapterId === undefined ? {} : { parentChapterId }),
          ...(args.title === undefined ? {} : { title: args.title }),
        });

        if (args.inputPath !== undefined) {
          details = await setChapterSource(
            document,
            details.chapterId,
            Readable.from([await readRequiredSourceText(args)]),
          );
        }

        await writeChapterDetails(details, args.json ?? false);
      });
      return;
    case "list":
      await new WikiGraphArchiveFile(args.path).readDocument(
        async (document) => {
          await writeChapterList(
            await listChapters(document),
            args.json ?? false,
          );
        },
      );
      return;
    case "move":
      await runEditableCommand(args.path, async (document) => {
        const chapterId = await resolveRequiredChapterPath(
          document,
          args.chapterPath,
        );
        const afterChapterId = await resolveOptionalChapterPath(
          document,
          args.afterChapterPath,
        );
        const beforeChapterId = await resolveOptionalChapterPath(
          document,
          args.beforeChapterPath,
        );
        const parentChapterId = await resolveOptionalChapterPath(
          document,
          args.parentChapterPath,
        );
        await assertNoActiveBuildJobConflicts({
          archivePath: args.path,
          operation: "Moving chapter",
          scope: { kind: "archive" },
        });
        const details = await moveChapter(document, chapterId, {
          ...(afterChapterId === undefined
            ? {}
            : { afterChapterId: afterChapterId }),
          ...(beforeChapterId === undefined
            ? {}
            : { beforeChapterId: beforeChapterId }),
          ...(args.first === undefined ? {} : { first: args.first }),
          ...(args.last === undefined ? {} : { last: args.last }),
          ...(args.moveToRoot === undefined ? {} : { root: args.moveToRoot }),
          ...(parentChapterId === undefined ? {} : { parentChapterId }),
        });

        await writeChapterDetails(details, args.json ?? false);
      });
      return;
    case "remove":
      await runEditableCommand(args.path, async (document) => {
        const chapterId = await resolveRequiredChapterPath(
          document,
          args.chapterPath,
        );
        await assertNoActiveBuildJobConflicts({
          archivePath: args.path,
          operation: "Removing chapter",
          scope: { kind: "archive" },
        });
        await removeChapter(document, chapterId, {
          recursive: args.recursive ?? false,
        });
        if (args.json === true) {
          await writeTextToStdout(
            formatCLIJSON({
              removed: true,
              uri: `wikg://chapter/${args.chapterPath}`,
            }),
          );
          return;
        }
        await writeTextToStdout(
          `Removed chapter wikg://chapter/${args.chapterPath}.\n`,
        );
      });
      return;
    case "reset":
      await runEditableCommand(args.path, async (document) => {
        const chapterId = await resolveRequiredChapterPath(
          document,
          args.chapterPath,
        );
        await assertResetAllowed(args.path, chapterId, args.resetStage!);
        const details = await resetChapter(
          document,
          chapterId,
          args.resetStage!,
        );

        await writeChapterDetails(details, args.json ?? false);
      });
      return;
    case "set-source":
      await runEditableCommand(args.path, async (document) => {
        const chapterId = await resolveRequiredChapterPath(
          document,
          args.chapterPath,
        );
        await assertNoActiveBuildJobs({
          archivePath: args.path,
          chapterIds: [chapterId],
          operation: "Setting chapter source",
        });
        const details = await setChapterSource(
          document,
          chapterId,
          Readable.from([await readRequiredSourceText(args)]),
        );

        await writeChapterDetails(details, args.json ?? false);
      });
      return;
    case "set-summary":
      await runEditableCommand(args.path, async (document) => {
        const chapterId = await resolveRequiredChapterPath(
          document,
          args.chapterPath,
        );
        await assertNoActiveBuildJobs({
          archivePath: args.path,
          chapterIds: [chapterId],
          operation: "Setting chapter summary",
          requiresTarget: "reading-summary",
        });
        const details = await setChapterSummary(
          document,
          chapterId,
          await readContentText(args),
        );

        await writeChapterDetails(details, args.json ?? false);
      });
      return;
    case "set-title":
      await runEditableCommand(args.path, async (document) => {
        const chapterId = await resolveRequiredChapterPath(
          document,
          args.chapterPath,
        );
        await assertNoActiveBuildJobs({
          archivePath: args.path,
          chapterIds: [chapterId],
          operation: "Setting chapter title",
        });
        const details = await setChapterTitle(
          document,
          chapterId,
          args.clearTitle === true ? null : args.title,
        );

        await writeChapterDetails(details, false);
      });
      return;
    case "tree":
      if (args.treeAction === "apply") {
        await runEditableCommand(args.path, async (document) => {
          if (args.dryRun !== true) {
            await assertNoActiveBuildJobConflicts({
              archivePath: args.path,
              operation: "Changing chapter tree",
              scope: { kind: "archive" },
            });
          }
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

      await new WikiGraphArchiveFile(args.path).readDocument(
        async (document) => {
          await writeChapterTree(
            await getChapterTree(document),
            args.json ?? false,
          );
        },
      );
      return;
  }
}

async function resolveRequiredChapterPath(
  document: DirectoryDocument,
  chapterPath: string | undefined,
): Promise<number> {
  if (chapterPath === undefined) {
    throw new Error("Missing chapter path.");
  }
  return await resolveChapterPath(document, chapterPath);
}

async function resolveOptionalChapterPath(
  document: DirectoryDocument,
  chapterPath: string | undefined,
): Promise<number | undefined> {
  return chapterPath === undefined
    ? undefined
    : await resolveChapterPath(document, chapterPath);
}

async function runEditableCommand(
  path: string,
  operation: (document: DirectoryDocument) => Promise<void> | void,
): Promise<void> {
  await new WikiGraphArchiveFile(path).write(operation);
}

async function readContentText(
  args: Pick<CLIArchiveChapterArguments, "inputPath" | "inputValue">,
): Promise<string> {
  if (args.inputValue !== undefined && args.inputPath !== undefined) {
    throw new Error("Choose either a positional value or --input, not both.");
  }
  if (args.inputValue !== undefined) {
    return args.inputValue;
  }
  if (args.inputPath === "-") {
    let content = "";

    for await (const chunk of readTextStreamFromStdin()) {
      content += chunk;
    }

    return content;
  }
  if (args.inputPath !== undefined) {
    return await readFile(args.inputPath, "utf8");
  }
  throw new Error(
    "Missing input. Pass a positional value, use --input <path>, or use --input - for stdin.",
  );
}

async function readRequiredSourceText(
  args: Pick<CLIArchiveChapterArguments, "inputPath" | "inputValue">,
): Promise<string> {
  const content = await readContentText(args);

  if (content.trim() === "") {
    throw new Error(
      "Source input is empty. Pass non-empty text with --input <path> or --input -.",
    );
  }

  return content;
}

async function writeChapterDetails(
  details: ChapterDetails,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON({
        childCount: details.childCount,
        graphReady: details.graphReady,
        hasSummary: details.hasSummary,
        sourceUnits: details.fragmentCount,
        stage: formatStage(details.stage),
        title: details.title,
        uri: details.uri,
      }),
    );
    return;
  }

  const lines = [
    `Chapter: ${details.uri}`,
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
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON({
        chapters: entries.map((entry) => ({
          uri: entry.uri,
          title: entry.title,
          stage: formatStage(entry.stage),
        })),
      }),
    );
    return;
  }

  if (entries.length === 0) {
    await writeTextToStdout("No chapters.\n");
    return;
  }

  await writeTextToStdout(
    `${entries
      .map(
        (entry) =>
          `${"  ".repeat(entry.depth)}[${formatStage(entry.stage)}] ${entry.title ?? "[untitled]"} (${entry.uri})`,
      )
      .join("\n")}\n`,
  );
}

async function writeChapterTree(
  tree: ChapterTree,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(formatCLIJSON(tree));
    return;
  }

  if (tree.chapters.length === 0) {
    await writeTextToStdout("No chapters.\n");
    return;
  }

  await writeTextToStdout(
    `${formatChapterTreeNodes(tree.chapters).join("\n")}\n`,
  );
}

function formatChapterTreeNodes(
  nodes: readonly ChapterTree["chapters"][number][],
  prefix = "",
): readonly string[] {
  return nodes.flatMap((node, index) => {
    const last = index === nodes.length - 1;
    const branch = last ? "└─ " : "├─ ";
    const childPrefix = `${prefix}${last ? "   " : "│  "}`;

    return [
      `${prefix}${branch}${formatChapterTreeTitle(node.title)} (${formatChapterTreeKey(node.uri)})`,
      ...formatChapterTreeNodes(node.children, childPrefix),
    ];
  });
}

function formatChapterTreeKey(uri: string): string {
  return uri.split("/").at(-1) ?? uri;
}

function formatChapterTreeTitle(title: string | null): string {
  return title ?? "[untitled]";
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
      `Move ${move.oldUri} [index ${move.oldIndex}] -> ${move.newUri} [index ${move.newIndex}]`,
    );
  }
  for (const rename of result.renamed) {
    lines.push(
      `Rename ${rename.uri}: ${formatTitle(rename.oldTitle)} -> ${formatTitle(rename.newTitle)}`,
    );
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
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

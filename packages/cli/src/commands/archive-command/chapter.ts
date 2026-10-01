import { readFile } from "fs/promises";

import {
  formatLocatedChapterUri,
  parseChapterTreeInput,
  parseSourceTextJsonl,
  type BuildJobTarget,
  type ChapterTree,
  type ChapterTreeApplyResult,
  type ChapterDetails,
  type ChapterEntry,
  type IndexArtifactKind,
  type WikiGraphChapterArtifactStatus,
} from "wiki-graph-sdk";
import { getWikiGraphSDK } from "../../runtime/context.js";

import type { CLIArchiveChapterArguments } from "../../args/index.js";
import type { RenderTreeNode } from "../../support/index.js";
import {
  parseLocatedWikiGraphUri,
  renderTreeText,
  readTextStreamFromStdin,
  writeTextToStdout,
} from "../../support/index.js";
import { formatCLIJSON } from "../../support/index.js";
import { tryStartQueueWorker } from "../queue/add.js";
import { writeJobSummary } from "../queue/output.js";

export async function runArchiveChapterCommand(
  args: CLIArchiveChapterArguments,
): Promise<void> {
  const sdk = getWikiGraphSDK();
  const archive = await sdk.archives.open(args.path);
  switch (args.action) {
    case "add": {
      const details = await archive.addChapter({
        ...(args.parentChapterPath === undefined
          ? {}
          : { parentPath: args.parentChapterPath }),
        ...(args.inputPath === undefined
          ? {}
          : { source: await readRequiredSourceText(args) }),
        ...(args.title === undefined ? {} : { title: args.title }),
      });
      await writeChapterDetails(details, args.json ?? false, {
        locatedUri: formatChapterCommandUri(args.path, details.path),
      });
      return;
    }
    case "list":
      await writeChapterList(await archive.listChapters(), args.json ?? false);
      return;
    case "get-index-artifact":
      await writeIndexArtifactStatus(
        await archive.getChapterArtifact(
          requireChapterPath(args.chapterPath),
          requireIndexArtifactKind(args.indexArtifactKind),
        ),
        args.json ?? false,
      );
      return;
    case "build-index-artifact": {
      const chapter = await archive.getChapter(
        requireChapterPath(args.chapterPath),
      );
      const job = await sdk.jobs.create({
        archive: archive.path,
        chapterId: chapter.chapterId,
        target: requireIndexArtifactTarget(args.indexArtifactTarget),
      });

      tryStartQueueWorker();
      await writeJobSummary(job.snapshot, {
        chapter,
        json: args.json ?? false,
        watch: true,
      });
      return;
    }
    case "delete-index-artifact": {
      const deleted = await archive.deleteChapterArtifact(
        requireChapterPath(args.chapterPath),
        requireIndexArtifactKind(args.indexArtifactKind),
      );
      await writeTextToStdout(
        args.json === true
          ? formatCLIJSON(deleted)
          : `Deleted ${formatIndexArtifactKind(deleted.kind)} index artifact for chapter ${deleted.chapterId}.\n`,
      );
      return;
    }
    case "move":
      await writeChapterDetails(
        await archive.moveChapter(requireChapterPath(args.chapterPath), {
          ...(args.afterChapterPath === undefined
            ? {}
            : { afterPath: args.afterChapterPath }),
          ...(args.beforeChapterPath === undefined
            ? {}
            : { beforePath: args.beforeChapterPath }),
          ...(args.first === undefined ? {} : { first: args.first }),
          ...(args.last === undefined ? {} : { last: args.last }),
          ...(args.moveToRoot === undefined ? {} : { root: args.moveToRoot }),
          ...(args.parentChapterPath === undefined
            ? {}
            : { parentPath: args.parentChapterPath }),
        }),
        args.json ?? false,
      );
      return;
    case "remove":
      await archive.removeChapter(
        requireChapterPath(args.chapterPath),
        args.recursive ?? false,
      );
      await writeTextToStdout(
        args.json === true
          ? formatCLIJSON({
              removed: true,
              uri: `wikg://chapter/${args.chapterPath}`,
            })
          : `Removed chapter wikg://chapter/${args.chapterPath}.\n`,
      );
      return;
    case "reset":
      await writeChapterDetails(
        await archive.resetChapter(
          requireChapterPath(args.chapterPath),
          args.resetStage!,
        ),
        args.json ?? false,
      );
      return;
    case "set-source": {
      const sourceText = await readRequiredSourceText(args);
      const parsed =
        args.inputFormat === "jsonl"
          ? parseSourceTextJsonl(sourceText)
          : undefined;
      await writeChapterDetails(
        await archive.setChapterSource(
          requireChapterPath(args.chapterPath),
          parsed?.text ?? sourceText,
          parsed === undefined ? {} : { provenance: parsed.provenance },
        ),
        args.json ?? false,
      );
      return;
    }
    case "set-summary":
      await writeChapterDetails(
        await archive.setChapterSummary(
          requireChapterPath(args.chapterPath),
          await readContentText(args),
        ),
        args.json ?? false,
      );
      return;
    case "set-title":
      await writeChapterDetails(
        await archive.setChapterTitle(
          requireChapterPath(args.chapterPath),
          args.clearTitle === true ? null : args.title,
        ),
        false,
      );
      return;
    case "tree":
      if (args.treeAction === "apply") {
        await writeChapterTreeApplyResult(
          await archive.applyChapterTree(
            parseChapterTreeInput(JSON.parse(await readContentText(args))),
            { dryRun: args.dryRun ?? false },
          ),
          args.dryRun ?? false,
        );
        return;
      }
      await writeChapterTree(
        await archive.getChapterTree(),
        args.json ?? false,
      );
      return;
  }
}
function requireChapterPath(chapterPath: string | undefined): string {
  if (chapterPath === undefined) {
    throw new Error("Missing chapter path.");
  }
  return chapterPath;
}

function requireIndexArtifactKind(
  kind: IndexArtifactKind | undefined,
): IndexArtifactKind {
  if (kind === undefined) {
    throw new Error("Missing index artifact kind.");
  }

  return kind;
}

function requireIndexArtifactTarget(
  target: BuildJobTarget | undefined,
): BuildJobTarget {
  if (target === undefined) {
    throw new Error("Missing index artifact build target.");
  }

  return target;
}

async function writeIndexArtifactStatus(
  status: WikiGraphChapterArtifactStatus,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(formatCLIJSON(status));
    return;
  }

  const state =
    status.artifact === undefined
      ? "missing"
      : status.current
        ? "current"
        : "outdated";

  await writeTextToStdout(
    [
      `Chapter: ${status.chapterId}`,
      `Index artifact: ${formatIndexArtifactKind(status.kind)}`,
      `State: ${state}`,
      ...(status.artifact === undefined
        ? []
        : [
            `Source revision: ${status.artifact.sourceRevision}`,
            `Current revision: ${status.revision}`,
          ]),
    ].join("\n") + "\n",
  );
}

function formatIndexArtifactKind(kind: IndexArtifactKind): string {
  switch (kind) {
    case "fts":
      return "FTS";
    case "embedding-source":
      return "source embedding";
    case "embedding-summary":
      return "summary embedding";
  }
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
      "Source input is empty. Pass non-empty positional text, use --input <path>, or use --input - for stdin.",
    );
  }

  return content;
}

async function writeChapterDetails(
  details: ChapterDetails,
  json: boolean,
  options: { readonly locatedUri?: string } = {},
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON({
        childCount: details.childCount,
        graphReady: details.graphReady,
        hasSummary: details.hasSummary,
        ...(options.locatedUri === undefined
          ? {}
          : { locatedUri: options.locatedUri }),
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
    ...(options.locatedUri === undefined
      ? []
      : [`Located URI: ${options.locatedUri}`]),
    `Title: ${details.title ?? "[untitled]"}`,
    `Stage: ${formatStage(details.stage)}`,
    `Source Units: ${details.fragmentCount}`,
    `Children: ${details.childCount}`,
    `Graph: ${details.graphReady ? "yes" : "no"}`,
    `Summary: ${details.hasSummary ? "yes" : "no"}`,
  ];

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function formatChapterCommandUri(
  archiveLocator: string,
  chapterPath: string,
): string {
  if (archiveLocator.startsWith("wikg://lib/")) {
    return `${archiveLocator.replace(/\/+$/u, "")}/chapter/${chapterPath}`;
  }
  if (archiveLocator.startsWith("wikg://")) {
    const parsed = parseLocatedWikiGraphUri(archiveLocator);

    if (parsed.archivePath !== undefined) {
      return formatLocatedChapterUri(parsed.archivePath, chapterPath);
    }
  }

  return formatLocatedChapterUri(archiveLocator, chapterPath);
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
    renderTreeText(tree.chapters.map(formatChapterTreeRenderNode)),
  );
}

function formatChapterTreeRenderNode(
  node: ChapterTree["chapters"][number],
): RenderTreeNode {
  return {
    children: node.children.map(formatChapterTreeRenderNode),
    label: `${formatChapterTreeTitle(node.title)} (${formatChapterTreeKey(node.uri)})`,
  };
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

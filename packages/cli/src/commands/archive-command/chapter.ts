import { readFile } from "fs/promises";
import { Readable } from "stream";

import type { DirectoryDocument, ReadonlyDocument } from "wiki-graph-sdk";
import {
  addChapter,
  applyChapterTree,
  assertNoActiveBuildJobConflicts,
  assertNoActiveBuildJobs,
  formatLocatedChapterUri,
  getChapterTree,
  listChapters,
  moveChapter,
  parseChapterTreeInput,
  removeChapter,
  resetChapter,
  resolveChapterPathReadonly,
  setChapterSource,
  setChapterSummary,
  setChapterTitle,
  parseSourceTextJsonl,
  WikiGraphArchiveFile,
  type BuildJobTarget,
  type ChapterTree,
  type ChapterTreeApplyResult,
  type ChapterDetails,
  type ChapterEntry,
  type IndexArtifactKind,
} from "wiki-graph-sdk";
import { NodeFile } from "../../runtime/node-platform.js";
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
import { readArchiveDocument, writeArchiveDocument } from "./run/document.js";
import { resolveArchiveRuntimeLocation } from "./run/uri.js";

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
          archive: new NodeFile(args.path),
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

        await writeChapterDetails(details, args.json ?? false, {
          locatedUri: formatChapterCommandUri(args.path, details.path),
        });
      });
      return;
    case "list":
      await readArchiveDocument(args.path, async (document) => {
        await writeChapterList(
          await listChapters(document),
          args.json ?? false,
        );
      });
      return;
    case "get-index-artifact":
      await readArchiveDocument(args.path, async (document) => {
        const chapterId = await resolveRequiredChapterPath(
          document,
          args.chapterPath,
        );
        await writeIndexArtifactStatus(
          document,
          chapterId,
          requireIndexArtifactKind(args.indexArtifactKind),
          args.json ?? false,
        );
      });
      return;
    case "build-index-artifact": {
      const chapter = await readArchiveDocument(args.path, async (document) => {
        const chapterId = await resolveRequiredChapterPath(
          document,
          args.chapterPath,
        );
        const matched = (await listChapters(document)).find(
          (entry) => entry.chapterId === chapterId,
        );

        if (matched === undefined) {
          throw new Error(`Chapter internal id ${chapterId} does not exist.`);
        }
        return matched;
      });
      const job = await getWikiGraphSDK().jobs.create({
        archive: new NodeFile(args.path),
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
    case "delete-index-artifact":
      await writeArchiveDocument(args.path, async (document) => {
        const chapterId = await resolveRequiredChapterPath(
          document,
          args.chapterPath,
        );
        const kind = requireIndexArtifactKind(args.indexArtifactKind);

        await document.indexArtifacts.delete(chapterId, kind);
        if (args.json === true) {
          await writeTextToStdout(
            formatCLIJSON({
              chapterId,
              deleted: true,
              kind,
            }),
          );
          return;
        }
        await writeTextToStdout(
          `Deleted ${formatIndexArtifactKind(kind)} index artifact for chapter ${chapterId}.\n`,
        );
      });
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
          archive: new NodeFile(args.path),
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
          archive: new NodeFile(args.path),
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
          archive: new NodeFile(args.path),
          chapterIds: [chapterId],
          operation: "Setting chapter source",
        });
        const sourceText = await readRequiredSourceText(args);
        const parsed =
          args.inputFormat === "jsonl"
            ? parseSourceTextJsonl(sourceText)
            : undefined;
        const details = await setChapterSource(
          document,
          chapterId,
          Readable.from([parsed?.text ?? sourceText]),
          parsed === undefined ? {} : { provenance: parsed.provenance },
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
          archive: new NodeFile(args.path),
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
          archive: new NodeFile(args.path),
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
        await runEditableCommand(
          args.path,
          async (document) => {
            if (args.dryRun !== true) {
              await assertNoActiveBuildJobConflicts({
                archive: new NodeFile(args.path),
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
          },
          { markLibraryDirty: args.dryRun !== true },
        );
        return;
      }

      await readArchiveDocument(args.path, async (document) => {
        await writeChapterTree(
          await getChapterTree(document),
          args.json ?? false,
        );
      });
      return;
  }
}

async function resolveRequiredChapterPath(
  document: ReadonlyDocument,
  chapterPath: string | undefined,
): Promise<number> {
  if (chapterPath === undefined) {
    throw new Error("Missing chapter path.");
  }
  return await resolveChapterPathReadonly(document, chapterPath);
}

async function resolveOptionalChapterPath(
  document: ReadonlyDocument,
  chapterPath: string | undefined,
): Promise<number | undefined> {
  return chapterPath === undefined
    ? undefined
    : await resolveChapterPathReadonly(document, chapterPath);
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
  document: ReadonlyDocument,
  chapterId: number,
  kind: IndexArtifactKind,
  json: boolean,
): Promise<void> {
  const [artifact, revision] = await Promise.all([
    document.indexArtifacts.get(chapterId, kind),
    document.serials.getRevision(chapterId),
  ]);
  const status = {
    chapterId,
    current: artifact?.sourceRevision === revision,
    kind,
    missing: artifact === undefined,
    revision,
    ...(artifact === undefined
      ? {}
      : {
          artifact: {
            createdAt: artifact.createdAt,
            metadata: artifact.metadata,
            sourceRevision: artifact.sourceRevision,
          },
        }),
  };

  if (json) {
    await writeTextToStdout(formatCLIJSON(status));
    return;
  }

  const state =
    artifact === undefined
      ? "missing"
      : artifact.sourceRevision === revision
        ? "current"
        : "outdated";

  await writeTextToStdout(
    [
      `Chapter: ${chapterId}`,
      `Index artifact: ${formatIndexArtifactKind(kind)}`,
      `State: ${state}`,
      ...(artifact === undefined
        ? []
        : [
            `Source revision: ${artifact.sourceRevision}`,
            `Current revision: ${revision}`,
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

async function runEditableCommand(
  path: string,
  operation: (document: DirectoryDocument) => Promise<void> | void,
  options: { readonly markLibraryDirty?: boolean } = {},
): Promise<void> {
  if (options.markLibraryDirty === false) {
    const location = await resolveArchiveRuntimeLocation(path);
    await new WikiGraphArchiveFile(location.archiveFile).write(operation);
    return;
  }

  await writeArchiveDocument(path, operation);
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

async function assertResetAllowed(
  archivePath: string,
  chapterId: number,
  stage: NonNullable<CLIArchiveChapterArguments["resetStage"]>,
): Promise<void> {
  switch (stage) {
    case "planned":
      await assertNoActiveBuildJobs({
        archive: new NodeFile(archivePath),
        chapterIds: [chapterId],
        operation: "Resetting chapter to planned",
      });
      return;
    case "sourced":
      await assertNoActiveBuildJobs({
        archive: new NodeFile(archivePath),
        chapterIds: [chapterId],
        operation: "Resetting chapter graph",
        requiresTarget: "reading-graph",
      });
      await assertNoActiveBuildJobs({
        archive: new NodeFile(archivePath),
        chapterIds: [chapterId],
        operation: "Resetting chapter summary",
        requiresTarget: "reading-summary",
      });
      return;
    case "graphed":
      await assertNoActiveBuildJobs({
        archive: new NodeFile(archivePath),
        chapterIds: [chapterId],
        operation: "Resetting chapter summary",
        requiresTarget: "reading-summary",
      });
      return;
  }
}

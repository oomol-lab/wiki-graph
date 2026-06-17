import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  advanceChapterStages,
  type AdvanceChapterStagesProgressEvent,
  type AdvanceChapterStagesResult,
  findGraphPath,
  getArchiveIndex,
  listArchiveCollection,
  listArchiveLinks,
  listArchiveObjects,
  listRelatedArchiveObjects,
  packArchiveContext,
  readArchivePage,
  readArchiveText,
  estimateArchiveBuild,
  type ArchiveCollectionOptions,
  type ArchiveCollectionResult,
  findArchiveObjects,
  formatNodeId,
  type ArchiveEstimate,
  type ArchiveFindOptions,
  type ArchiveFindResult,
  type ArchiveIndex,
  type ArchiveListItem,
  type ArchivePack,
  type ArchivePage,
  grepArchiveObjects,
  type GraphNeighbor,
  type GraphPathStep,
  type ChapterEntry,
  type ChapterStage,
} from "../facade/index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";
import type { Document } from "../document/index.js";

import type { CLIArchiveArguments } from "./args.js";
import { runConvertCommand } from "./convert.js";
import {
  readTextStreamFromStdin,
  writeTextToStderr,
  writeTextToStdout,
} from "./io.js";
import {
  createStageLLM,
  loadRequiredStageConfig,
  resolveExtractionPrompt,
} from "./stage-runtime.js";

export async function runArchiveCommand(
  args: CLIArchiveArguments,
): Promise<void> {
  switch (args.action) {
    case "create":
      await createArchive(args);
      return;
    case "build": {
      await buildArchive(args);
      return;
    }
    case "export":
      if (args.outputFormat === undefined) {
        throw new Error("Internal error: missing export output format.");
      }
      await runConvertCommand({
        help: false,
        inputFormat: "sdpub",
        inputPath: args.archivePath,
        ...(args.outputPath === undefined
          ? {}
          : { outputPath: args.outputPath }),
        outputFormat: args.outputFormat,
        verbose: false,
      });
      return;
    case "estimate":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeEstimate(
          await estimateArchiveBuild(
            document,
            args.targetStage ?? "summarized",
          ),
          args.json ?? false,
        );
      });
      return;
    case "status":
    case "index": {
      const indexAction = args.action;

      await withArchiveDocument(args.archivePath, async (document) => {
        await writeIndex(
          await getArchiveIndex(document),
          indexAction,
          args.json ?? false,
        );
      });
      return;
    }
    case "list":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeCollection(
          await listArchiveCollection(document, createCollectionOptions(args)),
          args.json ?? false,
        );
      });
      return;
    case "find":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeFindHits(
          await findArchiveObjects(
            document,
            args.query!,
            createFindOptions(args),
          ),
          args.json ?? false,
        );
      });
      return;
    case "grep":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeFindHits(
          await grepArchiveObjects(
            document,
            args.query!,
            createFindOptions(args),
          ),
          args.json ?? false,
        );
      });
      return;
    case "page":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writePage(
          await readArchivePage(document, args.objectId!),
          args.json ?? false,
        );
      });
      return;
    case "read":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeTextToStdout(
          `${await readArchiveText(document, args.objectId!)}\n`,
        );
      });
      return;
    case "links":
    case "backlinks": {
      const linkDirection = args.action;

      await withArchiveDocument(args.archivePath, async (document) => {
        await writeLinks(
          await listArchiveLinks(document, args.objectId!, linkDirection),
          linkDirection,
          args.json ?? false,
        );
      });
      return;
    }
    case "related":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeList(
          await listRelatedArchiveObjects(document, args.objectId!),
          args.json ?? false,
        );
      });
      return;
    case "pack":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writePack(
          await packArchiveContext(
            document,
            args.objectId!,
            args.budget ?? 5000,
          ),
          args.json ?? false,
        );
      });
      return;
    case "map":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeMap(
          await listArchiveObjects(document, "edges"),
          args.json ?? false,
        );
      });
      return;
    case "path":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeTextToStdout(
          formatPath(
            await findGraphPath(
              document,
              args.chapterId!,
              args.fromNodeId!,
              args.toNodeId!,
            ),
          ),
        );
      });
      return;
  }
}

async function createArchive(args: CLIArchiveArguments): Promise<void> {
  if (args.sourcePath === undefined) {
    await createArchiveFromStdin(args);
    return;
  }

  if (!isUrl(args.sourcePath)) {
    await runConvertCommand({
      help: false,
      inputPath: args.sourcePath,
      outputPath: args.archivePath,
      ...(args.inputFormat === undefined
        ? {}
        : { inputFormat: args.inputFormat }),
      ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      outputFormat: "sdpub",
      ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
      targetStage: "sourced",
      verbose: false,
    });
    return;
  }

  const temporaryDirectoryPath = await mkdtemp(
    join(tmpdir(), "spinedigest-url-create-"),
  );
  const sourcePath = join(temporaryDirectoryPath, "source.md");

  try {
    const response = await fetch(args.sourcePath);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${args.sourcePath}: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    await writeFile(sourcePath, formatFetchedUrlSource(args.sourcePath, text));
    await runConvertCommand({
      help: false,
      inputFormat: args.inputFormat ?? "markdown",
      inputPath: sourcePath,
      ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      outputFormat: "sdpub",
      outputPath: args.archivePath,
      ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
      targetStage: "sourced",
      verbose: false,
    });
  } finally {
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
}

async function createArchiveFromStdin(
  args: CLIArchiveArguments,
): Promise<void> {
  if (args.inputFormat === undefined) {
    throw new Error("Internal error: missing stdin create format.");
  }
  if (process.stdin.isTTY) {
    throw new Error(
      "Missing source input. Pipe text into stdin or pass a source path.",
    );
  }

  const temporaryDirectoryPath = await mkdtemp(
    join(tmpdir(), "spinedigest-stdin-create-"),
  );
  const extension = args.inputFormat === "markdown" ? ".md" : ".txt";
  const sourcePath = join(temporaryDirectoryPath, `source${extension}`);

  try {
    await writeFile(sourcePath, await readAllText(readTextStreamFromStdin()));
    await runConvertCommand({
      help: false,
      inputFormat: args.inputFormat,
      inputPath: sourcePath,
      ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      outputFormat: "sdpub",
      outputPath: args.archivePath,
      ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
      targetStage: "sourced",
      verbose: false,
    });
  } finally {
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
}

function createFindOptions(args: CLIArchiveArguments): ArchiveFindOptions {
  return {
    ...(args.chapters === undefined ? {} : { chapters: args.chapters }),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    ...(args.ids === undefined ? {} : { ids: args.ids }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.match === undefined ? {} : { match: args.match }),
    ...(args.searchOrder === undefined ? {} : { order: args.searchOrder }),
    ...(args.searchTypes === undefined
      ? {}
      : { types: args.searchTypes.filter(isSearchFilterType) }),
  };
}

function createCollectionOptions(
  args: CLIArchiveArguments,
): ArchiveCollectionOptions {
  return {
    ...(args.chapters === undefined ? {} : { chapters: args.chapters }),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    ...(args.ids === undefined ? {} : { ids: args.ids }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.searchOrder === undefined ? {} : { order: args.searchOrder }),
    ...(args.searchTypes === undefined ? {} : { types: args.searchTypes }),
  };
}

async function buildArchive(args: CLIArchiveArguments): Promise<void> {
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

  await withArchiveDocument(args.archivePath, async (document) => {
    const progressWriter = createStageAdvanceProgressWriter();
    let result: AdvanceChapterStagesResult;

    try {
      result = await advanceChapterStages(document, {
        ...(args.chapterId === undefined ? {} : { chapterId: args.chapterId }),
        extractionPrompt: resolveExtractionPrompt(args.prompt ?? config.prompt),
        llm: createStageLLM(config, {
          onStreamProgress: progressWriter.onStreamProgress,
        }),
        onProgress: progressWriter.onProgress,
        targetStage,
      });
    } finally {
      await progressWriter.stop();
    }

    await writeAdvanceResult(result);
  });
}

async function withArchiveDocument<T>(
  path: string,
  operation: (document: Document) => Promise<T> | T,
): Promise<void> {
  await new SpineDigestFile(path).openEditableSession(operation);
}

function createStageAdvanceProgressWriter(input?: {
  readonly refreshIntervalMs?: number;
}): {
  readonly onProgress: (
    event: AdvanceChapterStagesProgressEvent,
  ) => Promise<void>;
  readonly onStreamProgress: (event: {
    readonly outputCharacters: number;
  }) => Promise<void>;
  stop(): Promise<void>;
} {
  const refreshIntervalMs = input?.refreshIntervalMs ?? 5_000;
  const outputCharactersPerToken = 4;
  let graphWords = 0;
  let summaryWords = 0;
  let totalGraphWords = 0;
  let totalSummaryWords = 0;
  let outputCharacters = 0;
  let lastRenderAt = 0;
  let lastRenderedLine: string | undefined;
  let renderedStatusLine = false;
  let writeQueue = Promise.resolve();

  const writeLine = async (line: string): Promise<void> => {
    writeQueue = writeQueue
      .catch(() => undefined)
      .then(async () => {
        await writeTextToStderr(`${line}\n`);
      });
    await writeQueue;
  };

  const writeStatus = async (force = false): Promise<void> => {
    const now = Date.now();
    const line = formatBuildProgressLine({
      graphWords,
      outputTokens: estimateOutputTokens(
        outputCharacters,
        outputCharactersPerToken,
      ),
      summaryWords,
      totalGraphWords,
      totalSummaryWords,
    });

    if (
      !force &&
      (line === lastRenderedLine || now - lastRenderAt < refreshIntervalMs)
    ) {
      return;
    }

    lastRenderAt = now;
    lastRenderedLine = line;
    writeQueue = writeQueue
      .catch(() => undefined)
      .then(async () => {
        await writeTextToStderr(`\r${line}`);
      });
    renderedStatusLine = true;
    await writeQueue;
  };

  const finishStatusLine = async (): Promise<void> => {
    if (!renderedStatusLine) {
      return;
    }

    writeQueue = writeQueue
      .catch(() => undefined)
      .then(async () => {
        await writeTextToStderr("\n");
      });
    renderedStatusLine = false;
    await writeQueue;
  };

  const applyProgressState = (
    event: AdvanceChapterStagesProgressEvent,
  ): void => {
    if (!("state" in event)) {
      return;
    }

    graphWords = event.state.graphWords;
    summaryWords = event.state.summaryWords;
    totalGraphWords = event.state.totalGraphWords;
    totalSummaryWords = event.state.totalSummaryWords;
  };

  return {
    async onProgress(event) {
      applyProgressState(event);

      switch (event.type) {
        case "selected":
          await finishStatusLine();
          await writeLine(
            `Selected ${event.totalChapters} ${event.totalChapters === 1 ? "chapter" : "chapters"}; target: ${formatStage(event.targetStage)}.`,
          );
          await writeStatus(true);
          return;
        case "skipped":
          await finishStatusLine();
          await writeLine(
            `Skipping ${formatProgressChapter(event.chapter)}: source is missing.`,
          );
          return;
        case "started": {
          const label = `${formatProgressVerb(event.step)} for ${formatProgressChapter(event.chapter)}`;
          await finishStatusLine();
          await writeLine(`${label}...`);
          await writeStatus(true);
          return;
        }
        case "progress":
          await writeStatus();
          return;
        case "completed":
          await writeStatus(true);
          await finishStatusLine();
          await writeLine(
            `Finished ${formatProgressStep(event.step)} for ${formatProgressChapter(event.chapter)}.`,
          );
          return;
      }
    },
    async onStreamProgress(event) {
      outputCharacters += event.outputCharacters;
      await writeStatus();
    },
    async stop() {
      await finishStatusLine();
      await writeQueue.catch(() => undefined);
    },
  };
}

async function writeIndex(
  index: ArchiveIndex,
  action: "index" | "status",
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify(index, null, 2)}\n`);
    return;
  }

  const lines = [
    `Archive Type: LLM Wiki`,
    `Title: ${index.meta?.title ?? "[untitled]"}`,
    `Source Format: ${index.meta?.sourceFormat ?? "[unknown]"}`,
    `Chapters: ${index.chapters.length}`,
    `Summaries: ${index.summaryCount}`,
    `Nodes: ${index.nodeCount}`,
    `Edges: ${index.edgeCount}`,
  ];

  if (index.nodeCount === 0) {
    lines.push(
      "",
      "Graph note:",
      "  No graph nodes are currently available. If graph build already ran, the source may be too short, too sparse, or no stable knowledge units were extracted.",
      "  Next: inspect a chapter with `spinedigest page <archive.sdpub> chapter:<id>` or build `--stage summary` if you need summaries.",
    );
  } else if (index.edgeCount === 0) {
    lines.push(
      "",
      "Graph note:",
      "  Graph nodes exist, but no edges are currently available. This can be valid when extracted nodes have no stable relationships.",
      "  Next: inspect nodes with `spinedigest list <archive.sdpub> --type node`.",
    );
  }

  if (action === "index") {
    lines.push("", "Entry Points:");
    for (const chapter of index.chapters.slice(0, 12)) {
      lines.push(
        `  chapter:${chapter.chapterId}  ${chapter.title ?? "[untitled]"} (${formatStage(chapter.stage)})`,
      );
    }
    lines.push(
      "",
      "Next:",
      "  spinedigest find <archive.sdpub> <term>",
      "  spinedigest page <archive.sdpub> chapter:<id>",
      "  spinedigest list <archive.sdpub> --type node",
    );
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

async function writeEstimate(
  estimate: ArchiveEstimate,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify(estimate, null, 2)}\n`);
    return;
  }

  await writeTextToStdout(
    [
      `Target stage: ${formatEstimateStage(estimate.targetStage)}`,
      `Source words: ${estimate.sourceWords}`,
      `Estimated LLM calls: ${estimate.estimatedLlmCalls}`,
      `Estimated tokens: ${estimate.estimatedTokens.input} input / ${estimate.estimatedTokens.output} output`,
      `Estimated time: ${formatDuration(estimate.estimatedTime.minSeconds)}-${formatDuration(estimate.estimatedTime.maxSeconds)}`,
      `Estimated cost: $${estimate.estimatedCostUsd.min}-$${estimate.estimatedCostUsd.max}`,
      `Risk: ${estimate.risk}`,
      "",
      `Recommendation: ${estimate.recommendation}`,
    ].join("\n") + "\n",
  );
}

async function writeList(
  items: readonly ArchiveListItem[],
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify({ items }, null, 2)}\n`);
    return;
  }

  if (items.length === 0) {
    await writeTextToStdout("No objects.\n");
    return;
  }

  await writeTextToStdout(
    `${items
      .map((item) => `${item.id}  ${item.label}  ${item.summary}`)
      .join("\n")}\n`,
  );
}

async function writeCollection(
  result: ArchiveCollectionResult,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.items.length === 0) {
    await writeTextToStdout("No objects.\n");
    return;
  }

  await writeTextToStdout(
    `${result.items
      .map(
        (item) =>
          `${item.id}  ${item.type}/${item.field}  ${item.title}\n${item.snippet}\nNext: spinedigest page <archive.sdpub> ${item.id}`,
      )
      .join("\n\n")}${formatCollectionCursor(result)}\n`,
  );
}

async function writeFindHits(
  result: ArchiveFindResult,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.items.length === 0) {
    await writeTextToStdout(formatNoMatches(result));
    return;
  }

  await writeTextToStdout(
    `${result.items
      .map(
        (hit) =>
          `${hit.id}  ${hit.type}/${hit.field}  ${hit.title}\n${formatFindMatchLine(hit)}${hit.snippet}\nNext: spinedigest page <archive.sdpub> ${hit.id}`,
      )
      .join("\n\n")}${formatNextCursor(result)}${formatFindLensHint(result)}\n`,
  );
}

async function writePage(page: ArchivePage, json: boolean): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify(page, null, 2)}\n`);
    return;
  }

  switch (page.type) {
    case "chapter":
      await writeTextToStdout(
        [
          `${page.id}  ${page.title}`,
          `Stage: ${formatStage(page.chapter.stage)}`,
          `Fragments: ${page.chapter.fragmentCount}`,
          `Nodes: ${page.nodeCount}`,
          "",
          "Node Groups:",
          ...formatNodeGroups(page.nodeGroups),
          "",
          "Summary:",
          `${page.summary ?? "[summary missing]"}${page.summaryTruncated ? "\n[summary truncated]" : ""}`,
          "",
          formatChapterNextSteps(page),
        ].join("\n") + "\n",
      );
      return;
    case "meta":
      await writeTextToStdout(
        page.meta === undefined
          ? "No metadata.\n"
          : `${JSON.stringify(page.meta, null, 2)}\n`,
      );
      return;
    case "fragment":
      await writeTextToStdout(
        [
          `${page.id}`,
          `Words: ${page.fragment.wordsCount}`,
          `Previous: ${page.previousFragmentId ?? "[none]"}`,
          `Next: ${page.nextFragmentId ?? "[none]"}`,
          "",
          page.fragment.text,
          "",
          "Related Nodes:",
          ...formatNodeLabels(page.nodes),
        ].join("\n") + "\n",
      );
      return;
    case "node":
      await writeTextToStdout(
        [
          `${page.id}  ${page.title}`,
          `Chapter: ${page.position === undefined ? "[unknown]" : `chapter:${page.position.chapter}`}`,
          `Position: ${formatPosition(page.position)}`,
          "",
          "Generated Node Summary:",
          page.generatedNodeSummary,
          "",
          "Source Fragments:",
          ...formatSourceFragmentLines(page.sourceFragments),
          "",
          "Outgoing Nodes:",
          ...formatNeighborLines(page.outgoing),
          "",
          "Incoming Nodes:",
          ...formatNeighborLines(page.incoming),
        ].join("\n") + "\n",
      );
      return;
    case "summary":
      await writeTextToStdout(`${page.id}  ${page.title}\n\n${page.content}\n`);
      return;
  }
}

async function writeLinks(
  links: readonly GraphNeighbor[],
  direction: "backlinks" | "links",
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify({ links }, null, 2)}\n`);
    return;
  }

  if (links.length === 0) {
    const next =
      direction === "links"
        ? "No outgoing links. Try: spinedigest backlinks <archive.sdpub> <node:id>\n"
        : "No incoming links.\n";
    await writeTextToStdout(next);
    return;
  }

  await writeTextToStdout(`${formatNeighborLines(links).join("\n")}\n`);
}

async function writeMap(
  edges: readonly ArchiveListItem[],
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify({ edges }, null, 2)}\n`);
    return;
  }

  if (edges.length === 0) {
    await writeTextToStdout(
      [
        "No graph edges.",
        "This can be valid after a graph build when the source is too short, too sparse, or the model found no stable relationships.",
        "Next:",
        "  spinedigest status <archive.sdpub>",
        "  spinedigest list <archive.sdpub> --type node",
        "  spinedigest page <archive.sdpub> chapter:<id>",
      ].join("\n") + "\n",
    );
    return;
  }

  await writeTextToStdout(`${edges.map((edge) => edge.label).join("\n")}\n`);
}

async function writePack(pack: ArchivePack, json: boolean): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify(pack, null, 2)}\n`);
    return;
  }

  const lines = [
    `Pack Budget: ${pack.budget}`,
    "",
    "# Anchor",
    formatPackAnchor(pack.anchor),
    "",
    "# Links",
    ...formatNeighborLines(pack.links),
  ];

  await writeTextToStdout(
    `${truncateToBudget(lines.join("\n"), pack.budget)}\n`,
  );
}

function formatPath(steps: readonly GraphPathStep[]): string {
  if (steps.length === 0) {
    return "No path.\n";
  }

  return `${steps.map((step) => `${formatNodeId(step.node.id)}  ${step.node.label}`).join("\n  ->\n")}\n`;
}

function formatNextCursor(result: ArchiveFindResult): string {
  if (result.nextCursor === null) {
    return "";
  }

  return `\n\nNext page: add --cursor ${result.nextCursor}`;
}

function formatNoMatches(result: ArchiveFindResult): string {
  if (result.match === "all" && result.terms.length > 1) {
    return `No matches. All ${result.terms.length} terms were required. Try: spinedigest find <archive.sdpub> "${result.query}" --match any${formatFindLensHint(result)}\n`;
  }

  const lines = [
    "No matches.",
    "Try fewer or broader keywords, `grep` for an exact continuous phrase, or `list --type fragment` to inspect source fragments.",
  ];

  if (result.lensHint !== null) {
    lines.push(`Lens hint: ${result.lensHint.message}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatFindLensHint(result: ArchiveFindResult): string {
  if (result.lensHint === null) {
    return "";
  }

  return `\n\nLens hint: ${result.lensHint.message}`;
}

function formatFindMatchLine(hit: {
  readonly matchedTerms?: readonly string[];
}): string {
  if (hit.matchedTerms === undefined || hit.matchedTerms.length === 0) {
    return "";
  }

  return `Matched: ${hit.matchedTerms.join(", ")}\n`;
}

function formatCollectionCursor(result: ArchiveCollectionResult): string {
  if (result.nextCursor === null) {
    return "";
  }

  return `\n\nNext page: add --cursor ${result.nextCursor}`;
}

function isSearchFilterType(
  type: NonNullable<CLIArchiveArguments["searchTypes"]>[number],
): type is NonNullable<ArchiveFindOptions["types"]>[number] {
  return type === "fragment" || type === "node" || type === "summary";
}

function formatNeighborLines(neighbors: readonly GraphNeighbor[]): string[] {
  if (neighbors.length === 0) {
    return ["  [none]"];
  }

  return neighbors.map((neighbor) => {
    const arrow = neighbor.direction === "incoming" ? "<-" : "->";

    return `  ${arrow} ${formatNodeId(neighbor.node.id)}  ${neighbor.node.label}`;
  });
}

function formatNodeGroups(
  groups: Extract<ArchivePage, { readonly type: "chapter" }>["nodeGroups"],
): string[] {
  if (groups.length === 0) {
    return ["  [none]"];
  }

  const visibleGroups = groups.slice(0, 12);
  const lines = visibleGroups.flatMap((group) => {
    const visibleNodes = group.nodes.slice(0, 10);
    const moreNodes = group.nodeCount - visibleNodes.length;

    return [
      `  Group ${group.groupId}  ${group.nodeCount} nodes`,
      ...formatNodeLabels(visibleNodes).map((line) => `  ${line}`),
      ...(moreNodes > 0 ? [`    ... ${moreNodes} more nodes`] : []),
    ];
  });

  if (groups.length > visibleGroups.length) {
    lines.push(`  ... ${groups.length - visibleGroups.length} more groups`);
  }

  return lines;
}

function formatNodeLabels(
  nodes: readonly { readonly id: string; readonly title: string }[],
): string[] {
  if (nodes.length === 0) {
    return ["  [none]"];
  }

  return nodes.map((node) => `  ${node.id}  ${node.title}`);
}

function formatSourceFragmentLines(
  fragments: Extract<ArchivePage, { readonly type: "node" }>["sourceFragments"],
): string[] {
  if (fragments.length === 0) {
    return ["  [none]"];
  }

  return fragments.flatMap((fragment) => [
    `  ${fragment.id}${fragment.truncated ? "  [excerpt]" : ""}`,
    ...fragment.text.split("\n").map((line) => `    ${line}`),
  ]);
}

function formatPosition(
  position:
    | {
        readonly chapter: number;
        readonly fragment?: number;
      }
    | undefined,
): string {
  if (position === undefined) {
    return "[unknown]";
  }

  return [
    `chapter ${position.chapter}`,
    position.fragment === undefined
      ? undefined
      : `fragment ${position.fragment}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.round(minutes / 60)}h`;
}

function formatBuildProgressLine(input: {
  readonly graphWords: number;
  readonly outputTokens: number;
  readonly summaryWords: number;
  readonly totalGraphWords: number;
  readonly totalSummaryWords: number;
}): string {
  return [
    "[build]",
    `graph=${formatWholeNumber(input.graphWords)}/${formatWholeNumber(input.totalGraphWords)}w`,
    `summary=${formatWholeNumber(input.summaryWords)}/${formatWholeNumber(input.totalSummaryWords)}w`,
    `out~${formatWholeNumber(input.outputTokens)}tok`,
  ].join(" ");
}

function estimateOutputTokens(
  outputCharacters: number,
  outputCharactersPerToken: number,
): number {
  if (outputCharacters <= 0) {
    return 0;
  }

  return Math.ceil(outputCharacters / outputCharactersPerToken);
}

function formatWholeNumber(value: number): string {
  return String(Math.max(0, Math.round(value)));
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
    lines.push(...result.pending.map(formatBuildChapterEntry));
  }
  if (result.skipped.some((entry) => entry.stage === "planned")) {
    lines.push(
      "",
      "Next: set source for planned chapters, then build again.",
      "Example: spinedigest chapter set-source <archive.sdpub> --chapter <id> --input <file> --input-format txt",
    );
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function formatBuildChapterEntry(entry: ChapterEntry): string {
  return `[${entry.chapterId}] ${formatStage(entry.stage).padEnd(8)} ${formatTocPath(entry)}`;
}

function formatTocPath(entry: ChapterEntry): string {
  if (entry.tocPath.length === 0) {
    return entry.title ?? "[untitled]";
  }

  return entry.tocPath.join(" / ");
}

function formatProgressChapter(entry: ChapterEntry): string {
  return `chapter ${entry.chapterId} (${formatTocPath(entry)})`;
}

function formatProgressVerb(step: "graph" | "summary"): string {
  switch (step) {
    case "graph":
      return "Generating graph";
    case "summary":
      return "Generating summary";
  }
}

function formatProgressStep(step: "graph" | "summary"): string {
  switch (step) {
    case "graph":
      return "graph";
    case "summary":
      return "summary";
  }
}

function formatPackAnchor(anchor: ArchivePage): string {
  switch (anchor.type) {
    case "chapter":
      return `${anchor.id} ${anchor.title}\n${anchor.summary ?? "[summary missing]"}`;
    case "fragment":
      return `${anchor.id}\n${anchor.fragment.text}`;
    case "meta":
      return `${anchor.id}\n${JSON.stringify(anchor.meta, null, 2)}`;
    case "node":
      return [
        `${anchor.id} ${anchor.title}`,
        "",
        "Generated Node Summary:",
        anchor.generatedNodeSummary,
        "",
        "Source Fragments:",
        ...formatSourceFragmentLines(anchor.sourceFragments),
      ].join("\n");
    case "summary":
      return `${anchor.id} ${anchor.title}\n${anchor.content}`;
  }
}

function formatChapterNextSteps(
  page: Extract<ArchivePage, { readonly type: "chapter" }>,
): string {
  return [
    "Next:",
    `  spinedigest list <archive.sdpub> --type node --chapter ${page.chapter.chapterId}`,
    `  spinedigest find <archive.sdpub> <keyword> --chapter ${page.chapter.chapterId}`,
    `  spinedigest read <archive.sdpub> ${page.id}`,
  ].join("\n");
}

function truncateToBudget(text: string, budget: number): string {
  if (text.length <= budget) {
    return text;
  }

  return `${text.slice(0, Math.max(0, budget - 20))}\n[truncated]`;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatFetchedUrlSource(url: string, text: string): string {
  return [`# ${url}`, "", text].join("\n");
}

function formatStage(stage: ChapterStage): string {
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

function formatEstimateStage(stage: ArchiveEstimate["targetStage"]): string {
  switch (stage) {
    case "planned":
      return "planned";
    case "source":
    case "sourced":
      return "source";
    case "graph":
    case "graphed":
      return "graph";
    case "summary":
    case "summarized":
      return "summary";
    default:
      return stage;
  }
}

async function readAllText(stream: AsyncIterable<string>): Promise<string> {
  let text = "";

  for await (const chunk of stream) {
    text += chunk;
  }

  return text;
}

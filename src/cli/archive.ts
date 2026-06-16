import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  findGraphPath,
  getArchiveIndex,
  listArchiveLinks,
  listArchiveObjects,
  listRelatedArchiveObjects,
  packArchiveContext,
  readArchiveEvidence,
  readArchivePage,
  estimateArchiveBuild,
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
  type GraphEvidenceLine,
  type GraphNeighbor,
  type GraphPathStep,
} from "../facade/index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";
import type { Document } from "../document/index.js";

import type { CLIArchiveArguments } from "./args.js";
import { runConvertCommand } from "./convert.js";
import { readTextStreamFromStdin, writeTextToStdout } from "./io.js";
import { runSdpubStageCommand } from "./sdpub-stage.js";

export async function runArchiveCommand(
  args: CLIArchiveArguments,
): Promise<void> {
  switch (args.action) {
    case "import":
      await importArchive(args);
      return;
    case "build": {
      const targetStage =
        args.targetStage === "ready" || args.targetStage === "source"
          ? undefined
          : args.targetStage;
      await runSdpubStageCommand({
        action: "advance",
        path: args.archivePath,
        ...(args.chapterId === undefined ? {} : { chapterId: args.chapterId }),
        ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
        ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
        ...(targetStage === undefined ? {} : { targetStage }),
      });
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
          await estimateArchiveBuild(document, args.targetStage ?? "ready"),
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
    case "ls":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeList(
          await listArchiveObjects(document, args.listKind ?? "chapters"),
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
    case "evidence":
      await withArchiveDocument(args.archivePath, async (document) => {
        await writeEvidence(
          await readArchiveEvidence(document, args.objectId!),
          args.json ?? false,
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

async function importArchive(args: CLIArchiveArguments): Promise<void> {
  if (args.sourcePath === undefined) {
    await importArchiveFromStdin(args);
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
    join(tmpdir(), "spinedigest-url-import-"),
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

async function importArchiveFromStdin(
  args: CLIArchiveArguments,
): Promise<void> {
  if (args.inputFormat === undefined) {
    throw new Error("Internal error: missing stdin import format.");
  }
  if (process.stdin.isTTY) {
    throw new Error(
      "Missing source input. Pipe text into stdin or pass a source path.",
    );
  }

  const temporaryDirectoryPath = await mkdtemp(
    join(tmpdir(), "spinedigest-stdin-import-"),
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
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.searchOrder === undefined ? {} : { order: args.searchOrder }),
    ...(args.searchTypes === undefined ? {} : { types: args.searchTypes }),
  };
}

async function withArchiveDocument<T>(
  path: string,
  operation: (document: Document) => Promise<T> | T,
): Promise<void> {
  await new SpineDigestFile(path).openEditableSession(operation);
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
      "  Next: inspect a chapter with `spinedigest page <archive.sdpub> chapter:<id>` or build `--stage ready` if you need summaries.",
    );
  } else if (index.edgeCount === 0) {
    lines.push(
      "",
      "Graph note:",
      "  Graph nodes exist, but no edges are currently available. This can be valid when extracted nodes have no stable relationships.",
      "  Next: inspect nodes with `spinedigest ls <archive.sdpub> nodes`.",
    );
  }

  if (action === "index") {
    lines.push("", "Entry Points:");
    for (const chapter of index.chapters.slice(0, 12)) {
      lines.push(
        `  chapter:${chapter.chapterId}  ${chapter.title ?? "[untitled]"} (${chapter.stage})`,
      );
    }
    lines.push(
      "",
      "Next:",
      "  spinedigest find <archive.sdpub> <term>",
      "  spinedigest page <archive.sdpub> chapter:<id>",
      "  spinedigest ls <archive.sdpub> nodes",
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
      `Target stage: ${estimate.targetStage}`,
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

async function writeFindHits(
  result: ArchiveFindResult,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.items.length === 0) {
    await writeTextToStdout("No matches.\n");
    return;
  }

  await writeTextToStdout(
    `${result.items
      .map(
        (hit) =>
          `${hit.id}  ${hit.type}/${hit.field}  ${hit.title}\n${hit.snippet}\nNext: spinedigest page <archive.sdpub> ${hit.id}`,
      )
      .join("\n\n")}${formatNextCursor(result)}\n`,
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
          `Stage: ${page.chapter.stage}`,
          `Fragments: ${page.chapter.fragmentCount}`,
          "",
          page.content === undefined
            ? formatChapterSourcePreview(page)
            : page.content,
        ].join("\n") + "\n",
      );
      return;
    case "evidence":
      await writeTextToStdout(`${page.id}\n${page.text}\n`);
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
          `Sentences: ${page.fragment.sentenceCount}`,
          `Words: ${page.fragment.wordsCount}`,
          "",
          page.fragment.text,
        ].join("\n") + "\n",
      );
      return;
    case "node":
      await writeTextToStdout(
        [
          `${page.id}  ${page.node.label}`,
          "",
          page.node.content,
          "",
          "Links:",
          ...formatNeighborLines(page.neighbors),
          "",
          "Evidence:",
          ...formatEvidenceLines(page.evidence),
        ].join("\n") + "\n",
      );
      return;
    case "summary":
      await writeTextToStdout(`${page.id}  ${page.title}\n\n${page.content}\n`);
      return;
  }
}

async function writeEvidence(
  evidence: readonly GraphEvidenceLine[],
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(`${JSON.stringify({ evidence }, null, 2)}\n`);
    return;
  }

  if (evidence.length === 0) {
    await writeTextToStdout("No source evidence.\n");
    return;
  }

  await writeTextToStdout(`${formatEvidenceLines(evidence).join("\n")}\n`);
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
        "  spinedigest ls <archive.sdpub> nodes",
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
    "# Evidence",
    ...formatEvidenceLines(pack.evidence),
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

function formatNeighborLines(neighbors: readonly GraphNeighbor[]): string[] {
  if (neighbors.length === 0) {
    return ["  [none]"];
  }

  return neighbors.map((neighbor) => {
    const arrow = neighbor.direction === "incoming" ? "<-" : "->";

    return `  ${arrow} ${formatNodeId(neighbor.node.id)}  ${neighbor.node.label}`;
  });
}

function formatEvidenceLines(evidence: readonly GraphEvidenceLine[]): string[] {
  if (evidence.length === 0) {
    return ["  [none]"];
  }

  return evidence.map(
    (line) => `  sentence:${line.sentenceId.join(":")}  ${line.text}`,
  );
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

function formatPackAnchor(anchor: ArchivePage): string {
  switch (anchor.type) {
    case "chapter":
      return `${anchor.id} ${anchor.title}\n${anchor.content ?? "[summary missing]"}`;
    case "evidence":
      return `${anchor.id}\n${anchor.text}`;
    case "fragment":
      return `${anchor.id}\n${anchor.fragment.text}`;
    case "meta":
      return `${anchor.id}\n${JSON.stringify(anchor.meta, null, 2)}`;
    case "node":
      return `${anchor.id} ${anchor.node.label}\n${anchor.node.content}`;
    case "summary":
      return `${anchor.id} ${anchor.title}\n${anchor.content}`;
  }
}

function formatChapterSourcePreview(
  page: Extract<ArchivePage, { readonly type: "chapter" }>,
): string {
  const lines = ["[summary missing]"];

  if (page.sourcePreview !== undefined) {
    lines.push("", "Source Preview:", page.sourcePreview);
  }

  if (page.fragments.length > 0) {
    lines.push(
      "",
      "Fragments:",
      ...page.fragments.map(
        (fragment) =>
          `  ${fragment.id}  ${fragment.sentenceCount} sentences, ${fragment.wordsCount} words`,
      ),
    );
  }

  lines.push(
    "",
    "Next:",
    "  spinedigest find <archive.sdpub> <keyword>",
    `  spinedigest build <archive.sdpub> --chapter ${page.chapter.chapterId} --stage graph --confirm`,
  );

  return lines.join("\n");
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

async function readAllText(stream: AsyncIterable<string>): Promise<string> {
  let text = "";

  for await (const chunk of stream) {
    text += chunk;
  }

  return text;
}

import { mkdtemp, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";

import {
  getArchiveIndex,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  packArchiveContext,
  readArchivePage,
  estimateArchiveBuild,
  findArchiveObjects,
  type ArchiveEstimate,
  type ArchiveEvidence,
  type ArchiveEvidenceItem,
  type ArchiveFindOptions,
  type ArchiveFindResult,
  type ArchiveIndex,
  type ArchiveListItem,
  type ArchivePack,
  type ArchivePage,
  type ChapterStage,
} from "../facade/index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";
import type { ReadonlyDocument } from "../document/index.js";

import type { CLIArchiveArguments } from "./args.js";
import { runConvertCommand } from "./convert.js";
import { readTextStreamFromStdin, writeTextToStdout } from "./io.js";

type ResultFormat = "json" | "jsonl" | "text";

export async function runArchiveCommand(
  args: CLIArchiveArguments,
): Promise<void> {
  switch (args.action) {
    case "create":
      await createArchive(args);
      return;
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
      await readArchiveDocument(args.archivePath, async (document) => {
        await writeEstimate(
          await estimateArchiveBuild(
            document,
            args.targetStage ?? "summarized",
          ),
          args.json ?? false,
        );
      });
      return;
    case "index": {
      await readArchiveDocument(args.archivePath, async (document) => {
        await writeIndex(
          await getArchiveIndex(document),
          "index",
          args.json ?? false,
        );
      });
      return;
    }
    case "search":
      await readArchiveDocument(args.archivePath, async (document) => {
        await writeFindHits(
          await findArchiveObjects(
            document,
            args.query!,
            createFindOptions(args),
          ),
          args.format ?? "text",
        );
      });
      return;
    case "get":
      await readArchiveDocument(args.archivePath, async (document) => {
        await writePage(
          await readArchivePage(document, toArchiveObjectId(args.objectId!)),
          args.format ?? "text",
        );
      });
      return;
    case "related":
      await readArchiveDocument(args.archivePath, async (document) => {
        await writeList(
          await listRelatedArchiveObjects(
            document,
            toArchiveObjectId(args.objectId!),
          ),
          args.format ?? "text",
        );
      });
      return;
    case "evidence":
      await readArchiveDocument(args.archivePath, async (document) => {
        await writeEvidence(
          await listArchiveEvidence(document, args.objectId!),
          args.format ?? "text",
        );
      });
      return;
    case "pack":
      await readArchiveDocument(args.archivePath, async (document) => {
        await writePack(
          await packArchiveContext(
            document,
            toArchiveObjectId(args.objectId!),
            args.budget ?? 5000,
          ),
          args.format ?? "text",
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
  const types = args.kinds?.map((kind) => {
    const type = toArchiveFindType(kind);

    if (type === undefined) {
      throw new Error(`Unsupported archive search type: ${kind}`);
    }

    return type;
  });

  return {
    archiveKey: resolve(args.archivePath),
    ...(args.chapters === undefined ? {} : { chapters: args.chapters }),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(types === undefined ? {} : { types }),
  };
}

async function readArchiveDocument<T>(
  path: string,
  operation: (document: ReadonlyDocument) => Promise<T> | T,
): Promise<void> {
  await new SpineDigestFile(path).readDocument(operation);
}

async function writeIndex(
  index: ArchiveIndex,
  action: "index",
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
      "Reading Graph:",
      "  No reading chunks are currently available. If a reading-graph queue task already ran, the source may be too short or sparse.",
      "  Next: inspect source with `spinedigest get <archive.sdpub> wikigraph://source/chapter/<id>` or queue `--task reading-graph`.",
    );
  } else if (index.edgeCount === 0) {
    lines.push(
      "",
      "Reading Graph:",
      "  Reading chunks exist, but no chunk edges are currently available. This can be valid when extracted chunks have no stable relationships.",
      "  Next: inspect chunks with `spinedigest search <archive.sdpub> <query> --type chunk`.",
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
      "  spinedigest search <archive.sdpub> <term>",
      "  spinedigest get <archive.sdpub> wikigraph://source/chapter/<id>",
      "  spinedigest related <archive.sdpub> <uri>",
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
  format: ResultFormat,
): Promise<void> {
  const outputItems = items.map((item) => ({
    ...item,
    id: toWikiGraphUri(item.id),
  }));

  if (format === "json") {
    await writeTextToStdout(
      `${JSON.stringify({ items: outputItems }, null, 2)}\n`,
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL(outputItems);
    return;
  }

  if (outputItems.length === 0) {
    await writeTextToStdout("No objects.\n");
    return;
  }

  await writeTextToStdout(
    `${outputItems
      .map((item) => `${item.id}  ${item.label}  ${item.summary}`)
      .join("\n")}\n`,
  );
}

async function writeFindHits(
  result: ArchiveFindResult,
  format: ResultFormat,
): Promise<void> {
  if (format === "json") {
    await writeTextToStdout(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (format === "jsonl") {
    await writeJSONL(result.items);
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
          `${toWikiGraphUri(hit.id)}\n${hit.title}\n${formatFindMatchLine(hit)}${hit.snippet}`,
      )
      .join("\n\n")}${formatNextCursor(result)}${formatFindLensHint(result)}\n`,
  );
}

async function writeEvidence(
  evidence: ArchiveEvidence,
  format: ResultFormat,
): Promise<void> {
  if (format === "json") {
    await writeTextToStdout(`${JSON.stringify(evidence, null, 2)}\n`);
    return;
  }
  if (format === "jsonl") {
    await writeJSONL(evidence.items);
    return;
  }

  if (evidence.items.length === 0) {
    await writeTextToStdout("No evidence.\n");
    return;
  }

  await writeTextToStdout(
    `${evidence.items.map(formatEvidenceItem).join("\n\n")}\n`,
  );
}

function formatEvidenceItem(item: ArchiveEvidenceItem): string {
  return [
    item.id,
    `@@ ${item.startSentenceIndex}..${item.endSentenceIndex} @@`,
    item.source,
  ].join("\n");
}

async function writePage(
  page: ArchivePage,
  format: ResultFormat,
): Promise<void> {
  if (format === "json") {
    await writeTextToStdout(`${JSON.stringify(page, null, 2)}\n`);
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([page]);
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

async function writePack(
  pack: ArchivePack,
  format: ResultFormat,
): Promise<void> {
  if (format === "json") {
    await writeTextToStdout(`${JSON.stringify(pack, null, 2)}\n`);
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([pack]);
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

function formatNextCursor(result: ArchiveFindResult): string {
  if (result.nextCursor === null) {
    return "";
  }

  return `\n\nNext page: add --cursor ${result.nextCursor}`;
}

function formatNoMatches(result: ArchiveFindResult): string {
  if (result.match === "all" && result.terms.length > 1) {
    return `No matches. Try: spinedigest search <archive.sdpub> "${result.query}" --type ${formatFindTypes(result)}${formatFindLensHint(result)}\n`;
  }

  const lines = [
    "No matches.",
    "Try fewer or broader keywords, or filter with `--type source|summary|chunk`.",
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

function formatFindTypes(result: ArchiveFindResult): string {
  return result.types === null || result.types.length === 0
    ? "chunk"
    : result.types
        .map((type) =>
          type === "node" ? "chunk" : type === "fragment" ? "source" : type,
        )
        .join(",");
}

function formatFindMatchLine(hit: {
  readonly matchedTerms?: readonly string[];
}): string {
  if (hit.matchedTerms === undefined || hit.matchedTerms.length === 0) {
    return "";
  }

  return `Matched: ${hit.matchedTerms.join(", ")}\n`;
}

function formatNeighborLines(
  neighbors: Extract<ArchivePage, { readonly type: "node" }>["neighbors"],
): string[] {
  if (neighbors.length === 0) {
    return ["  [none]"];
  }

  return neighbors.map((neighbor) => {
    const arrow = neighbor.direction === "incoming" ? "<-" : "->";

    return `  ${arrow} ${toWikiGraphUri(`node:${neighbor.node.id}`)}  ${neighbor.node.label}`;
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
    `  spinedigest search <archive.sdpub> <keyword> --type chunk --chapter ${page.chapter.chapterId}`,
    `  spinedigest get <archive.sdpub> wikigraph://source/chapter/${page.chapter.chapterId}`,
  ].join("\n");
}

function truncateToBudget(text: string, budget: number): string {
  if (text.length <= budget) {
    return text;
  }

  return `${text.slice(0, Math.max(0, budget - 20))}\n[truncated]`;
}

async function writeJSONL(items: readonly unknown[]): Promise<void> {
  await writeTextToStdout(
    items.map((item) => JSON.stringify(item)).join("\n") +
      (items.length === 0 ? "" : "\n"),
  );
}

function toArchiveObjectId(uri: string): string {
  if (!uri.startsWith("wikigraph://")) {
    return uri;
  }

  const parsed = new URL(uri);
  const pathParts = parsed.pathname.split("/").filter((part) => part !== "");

  switch (parsed.hostname) {
    case "chunk":
      return `node:${pathParts[0] ?? ""}`;
    case "source":
      if (pathParts[0] === "chapter" && pathParts[1] !== undefined) {
        return `chapter:${pathParts[1]}`;
      }
      break;
    case "summary":
      if (pathParts[0] === "chapter" && pathParts[1] !== undefined) {
        return `summary:${pathParts[1]}`;
      }
      break;
    case "entity":
    case "triple":
      throw new Error(`${uri} is not readable by the current archive adapter.`);
  }

  throw new Error(`Invalid Wiki Graph URI: ${uri}`);
}

function toWikiGraphUri(id: string): string {
  const [type, first, second] = id.split(":");

  switch (type) {
    case "chapter":
      return `wikigraph://source/chapter/${first ?? ""}`;
    case "fragment":
      return `wikigraph://source/chapter/${first ?? ""}#${second ?? "0"}..${second ?? "0"}`;
    case "node":
      return `wikigraph://chunk/${first ?? ""}`;
    case "summary":
      return `wikigraph://summary/chapter/${first ?? ""}`;
    default:
      return id;
  }
}

function toArchiveFindType(
  kind: NonNullable<CLIArchiveArguments["kinds"]>[number],
): NonNullable<ArchiveFindOptions["types"]>[number] | undefined {
  switch (kind) {
    case "chunk":
      return "node";
    case "source":
      return "fragment";
    case "summary":
      return "summary";
    case "entity":
      return "entity";
    case "triple":
      return "triple";
  }
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

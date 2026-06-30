import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  getArchiveIndex,
  listArchiveCollection,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  packArchiveContext,
  readArchivePage,
  estimateArchiveBuild,
  findArchiveObjects,
  createContinuationCursor,
  readContinuationCursor,
  type ArchiveEstimate,
  type ArchiveEvidence,
  type ArchiveEvidenceItem,
  type ArchiveFindEvidencePreview,
  type ArchiveFindOptions,
  type ArchiveFindResult,
  type ArchiveFindHit,
  type ArchiveCollectionOptions,
  type ArchiveCollectionResult,
  type ArchiveIndex,
  type ArchiveListItem,
  type ArchivePack,
  type ArchivePage,
  type ChapterStage,
  type ContinuationCursor,
} from "../facade/index.js";
import {
  parseLocatedWikiGraphUri,
  requireLocatedObjectUri,
} from "../facade/archive-uri.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";
import type { ReadonlyDocument } from "../document/index.js";

import type { CLIArchiveArguments } from "./args.js";
import { runConvertCommand } from "./convert.js";
import { readTextStreamFromStdin, writeTextToStdout } from "./io.js";
import { formatCLIJSON, formatCLIJSONLine } from "./json.js";

type ResultFormat = "json" | "jsonl" | "text";

const DEFAULT_OUTPUT_LIMIT = 20;
const PLAIN_OBJECT_KEY_PRIORITY = [
  "uri",
  "title",
  "label",
  "labels",
  "stage",
  "authors",
  "publisher",
  "description",
] as const;

interface ArchiveOutputObject {
  readonly authors?: readonly string[];
  readonly description?: string;
  readonly evidence?: ArchiveOutputEvidencePreview;
  readonly label?: string;
  readonly objectLabel?: string;
  readonly predicate?: string;
  readonly publisher?: string;
  readonly score?: number;
  readonly stage?: string;
  readonly subjectLabel?: string;
  readonly summary?: string;
  readonly title?: string;
  readonly type?: string;
  readonly uri: string;
}

interface ArchiveOutputEvidencePreview {
  readonly nextCursor: string | null;
  readonly shown: number;
  readonly sources: readonly ArchiveOutputSource[];
  readonly total: number;
}

interface ArchiveOutputSource {
  readonly text: string;
  readonly uri: string;
}

interface ArchiveOutputContext {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly chapters?: readonly number[];
  readonly continuationKind?: "collection" | "evidence" | "search";
  readonly evidenceLimit?: number;
  readonly format: ResultFormat;
  readonly ids?: readonly string[];
  readonly limit: number;
  readonly order?: ArchiveCollectionResult["order"];
  readonly targetUri?: string;
  readonly types: readonly string[] | null;
}

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
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          await writeFindHits(
            await findArchiveObjects(
              document,
              args.query!,
              createFindOptions(args),
            ),
            createArchiveOutputContext(args),
            args.format ?? "text",
          );
        },
      );
      return;
    case "list":
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          await writeFindHits(
            createCollectionFindResult(
              await listArchiveCollection(
                document,
                createCollectionOptions(args),
              ),
            ),
            createArchiveOutputContext(args, {
              continuationKind: "collection",
            }),
            args.format ?? "text",
          );
        },
      );
      return;
    case "get":
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          await writePage(
            await readArchivePage(document, getObjectUri(args.objectId!), {
              ...(args.evidenceLimit === undefined
                ? {}
                : { evidenceLimit: args.evidenceLimit }),
            }),
            createArchiveOutputContext(args),
            args.format ?? "text",
          );
        },
      );
      return;
    case "related":
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          await writeList(
            await listRelatedArchiveObjects(
              document,
              getObjectUri(args.objectId!),
            ),
            createArchiveOutputContext(args),
            args.format ?? "text",
          );
        },
      );
      return;
    case "evidence":
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          await writeEvidence(
            await listArchiveEvidence(document, getObjectUri(args.objectId!), {
              ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
              ...(args.limit === undefined ? {} : { limit: args.limit }),
            }),
            createArchiveOutputContext(args, {
              continuationKind: "evidence",
              targetUri: getObjectUri(args.objectId!),
            }),
            args.format ?? "text",
          );
        },
      );
      return;
    case "next":
      await runNextArchivePage(args);
      return;
    case "pack":
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          await writePack(
            await packArchiveContext(
              document,
              getObjectUri(args.objectId!),
              args.budget ?? 5000,
            ),
            createArchiveOutputContext(args),
            args.format ?? "text",
          );
        },
      );
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
    join(tmpdir(), "wikigraph-url-create-"),
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

async function runNextArchivePage(args: CLIArchiveArguments): Promise<void> {
  const cursorId = args.cursor ?? args.archivePath;
  const explicitArchivePath =
    args.cursor === undefined ? undefined : args.archivePath;
  const cursor = await readContinuationCursor(cursorId);

  if (explicitArchivePath !== undefined) {
    const archivePath = getArchivePath(explicitArchivePath);

    if (archivePath !== cursor.archivePath) {
      throw new Error(
        `Continuation cursor ${cursorId} belongs to ${cursor.archivePath}, not ${archivePath}.`,
      );
    }
  }

  await readArchiveDocument(cursor.archivePath, async (document) => {
    const format = args.format ?? cursor.format;
    const limit = args.limit ?? DEFAULT_OUTPUT_LIMIT;

    switch (cursor.kind) {
      case "collection": {
        const collectionOptions: ArchiveCollectionOptions = {
          ...(cursor.chapters === null ? {} : { chapters: cursor.chapters }),
          cursor: cursor.cursor,
          ...(cursor.evidenceLimit === undefined
            ? {}
            : { evidenceLimit: cursor.evidenceLimit }),
          ...(cursor.ids === null ? {} : { ids: cursor.ids }),
          limit,
          order: cursor.order,
        };

        if (cursor.types !== null) {
          Object.assign(collectionOptions, {
            types: cursor.types as ArchiveCollectionOptions["types"],
          });
        }

        await writeFindHits(
          createCollectionFindResult(
            await listArchiveCollection(document, collectionOptions),
          ),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            ...(cursor.chapters === null ? {} : { chapters: cursor.chapters }),
            continuationKind: "collection",
            ...(cursor.evidenceLimit === undefined
              ? {}
              : { evidenceLimit: cursor.evidenceLimit }),
            format,
            ...(cursor.ids === null ? {} : { ids: cursor.ids }),
            limit,
            order: cursor.order,
            types: cursor.types,
          },
          format,
        );
        return;
      }
      case "search": {
        const findOptions: ArchiveFindOptions = {
          archiveKey: cursor.archiveKey,
          cursor: cursor.cursor,
          ...(cursor.evidenceLimit === undefined
            ? {}
            : { evidenceLimit: cursor.evidenceLimit }),
          limit,
        };

        if (cursor.types !== null) {
          Object.assign(findOptions, {
            types: cursor.types as ArchiveFindOptions["types"],
          });
        }

        await writeFindHits(
          await findArchiveObjects(document, "", findOptions),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            ...(cursor.evidenceLimit === undefined
              ? {}
              : { evidenceLimit: cursor.evidenceLimit }),
            format,
            limit,
            types: cursor.types,
          },
          format,
        );
        return;
      }
      case "evidence":
        await writeEvidence(
          await listArchiveEvidence(document, cursor.targetUri, {
            cursor: cursor.cursor,
            limit,
          }),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            continuationKind: "evidence",
            format,
            limit,
            targetUri: cursor.targetUri,
            types: null,
          },
          format,
        );
        return;
    }
  });
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
    join(tmpdir(), "wikigraph-stdin-create-"),
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
    archiveKey: getArchivePath(args.archivePath),
    ...createScopeOptions(args.archivePath),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    ...(args.evidenceLimit === undefined
      ? {}
      : { evidenceLimit: args.evidenceLimit }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(types === undefined ? {} : { types }),
  };
}

function createArchiveOutputContext(
  args: CLIArchiveArguments,
  options: {
    readonly continuationKind?: "collection" | "evidence" | "search";
    readonly targetUri?: string;
  } = {},
): ArchiveOutputContext {
  return {
    archiveKey: getArchivePath(args.archivePath),
    archivePath: getArchivePath(args.archivePath),
    ...(options.continuationKind === undefined
      ? {}
      : { continuationKind: options.continuationKind }),
    ...(args.evidenceLimit === undefined
      ? {}
      : { evidenceLimit: args.evidenceLimit }),
    format: args.format ?? "text",
    limit: args.limit ?? DEFAULT_OUTPUT_LIMIT,
    ...(options.continuationKind === "collection"
      ? createScopeOptions(args.archivePath)
      : {}),
    ...(options.targetUri === undefined
      ? {}
      : { targetUri: options.targetUri }),
    types:
      args.kinds === undefined
        ? null
        : args.kinds
            .map((kind) => toArchiveFindType(kind))
            .filter(
              (type): type is NonNullable<typeof type> => type !== undefined,
            ),
  };
}

async function createOutputContinuationCursor(
  context: ArchiveOutputContext,
  cursor: string | null | undefined,
): Promise<string | null> {
  if (cursor === null || cursor === undefined) {
    return null;
  }

  let input: ContinuationCursor;

  if (context.continuationKind === "evidence") {
    input = {
      archiveKey: context.archiveKey,
      archivePath: context.archivePath,
      cursor,
      format: context.format,
      kind: "evidence",
      targetUri: context.targetUri ?? "",
    };
  } else if (context.continuationKind === "collection") {
    input = {
      archiveKey: context.archiveKey,
      archivePath: context.archivePath,
      chapters: context.chapters ?? null,
      cursor,
      ...(context.evidenceLimit === undefined
        ? {}
        : { evidenceLimit: context.evidenceLimit }),
      format: context.format,
      ids: context.ids ?? null,
      kind: "collection",
      order: context.order ?? "doc-asc",
      types: context.types,
    };
  } else {
    input = {
      archiveKey: context.archiveKey,
      archivePath: context.archivePath,
      cursor,
      ...(context.evidenceLimit === undefined
        ? {}
        : { evidenceLimit: context.evidenceLimit }),
      format: context.format,
      kind: "search",
      types: context.types,
    };
  }

  return await createContinuationCursor(input);
}

function createCollectionOptions(
  args: CLIArchiveArguments,
): ArchiveCollectionOptions {
  const types = args.kinds?.map((kind) => {
    const type = toArchiveCollectionType(kind);

    if (type === undefined) {
      throw new Error(`Unsupported archive list type: ${kind}`);
    }

    return type;
  });

  return {
    ...createScopeOptions(args.archivePath),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    ...(args.evidenceLimit === undefined
      ? {}
      : { evidenceLimit: args.evidenceLimit }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(types === undefined ? {} : { types }),
  };
}

function createCollectionFindResult(
  collection: ArchiveCollectionResult,
): ArchiveFindResult {
  return {
    chapters: collection.chapters,
    items: collection.items,
    lens: "typed",
    lensHint: null,
    limit: collection.limit,
    match: "any",
    nextCursor: collection.nextCursor,
    order: collection.order,
    query: "",
    terms: [],
    types: null,
  };
}

function createScopeOptions(uri: string): {
  readonly chapters?: readonly number[];
} {
  const objectUri = parseLocatedWikiGraphUri(uri).objectUri;

  if (objectUri === undefined) {
    return {};
  }

  const chapterId = parseChapterScope(objectUri);

  return chapterId === undefined ? {} : { chapters: [chapterId] };
}

function getArchivePath(uri: string): string {
  return requireLocatedObjectOrArchiveUri(uri).archivePath;
}

function getObjectUri(uri: string): string {
  return requireLocatedObjectUri(uri).objectUri;
}

function requireLocatedObjectOrArchiveUri(uri: string): {
  readonly archivePath: string;
} {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(
      [
        `Expected a Wiki Graph URI with a .sdpub archive locator: ${uri}`,
        `Example: ${uri.endsWith(".sdpub") && uri.startsWith("/") ? `wikigraph://${uri}` : "wikigraph:///absolute/path/book.sdpub"}`,
        "See: wikigraph help uri",
      ].join("\n"),
    );
  }

  return { archivePath: parsed.archivePath };
}

function parseChapterScope(uri: string): number | undefined {
  const match = /^wikigraph:\/\/chapter\/([1-9][0-9]*)(?:\/|$)/u.exec(uri);

  return match?.[1] === undefined ? undefined : Number(match[1]);
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
    await writeTextToStdout(formatCLIJSON(index));
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
      "  Next: inspect source with `wikigraph get wikigraph://<archive.sdpub>/chapter/<id>/source/` or queue `--task reading-graph`.",
    );
  } else if (index.edgeCount === 0) {
    lines.push(
      "",
      "Reading Graph:",
      "  Reading chunks exist, but no chunk edges are currently available. This can be valid when extracted chunks have no stable relationships.",
      "  Next: inspect chunks with `wikigraph search wikigraph://<archive.sdpub> <query> --type chunk`.",
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
      "  wikigraph search wikigraph://<archive.sdpub> <term>",
      "  wikigraph get wikigraph://<archive.sdpub>/chapter/<id>/source/",
      "  wikigraph related <object-uri>",
    );
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

async function writeEstimate(
  estimate: ArchiveEstimate,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(formatCLIJSON(estimate));
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
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const objects = items.map(createListObject);

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(createObjectResultPage(objects, null, items.length)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL(objects);
    return;
  }

  if (objects.length === 0) {
    await writeTextToStdout("No objects.\n");
    return;
  }

  await writeTextToStdout(`${items.map(formatListItem).join("\n\n")}\n`);
}

function formatListItem(item: ArchiveListItem): string {
  if (item.type === "triple") {
    return [
      toWikiGraphUri(item.id),
      `${item.subjectLabel}(${item.subjectQid}) ${item.predicate} ${item.objectLabel}(${item.objectQid})`,
    ].join("\n");
  }

  return [toWikiGraphUri(item.id), item.label, item.summary].join("\n");
}

function createListObject(item: ArchiveListItem): {
  readonly label?: string;
  readonly objectLabel?: string;
  readonly predicate?: string;
  readonly subjectLabel?: string;
  readonly summary?: string;
  readonly type?: ArchiveListItem["type"];
  readonly uri: string;
} {
  if (item.type === "triple") {
    return {
      objectLabel: item.objectLabel,
      predicate: item.predicate,
      subjectLabel: item.subjectLabel,
      uri: toWikiGraphUri(item.id),
    };
  }

  return {
    label: item.label,
    summary: item.summary,
    type: item.type,
    uri: toWikiGraphUri(item.id),
  };
}

function createObjectResultPage(
  objects: readonly unknown[],
  nextCursor: string | null,
  limit: number,
): {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly objects: readonly unknown[];
} {
  return {
    limit,
    nextCursor,
    objects,
  };
}

async function writeFindHits(
  result: ArchiveFindResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const objects = await Promise.all(
    result.items.map(async (item) => await createFindObject(item, context)),
  );
  const nextCursor = await createOutputContinuationCursor(
    context,
    result.nextCursor,
  );

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(createObjectResultPage(objects, nextCursor, result.limit)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([...objects, createPageCursorObject(nextCursor)]);
    return;
  }

  if (objects.length === 0) {
    await writeTextToStdout(formatNoMatches(result));
    return;
  }

  await writeTextToStdout(
    `${objects
      .map((object) => formatFindObject(object))
      .join(
        "\n\n",
      )}${formatNextCursor(nextCursor)}${formatFindLensHint(result)}\n`,
  );
}

async function writeEvidence(
  evidence: ArchiveEvidence,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const nextCursor = await createOutputContinuationCursor(
    context,
    evidence.nextCursor,
  );
  const objects = evidence.items.map(createSourceObject);

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(
        createObjectResultPage(objects, nextCursor, evidence.limit),
      ),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([...objects, createPageCursorObject(nextCursor)]);
    return;
  }

  if (evidence.items.length === 0) {
    await writeTextToStdout("No evidence.\n");
    return;
  }

  await writeTextToStdout(
    `${evidence.items.map(formatEvidenceItem).join("\n\n")}${formatEvidenceNextCursor(nextCursor)}\n`,
  );
}

function formatEvidenceNextCursor(nextCursor: string | null): string {
  return nextCursor === null
    ? ""
    : `\n\nNext page: wikigraph next ${nextCursor}`;
}

function createPageCursorObject(nextCursor: string | null): {
  readonly nextCursor: string | null;
  readonly type: "page";
} {
  return {
    nextCursor,
    type: "page",
  };
}

function formatEvidenceItem(item: ArchiveEvidenceItem): string {
  return [`@@ ${item.id} @@`, normalizeSourceText(item.source)].join("\n");
}

async function writePage(
  page: ArchivePage,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(await createPageObject(page, context)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([await createPageObject(page, context)]);
    return;
  }

  switch (page.type) {
    case "chapter":
      await writeTextToStdout(
        `${formatPlainObject(await createPageObject(page, context))}\n`,
      );
      return;
    case "meta":
      await writeTextToStdout(
        `${formatPlainObject(await createPageObject(page, context))}\n`,
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
    case "entity":
      await writeTextToStdout(
        [
          `${page.id}`,
          page.label,
          `Mentions: ${page.mentionCount}`,
          "",
          "Evidence:",
          ...formatEvidencePreviewBlocks(page.evidence),
        ].join("\n") + "\n",
      );
      return;
    case "triple":
      await writeTextToStdout(
        [
          `${page.id}`,
          page.label,
          "",
          "Evidence:",
          ...formatEvidencePreviewBlocks(page.evidence),
        ].join("\n") + "\n",
      );
      return;
  }
}

async function writePack(
  pack: ArchivePack,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(await createPackObject(pack, context)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([await createPackObject(pack, context)]);
    return;
  }

  const lines = [
    `Pack Budget: ${pack.budget}`,
    "",
    "# Anchor",
    await formatPackAnchor(pack.anchor, context),
    "",
    "# Links",
    ...formatNeighborLines(pack.links),
  ];

  await writeTextToStdout(
    `${truncateToBudget(lines.join("\n"), pack.budget)}\n`,
  );
}

function formatNextCursor(nextCursor: string | null): string {
  if (nextCursor === null) {
    return "";
  }

  return `\n\nNext page: wikigraph next ${nextCursor}`;
}

function formatNoMatches(result: ArchiveFindResult): string {
  if (result.match === "all" && result.terms.length > 1) {
    return `No matches. Try: wikigraph search <archive-uri> "${result.query}" --type ${formatFindTypes(result)}${formatFindLensHint(result)}\n`;
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

async function createFindObject(
  hit: ArchiveFindHit,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputObject> {
  const uri = toWikiGraphUri(hit.id);

  if (hit.type === "chapter") {
    return {
      ...(hit.score === undefined ? {} : { score: hit.score }),
      ...(hit.stage === undefined ? {} : { stage: formatStage(hit.stage) }),
      title: hit.title,
      uri,
    };
  }
  if (hit.type === "meta") {
    return {
      ...(hit.score === undefined ? {} : { score: hit.score }),
      title: hit.title,
      uri,
    };
  }
  if (hit.type === "triple") {
    const triple = hit.triple;

    return {
      ...(context.evidenceLimit === undefined || hit.evidence === undefined
        ? {}
        : {
            evidence: await createEvidencePreviewObject(hit.evidence, {
              ...context,
              continuationKind: "evidence",
              targetUri: uri,
            }),
          }),
      objectLabel: triple?.objectLabel ?? "",
      predicate: triple?.predicate ?? "",
      ...(hit.score === undefined ? {} : { score: hit.score }),
      subjectLabel: triple?.subjectLabel ?? "",
      uri,
    };
  }

  return {
    ...(context.evidenceLimit === undefined || hit.evidence === undefined
      ? {}
      : {
          evidence: await createEvidencePreviewObject(hit.evidence, {
            ...context,
            continuationKind: "evidence",
            targetUri: uri,
          }),
        }),
    label: hit.title,
    ...(hit.score === undefined ? {} : { score: hit.score }),
    ...(context.evidenceLimit !== undefined && hit.type === "entity"
      ? {}
      : { summary: hit.snippet }),
    type: hit.type === "node" ? "chunk" : hit.type,
    uri,
  };
}

async function createEvidencePreviewObject(
  evidence: ArchiveFindEvidencePreview,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputEvidencePreview> {
  return {
    nextCursor: await createOutputContinuationCursor(
      {
        ...context,
        continuationKind: "evidence",
      },
      evidence.nextCursor,
    ),
    shown: evidence.shown,
    sources: evidence.sources.map(createSourceObject),
    total: evidence.total,
  };
}

function createSourceObject(item: ArchiveEvidenceItem): ArchiveOutputSource {
  return {
    text: item.source,
    uri: item.id,
  };
}

async function createPageObject(
  page: ArchivePage,
  context: ArchiveOutputContext,
): Promise<unknown> {
  switch (page.type) {
    case "entity":
      return {
        labels: page.labels.slice(0, 7),
        qid: page.qid,
        ...(context.evidenceLimit === undefined
          ? {}
          : {
              evidence: await createEvidencePreviewObject(page.evidence, {
                ...context,
                continuationKind: "evidence",
                targetUri: page.id,
              }),
            }),
        uri: page.id,
      };
    case "triple":
      return {
        label: page.label,
        ...(context.evidenceLimit === undefined
          ? {}
          : {
              evidence: await createEvidencePreviewObject(page.evidence, {
                ...context,
                continuationKind: "evidence",
                targetUri: page.id,
              }),
            }),
        uri: page.id,
      };
    case "chapter": {
      return {
        stage: formatStage(page.stage),
        title: page.title,
        uri: toWikiGraphUri(page.id),
      };
    }
    case "chapter-tree": {
      const { id: _id, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
    case "fragment": {
      const { id: _id, nextFragmentId, previousFragmentId, ...rest } = page;

      return {
        ...rest,
        ...(nextFragmentId === undefined
          ? {}
          : { nextUri: toWikiGraphUri(nextFragmentId) }),
        ...(previousFragmentId === undefined
          ? {}
          : { previousUri: toWikiGraphUri(previousFragmentId) }),
        uri: toWikiGraphUri(page.id),
      };
    }
    case "meta": {
      const { id: _id, type: _type, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
    case "node": {
      const { id: _id, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
    case "summary": {
      const { id: _id, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
  }
}

async function createPackObject(
  pack: ArchivePack,
  context: ArchiveOutputContext,
): Promise<{
  readonly anchor: unknown;
  readonly budget: number;
  readonly links: ArchivePack["links"];
}> {
  return {
    anchor: await createPageObject(pack.anchor, context),
    budget: pack.budget,
    links: pack.links,
  };
}

function formatFindObject(object: ArchiveOutputObject): string {
  const lines = formatObjectSummaryLines(object);

  if (object.evidence !== undefined && object.evidence.sources.length > 0) {
    lines.push(
      "",
      ...object.evidence.sources.flatMap((source, index) => [
        ...(index === 0 ? [] : [""]),
        `-- evidence ${index + 1}/${object.evidence?.shown ?? object.evidence?.sources.length}`,
        formatSourceObject(source),
      ]),
    );

    const hiddenEvidenceCount = object.evidence.total - object.evidence.shown;

    if (hiddenEvidenceCount > 0) {
      lines.push("", `${hiddenEvidenceCount} evidence more...`);
    }
  }

  return lines.join("\n");
}

function formatObjectSummaryLines(object: ArchiveOutputObject): string[] {
  const uri = `${formatScorePrefix(object.score)}${object.uri}`;

  if (object.predicate !== undefined) {
    return [
      uri,
      `${object.subjectLabel ?? "[subject]"} ${object.predicate} ${object.objectLabel ?? "[object]"}`,
    ];
  }

  return [
    uri,
    object.title,
    object.label,
    object.stage === undefined ? undefined : `stage: ${object.stage}`,
    object.evidence === undefined ? object.summary : undefined,
  ].filter((line): line is string => line !== undefined && line !== "");
}

function formatPlainObject(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return String(value);
  }

  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null)
    .sort(([left], [right]) => comparePlainObjectKeys(left, right))
    .map(([key, item]) => `${key}: ${formatPlainValue(item)}`)
    .join("\n");
}

function comparePlainObjectKeys(left: string, right: string): number {
  return getPlainObjectKeyOrder(left) - getPlainObjectKeyOrder(right);
}

function getPlainObjectKeyOrder(key: string): number {
  const index = PLAIN_OBJECT_KEY_PRIORITY.indexOf(
    key as (typeof PLAIN_OBJECT_KEY_PRIORITY)[number],
  );

  return index < 0 ? PLAIN_OBJECT_KEY_PRIORITY.length : index;
}

function formatPlainValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return formatCLIJSON(value).trimEnd();
  }

  return String(value);
}

function formatScorePrefix(score: number | undefined): string {
  return score === undefined ? "" : `${Math.round(score * 100) / 100} `;
}

function formatSourceObject(source: ArchiveOutputSource): string {
  return [`@@ ${source.uri} @@`, normalizeSourceText(source.text)].join("\n");
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

function formatEvidencePreviewBlocks(
  evidence: ArchiveFindEvidencePreview,
): string[] {
  if (evidence.sources.length === 0) {
    return ["[none]"];
  }

  const lines = evidence.sources.flatMap((item, index) => [
    ...(index === 0 ? [] : [""]),
    `-- evidence ${index + 1}/${evidence.shown}`,
    formatEvidenceItem(item),
  ]);
  const hiddenEvidenceCount = evidence.total - evidence.shown;

  if (hiddenEvidenceCount > 0) {
    lines.push(`${hiddenEvidenceCount} evidence more...`);
  }

  return lines;
}

function normalizeSourceText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  while (lines.length > 0 && lines[0]?.trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines.at(-1)?.trim() === "") {
    lines.pop();
  }

  const normalizedLines: string[] = [];
  let previousLineWasBlank = false;

  for (const line of lines) {
    if (line.trim() === "") {
      if (!previousLineWasBlank) {
        normalizedLines.push("");
      }
      previousLineWasBlank = true;
      continue;
    }

    normalizedLines.push(line);
    previousLineWasBlank = false;
  }

  return normalizedLines.join("\n");
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

async function formatPackAnchor(
  anchor: ArchivePage,
  context: ArchiveOutputContext,
): Promise<string> {
  switch (anchor.type) {
    case "chapter":
      return formatPlainObject(await createPageObject(anchor, context));
    case "chapter-tree":
      return `${anchor.id} ${anchor.title}\n${formatCLIJSON(anchor.tree).trimEnd()}`;
    case "fragment":
      return `${anchor.id}\n${anchor.fragment.text}`;
    case "meta":
      return formatPlainObject(await createPageObject(anchor, context));
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
    case "entity":
      return [
        `${anchor.id}`,
        anchor.label,
        `Mentions: ${anchor.mentionCount}`,
        "",
        "Evidence:",
        ...formatEvidencePreviewBlocks(anchor.evidence),
      ].join("\n");
    case "triple":
      return [
        `${anchor.id}`,
        anchor.label,
        "",
        "Evidence:",
        ...formatEvidencePreviewBlocks(anchor.evidence),
      ].join("\n");
  }
}

function truncateToBudget(text: string, budget: number): string {
  if (text.length <= budget) {
    return text;
  }

  return `${text.slice(0, Math.max(0, budget - 20))}\n[truncated]`;
}

async function writeJSONL(items: readonly unknown[]): Promise<void> {
  await writeTextToStdout(
    items.map((item) => formatCLIJSONLine(item)).join("") +
      (items.length === 0 ? "" : ""),
  );
}

function toWikiGraphUri(id: string): string {
  const [type, first, second] = id.split(":");

  switch (type) {
    case "chapter":
      return `wikigraph://chapter/${first ?? ""}`;
    case "fragment":
      return `wikigraph://chapter/${first ?? ""}/source/${second ?? "0"}`;
    case "meta":
      return "wikigraph://";
    case "node":
      return `wikigraph://chunk/${first ?? ""}`;
    case "summary":
      return `wikigraph://chapter/${first ?? ""}/summary/`;
    default:
      return id;
  }
}

function toArchiveFindType(
  kind: NonNullable<CLIArchiveArguments["kinds"]>[number],
): NonNullable<ArchiveFindOptions["types"]>[number] | undefined {
  switch (kind) {
    case "chapter":
      return "chapter";
    case "chunk":
      return "node";
    case "source":
      return "fragment";
    case "summary":
      return "summary";
    case "entity":
      return "entity";
    case "meta":
      return "meta";
    case "triple":
      return "triple";
  }
}

function toArchiveCollectionType(
  kind: NonNullable<CLIArchiveArguments["kinds"]>[number],
): NonNullable<ArchiveCollectionOptions["types"]>[number] | undefined {
  switch (kind) {
    case "chapter":
      return "chapter";
    case "chunk":
      return "node";
    case "entity":
      return "entity";
    case "meta":
      return "meta";
    case "source":
      return "fragment";
    case "summary":
      return "summary";
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
      return "reading-graph";
    case "summarized":
      return "reading-summary";
  }
}

function formatEstimateStage(stage: ArchiveEstimate["targetStage"]): string {
  switch (stage) {
    case "planned":
      return "planned";
    case "source":
    case "sourced":
      return "source";
    case "graphed":
      return "reading-graph";
    case "summarized":
      return "reading-summary";
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

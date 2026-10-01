import { readFile } from "fs/promises";

import {
  formatWikiGraphLibraryUri,
  type File,
  type ParsedWikiGraphLibraryUri,
  type WikiGraphLibraryArchiveRecord,
  type WikiGraphLibraryIndexState,
  type WikiGraphLibraryRecord,
  type WikiGraphLibraryScanResult,
} from "wiki-graph-sdk";
import type { CLILibraryArguments } from "../args/index.js";
import { getWikiGraphSDK } from "../runtime/context.js";
import type { RenderTreeNode } from "../support/index.js";
import {
  formatCLIJSON,
  renderTreeText,
  readTextStreamFromStdin,
  writeTextToStdout,
} from "../support/index.js";
import { createCollectionFindResult } from "./archive-command/run/index.js";
import { getNodeResourcePath } from "../runtime/node-platform.js";
import { writeFindHits } from "./archive-output/index.js";
import {
  ProgressOutputWriter,
  type ProgressCounter,
} from "../runtime/index.js";

const INDEX_PROGRESS_OUTPUT_INTERVAL_MS = 6_000;

export async function runLibraryCommand(
  args: CLILibraryArguments,
): Promise<void> {
  const libraries = getWikiGraphSDK().libraries;
  if (
    args.action !== "add" &&
    args.action !== "create" &&
    args.action !== "scan" &&
    args.action !== "rebind"
  ) {
    await libraries.assertCurrent(args.target);
  }

  switch (args.action) {
    case "add": {
      if (args.inputPath === undefined) {
        throw new Error("Missing --input <path> for library add.");
      }
      await writeLibraryArchive(
        await libraries.addArchive({
          inputPath: args.inputPath,
          target: args.target,
          ...(args.to === undefined ? {} : { to: args.to }),
        }),
        args.json ?? false,
      );
      return;
    }
    case "create": {
      if (args.path === undefined) {
        throw new Error("Missing --path <folder> for library create.");
      }
      await writeLibrary(
        (await libraries.create(args.path)).snapshot,
        args.json ?? false,
      );
      return;
    }
    case "list": {
      if (args.target.kind === "registry") {
        await writeLibraries(
          (await libraries.list()).map((library) => library.snapshot),
          args.json ?? false,
        );
        return;
      }
      if (args.target.kind === "archive-collection") {
        await writeLibraryArchives(
          await (
            await libraries.get(formatWikiGraphLibraryUri(args.target.publicId))
          ).archives(),
          args.json ?? false,
        );
        return;
      }
      await writeLibraryScopeCollection(args.target, args.json ?? false);
      return;
    }
    case "scan": {
      await writeScanResult(
        "scan",
        async () => await libraries.scan(args.target),
        args.json ?? false,
        args.jsonl ?? false,
      );
      return;
    }
    case "rebind": {
      const folderPath = args.path;
      if (folderPath === undefined) {
        throw new Error("Missing path value for library path set.");
      }
      await writeScanResult(
        "path set",
        async () => await libraries.rebind(args.target, folderPath),
        args.json ?? false,
        args.jsonl ?? false,
      );
      return;
    }
    case "archive-tree": {
      await writeLibraryArchiveTree(
        await (
          await libraries.get(formatWikiGraphLibraryUri(args.target.publicId))
        ).archives(),
        {
          ...(args.depth === undefined ? {} : { depth: args.depth }),
          json: args.json ?? false,
          ...(args.parent === undefined ? {} : { parent: args.parent }),
        },
      );
      return;
    }
    case "get-index": {
      await writeLibraryIndexState(
        await libraries.indexState(args.target),
        args.json ?? false,
      );
      return;
    }
    case "sync-index": {
      const writer = new ProgressOutputWriter({
        jsonl: args.jsonl ?? false,
        throttleMs: INDEX_PROGRESS_OUTPUT_INTERVAL_MS,
      });

      await writer.write({
        json: { type: "started" },
        kind: "lifecycle",
        text: "library index cache sync started\nsteps: collecting -> clearing -> indexing-text -> indexing-objects -> indexing-dense -> finalizing",
      });
      const state = await libraries.rebuildIndex(args.target, async (event) => {
        const counters =
          event.done === undefined || event.total === undefined
            ? []
            : [formatIndexCounter(event)];

        await writer.write({
          counters,
          json: {
            counters,
            phase: event.phase,
            type: "status_snapshot",
          },
          kind: "status",
          phase: event.phase,
        });
      });
      await writer.write({
        json: { status: state.status, type: "completed" },
        kind: "lifecycle",
        text: "library index cache synced",
      });
      await writer.write({
        json: { type: "succeeded" },
        kind: "lifecycle",
        text: "succeeded",
      });
      return;
    }
    case "clean-index": {
      await writeLibraryIndexState(
        await libraries.cleanIndex(args.target),
        args.json ?? false,
      );
      return;
    }
    case "remove": {
      if (args.target.kind === "archive") {
        await writeLibraryArchive(
          await libraries.removeArchive(args.target),
          args.json ?? false,
          "Removed library archive",
        );
        return;
      }
      const library = await libraries.remove(args.target);
      await writeTextToStdout(
        args.json === true
          ? formatCLIJSON({ removed: library.uri })
          : `Removed library registry: ${library.uri}\n`,
      );
      return;
    }
    case "get": {
      if (args.target.kind === "path") {
        await writeLibraryPath(
          (await libraries.get(formatWikiGraphLibraryUri(args.target.publicId)))
            .snapshot,
          args.json ?? false,
        );
        return;
      }
      if (args.target.kind === "archive-path") {
        await writeLibraryArchivePath(
          await libraries.getArchive({ ...args.target, kind: "archive" }),
          args.json ?? false,
        );
        return;
      }
      if (args.target.kind === "metadata") {
        await writeMetadataMap(
          await libraries.getMetadata(args.target),
          args.json ?? false,
        );
        return;
      }
      if (args.target.kind === "archive") {
        await writeLibraryArchivePage(
          await libraries.getArchive(args.target),
          args.json ?? false,
        );
        return;
      }
      if (args.target.kind === "archive-collection") {
        await writeLibraryArchives(
          await (
            await libraries.get(formatWikiGraphLibraryUri(args.target.publicId))
          ).archives(),
          args.json ?? false,
        );
        return;
      }
      await writeLibraryScopeCollection(args.target, args.json ?? false);
      return;
    }
    case "set": {
      if (args.target.kind === "archive-path") {
        if (args.to === undefined) {
          throw new Error("Missing path value for library archive path set.");
        }
        await writeLibraryArchive(
          await libraries.moveArchive({
            target: { ...args.target, kind: "archive" },
            to: args.to,
          }),
          args.json ?? false,
          "Moved library archive",
        );
        return;
      }
      const value = await readMetadataInput(args, { jsonRequired: true });
      await writeMetadataMap(
        await libraries.replaceMetadata(args.target, parseMetadataMap(value)),
        args.json ?? false,
      );
      return;
    }
    case "put": {
      await writeMetadataMap(
        await libraries.putMetadata(
          args.target,
          normalizeMetadataKey(args.key),
          await readMetadataInput(args, { jsonRequired: false }),
        ),
        args.json ?? false,
      );
      return;
    }
    case "delete": {
      await writeMetadataMap(
        await libraries.deleteMetadata(
          args.target,
          normalizeMetadataKey(args.key),
        ),
        args.json ?? false,
      );
      return;
    }
    case "clear": {
      await writeMetadataMap(
        await libraries.clearMetadata(args.target),
        args.json ?? false,
      );
      return;
    }
  }
}

async function writeLibrary(
  library: WikiGraphLibraryRecord,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON({
        uri: library.uri,
        id: library.publicId,
        folderPath: getNodeResourcePath(library.folder),
        isDefault: library.isDefault,
        stagingPath: getNodeResourcePath(library.staging),
        createdAt: library.createdAt,
        updatedAt: library.updatedAt,
      }),
    );
    return;
  }
  await writeTextToStdout(`${library.uri}\n`);
}

async function writeLibraries(
  libraries: readonly WikiGraphLibraryRecord[],
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON({
        items: libraries.map((library) => ({
          uri: library.uri,
          id: library.publicId,
          path: getNodeResourcePath(library.folder),
          isDefault: library.isDefault,
        })),
      }),
    );
    return;
  }
  await writeTextToStdout(
    libraries
      .map((library) =>
        [
          library.uri,
          library.publicId,
          getNodeResourcePath(library.folder),
          library.isDefault ? "default" : "",
        ].join("\t"),
      )
      .join("\n") + (libraries.length === 0 ? "" : "\n"),
  );
}

async function writeLibraryPath(
  library: WikiGraphLibraryRecord,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON({
        uri: `${library.uri}/path`,
        path: getNodeResourcePath(library.folder),
      }),
    );
    return;
  }
  await writeTextToStdout(`${getNodeResourcePath(library.folder)}\n`);
}

async function writeLibraryArchivePath(
  archive: WikiGraphLibraryArchiveRecord,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON({ uri: `${archive.uri}/path`, path: archive.relativePath }),
    );
    return;
  }
  await writeTextToStdout(`${archive.relativePath}\n`);
}

async function writeScanResult(
  label: string,
  operation: () => Promise<WikiGraphLibraryScanResult>,
  json: boolean,
  jsonl: boolean,
): Promise<void> {
  if (jsonl) {
    const writer = new ProgressOutputWriter({ jsonl: true, throttleMs: 0 });
    await writer.write({
      json: { type: "started", action: label },
      kind: "lifecycle",
      text: `${label} started`,
    });
    const result = await operation();
    for (const archive of result.archives) {
      await writer.write({
        json: {
          type: "archive",
          action: label,
          archive: formatLibraryArchiveJSON(archive),
        },
        kind: "status",
        phase: label,
      });
    }
    await writer.write({
      json: {
        type: "completed",
        action: label,
        archives: result.archives.length,
      },
      kind: "lifecycle",
      text: `${label} completed`,
    });
    await writer.write({
      json: { type: "succeeded", action: label },
      kind: "lifecycle",
      text: "succeeded",
    });
    return;
  }

  const result = await operation();
  await writeLibraryArchives(result.archives, json);
}

async function writeLibraryArchives(
  archives: readonly WikiGraphLibraryArchiveRecord[],
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON({ items: archives.map(formatLibraryArchiveJSON) }),
    );
    return;
  }
  await writeTextToStdout(
    archives
      .map((archive) =>
        [archive.uri, archive.relativePath, archive.status].join("\t"),
      )
      .join("\n") + (archives.length === 0 ? "" : "\n"),
  );
}

async function writeLibraryScopeCollection(
  target: ParsedWikiGraphLibraryUri,
  json: boolean,
): Promise<void> {
  const manager = getWikiGraphSDK().libraries;
  const library = await manager.get(formatWikiGraphLibraryUri(target.publicId));
  const baseUri = formatWikiGraphLibraryUri(target.publicId);
  const context = {
    archiveKey: baseUri,
    archivePath: baseUri,
    continuationKind: "collection" as const,
    format: json ? ("json" as const) : ("text" as const),
    indexScope: {
      kind: "library-index" as const,
      libraryId: library.snapshot.id,
    },
    limit: 20,
    libraryQuery: "objects" as const,
    types: null,
  };

  await writeFindHits(
    createCollectionFindResult(await manager.objects(target)),
    context,
    json ? "json" : "text",
  );
}

async function writeLibraryArchive(
  archive: WikiGraphLibraryArchiveRecord,
  json: boolean,
  label = "Added library archive",
): Promise<void> {
  if (json) {
    await writeTextToStdout(formatCLIJSON(formatLibraryArchiveJSON(archive)));
    return;
  }
  await writeTextToStdout(
    `${label}: ${archive.uri}\n${archive.relativePath}\n`,
  );
}

async function writeLibraryArchivePage(
  archive: WikiGraphLibraryArchiveRecord,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON(formatLibraryArchivePageJSON(archive)),
    );
    return;
  }

  await writeTextToStdout(
    [
      `Library archive: ${archive.uri}`,
      `Label: ${archive.relativePath}`,
      `Status: ${archive.status}${archive.exists ? "" : " (missing file)"}`,
      `Chapter: ${archive.uri}/chapter`,
      `Entity: ${archive.uri}/entity`,
      `Triple: ${archive.uri}/triple`,
      `Inspect: ${archive.uri} inspect`,
      `Metadata path: ${formatArchiveHostPath(archive)}`,
      "",
    ].join("\n"),
  );
}

function formatLibraryArchiveJSON(
  archive: WikiGraphLibraryArchiveRecord,
): object {
  return {
    uri: archive.uri,
    id: archive.publicId,
    libraryUri: archive.libraryUri,
    relativePath: archive.relativePath,
    path: formatArchiveHostPath(archive),
    exists: archive.exists,
    status: archive.status,
    lastSeenMutationToken: archive.lastSeenMutationToken,
    lastSeenSize: archive.lastSeenSize,
    lastSeenMtimeMs: archive.lastSeenMtimeMs,
    lastScannedAt: archive.lastScannedAt,
    createdAt: archive.createdAt,
    updatedAt: archive.updatedAt,
  };
}

function formatLibraryArchivePageJSON(
  archive: WikiGraphLibraryArchiveRecord,
): object {
  return {
    uri: archive.uri,
    id: archive.publicId,
    libraryUri: archive.libraryUri,
    label: archive.relativePath,
    relativePath: archive.relativePath,
    status: archive.status,
    entries: {
      chapter: `${archive.uri}/chapter`,
      entity: `${archive.uri}/entity`,
      triple: `${archive.uri}/triple`,
      inspect: `${archive.uri} inspect`,
    },
    metadata: {
      path: formatArchiveHostPath(archive),
      exists: archive.exists,
      lastSeenMutationToken: archive.lastSeenMutationToken,
      lastSeenSize: archive.lastSeenSize,
      lastSeenMtimeMs: archive.lastSeenMtimeMs,
      lastScannedAt: archive.lastScannedAt,
      createdAt: archive.createdAt,
      updatedAt: archive.updatedAt,
    },
  };
}

interface ArchiveTreeNode {
  readonly children: Map<string, ArchiveTreeNode>;
  readonly name: string;
  readonly path: string;
  archive?: WikiGraphLibraryArchiveRecord;
}

async function writeLibraryArchiveTree(
  archives: readonly WikiGraphLibraryArchiveRecord[],
  options: {
    readonly depth?: number;
    readonly json: boolean;
    readonly parent?: string;
  },
): Promise<void> {
  const parent = options.parent
    ?.replace(/\\/gu, "/")
    .replace(/^\/+|\/+$/gu, "");
  const root: ArchiveTreeNode = { children: new Map(), name: "", path: "" };
  for (const archive of archives) {
    if (
      parent !== undefined &&
      !isArchiveTreePathSelected(archive.relativePath, parent)
    ) {
      continue;
    }
    insertArchiveTreeNode(root, archive);
  }
  pruneArchiveTreeDepth(root, options.depth, 0);

  if (options.json) {
    await writeTextToStdout(
      formatCLIJSON({ items: serializeArchiveTreeNodes(root.children) }),
    );
    return;
  }
  await writeTextToStdout(formatArchiveTreeText(root.children));
}

function isArchiveTreePathSelected(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent.replace(/\/$/u, "")}/`);
}

function insertArchiveTreeNode(
  root: ArchiveTreeNode,
  archive: WikiGraphLibraryArchiveRecord,
): void {
  let current = root;
  const parts = archive.relativePath.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    const name = parts[index]!;
    const path = parts.slice(0, index + 1).join("/");
    let child = current.children.get(name);
    if (child === undefined) {
      child = { children: new Map(), name, path };
      current.children.set(name, child);
    }
    current = child;
  }
  current.archive = archive;
}

function pruneArchiveTreeDepth(
  node: ArchiveTreeNode,
  depth: number | undefined,
  level: number,
): void {
  if (depth === undefined) {
    for (const child of node.children.values()) {
      pruneArchiveTreeDepth(child, depth, level + 1);
    }
    return;
  }
  if (level >= depth) {
    node.children.clear();
    return;
  }
  for (const child of node.children.values()) {
    pruneArchiveTreeDepth(child, depth, level + 1);
  }
}

function serializeArchiveTreeNodes(
  nodes: Map<string, ArchiveTreeNode>,
): object[] {
  return [...nodes.values()].map((node) => ({
    children: serializeArchiveTreeNodes(node.children),
    name: node.name,
    path: node.path,
    ...(node.archive === undefined ? {} : { uri: node.archive.uri }),
  }));
}

function formatArchiveTreeText(nodes: Map<string, ArchiveTreeNode>): string {
  return renderTreeText([...nodes.values()].map(formatArchiveTreeRenderNode));
}

function formatArchiveTreeRenderNode(node: ArchiveTreeNode): RenderTreeNode {
  return {
    children: [...node.children.values()].map(formatArchiveTreeRenderNode),
    label:
      node.archive === undefined
        ? node.name
        : `${node.name} (${node.archive.uri})`,
  };
}

async function writeLibraryIndexState(
  state: WikiGraphLibraryIndexState,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(formatCLIJSON(state));
    return;
  }

  await writeTextToStdout(
    [
      `Status: ${state.status}`,
      ...(state.capabilities === undefined
        ? []
        : [
            `Enabled indexes: ${state.capabilities.indexes}`,
            `Dense current: ${state.capabilities.dense.current ? "yes" : "no"}`,
            ...(state.capabilities.dense.model === undefined
              ? []
              : [`Dense model: ${state.capabilities.dense.model}`]),
            ...(state.capabilities.dense.dimensions === undefined
              ? []
              : [`Dense dimensions: ${state.capabilities.dense.dimensions}`]),
          ]),
      `Source fingerprint: ${state.sourceFingerprint}`,
      ...(state.fingerprint === undefined
        ? []
        : [`Index fingerprint: ${state.fingerprint}`]),
      `Sources: ${state.sources.length}`,
      "",
    ].join("\n"),
  );
}

function formatIndexCounter(input: {
  readonly done?: number;
  readonly total?: number;
  readonly unit?: "chapter" | "object" | "sentence" | "vector";
}): ProgressCounter {
  const unit =
    input.unit === "chapter"
      ? "chapters"
      : input.unit === "sentence"
        ? "sentences"
        : input.unit === "vector"
          ? "vectors"
          : "objects";

  return {
    done: input.done ?? 0,
    name: unit,
    total: input.total ?? 0,
    unit,
  };
}

async function readMetadataInput(
  args: CLILibraryArguments,
  options: { readonly jsonRequired: boolean },
): Promise<unknown> {
  const raw = await readRawInput(args);
  if (options.jsonRequired || args.jsonInputValue !== undefined) {
    return parseJSONInput(raw);
  }
  return raw;
}

async function readRawInput(args: CLILibraryArguments): Promise<string> {
  const sources = [
    args.inputValue === undefined ? undefined : "positional value",
    args.inputPath === undefined ? undefined : "--input",
    args.jsonInputValue === undefined ? undefined : "--json value",
  ].filter((source): source is string => source !== undefined);

  if (sources.length > 1) {
    throw new Error(`Choose only one input source: ${sources.join(", ")}.`);
  }
  if (args.jsonInputValue !== undefined) {
    return args.jsonInputValue;
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
    "Missing input. Pass a value, use --input <path>, or use --input - for stdin.",
  );
}

function parseMetadataMap(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Metadata set requires a JSON object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function parseJSONInput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeMetadataKey(key: string | undefined): string {
  const normalized = key?.trim() ?? "";
  if (normalized === "") {
    throw new Error("Metadata key cannot be empty.");
  }
  return normalized;
}

function writeMetadataMap(
  map: Readonly<Record<string, unknown>>,
  json: boolean,
): Promise<void> {
  if (json) {
    return writeTextToStdout(formatCLIJSON(map));
  }
  const lines = Object.entries(map).map(
    ([key, value]) => `${key}: ${formatMetadataTextValue(value)}`,
  );
  return writeTextToStdout(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
}

function formatMetadataTextValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(" ");
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatArchiveHostPath(archive: {
  readonly file?: File;
  readonly relativePath: string;
}): string {
  return archive.file === undefined
    ? archive.relativePath
    : getNodeResourcePath(archive.file);
}

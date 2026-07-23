import { readFile } from "fs/promises";

import {
  addWikiGraphLibraryArchive,
  clearWikiGraphLibraryMetadata,
  createWikiGraphLibrary,
  deleteWikiGraphLibraryMetadataKey,
  getWikiGraphLibraryMetadata,
  getWikiGraphLibraryArchive,
  listWikiGraphLibraryArchives,
  moveWikiGraphLibraryArchive,
  disableWikiGraphLibraryIndex,
  putWikiGraphLibraryMetadata,
  readWikiGraphLibraryIndexState,
  rebuildWikiGraphLibraryIndex,
  rebindWikiGraphLibrary,
  removeWikiGraphLibrary,
  removeWikiGraphLibraryArchive,
  replaceWikiGraphLibraryMetadata,
  resolveWikiGraphLibrary,
  scanWikiGraphLibrary,
} from "wiki-graph-core";
import type { CLILibraryArguments } from "../args/index.js";
import {
  formatCLIJSON,
  readTextStreamFromStdin,
  writeTextToStdout,
} from "../support/index.js";
import {
  ProgressOutputWriter,
  type ProgressCounter,
} from "../runtime/index.js";

const INDEX_PROGRESS_OUTPUT_INTERVAL_MS = 6_000;

export async function runLibraryCommand(
  args: CLILibraryArguments,
): Promise<void> {
  switch (args.action) {
    case "add": {
      if (args.inputPath === undefined) {
        throw new Error("Missing --input <path> for library add.");
      }
      await writeLibraryArchive(
        await addWikiGraphLibraryArchive({
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
      const library = await createWikiGraphLibrary({ folderPath: args.path });
      await writeLibrary(library, args.json ?? false);
      return;
    }
    case "list": {
      await writeLibraryArchives(
        await listWikiGraphLibraryArchives(args.target),
        args.json ?? false,
      );
      return;
    }
    case "scan": {
      const result = await scanWikiGraphLibrary(args.target);
      await writeLibraryArchives(result.archives, args.json ?? false);
      return;
    }
    case "rebind": {
      if (args.path === undefined) {
        throw new Error("Missing --path <directory> for library rebind.");
      }
      const result = await rebindWikiGraphLibrary({
        folderPath: args.path,
        target: args.target,
      });
      await writeLibraryArchives(result.archives, args.json ?? false);
      return;
    }
    case "get-index": {
      await writeLibraryIndexState(
        await readWikiGraphLibraryIndexState(args.target),
        args.json ?? false,
      );
      return;
    }
    case "enable-index": {
      const writer = new ProgressOutputWriter({
        jsonl: args.jsonl ?? false,
        throttleMs: INDEX_PROGRESS_OUTPUT_INTERVAL_MS,
      });

      await writer.write({
        json: { type: "started" },
        kind: "lifecycle",
        text: "library index enable started\nsteps: collecting -> clearing -> indexing-text -> indexing-objects -> finalizing",
      });
      const state = await rebuildWikiGraphLibraryIndex(
        args.target,
        async (event) => {
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
        },
      );
      await writer.write({
        json: { status: state.status, type: "completed" },
        kind: "lifecycle",
        text: "library index enabled",
      });
      await writer.write({
        json: { type: "succeeded" },
        kind: "lifecycle",
        text: "succeeded",
      });
      return;
    }
    case "disable-index": {
      await writeLibraryIndexState(
        await disableWikiGraphLibraryIndex(args.target),
        args.json ?? false,
      );
      return;
    }
    case "remove": {
      if (args.target.kind === "archive") {
        await writeLibraryArchive(
          await removeWikiGraphLibraryArchive({ target: args.target }),
          args.json ?? false,
          "Removed library archive",
        );
        return;
      }
      const library = await removeWikiGraphLibrary(args.target);
      await writeTextToStdout(
        args.json === true
          ? formatCLIJSON({ removed: library.uri })
          : `Removed library registry: ${library.uri}\n`,
      );
      return;
    }
    case "move": {
      if (args.to === undefined) {
        throw new Error(
          "Missing --to <relative-wikg-path> for library archive move.",
        );
      }
      await writeLibraryArchive(
        await moveWikiGraphLibraryArchive({ target: args.target, to: args.to }),
        args.json ?? false,
        "Moved library archive",
      );
      return;
    }
    case "get": {
      if (args.target.kind === "metadata") {
        await writeMetadataMap(
          await getWikiGraphLibraryMetadata(args.target),
          args.json ?? false,
        );
        return;
      }
      if (args.target.kind === "archive") {
        await writeLibraryArchive(
          await getWikiGraphLibraryArchive(args.target),
          args.json ?? false,
          "Library archive",
        );
        return;
      }
      await resolveWikiGraphLibrary(args.target);
      await writeLibraryArchives(
        await listWikiGraphLibraryArchives(args.target),
        args.json ?? false,
      );
      return;
    }
    case "set": {
      const value = await readMetadataInput(args, { jsonRequired: true });
      await writeMetadataMap(
        await replaceWikiGraphLibraryMetadata(
          args.target,
          parseMetadataMap(value),
        ),
        args.json ?? false,
      );
      return;
    }
    case "put": {
      await writeMetadataMap(
        await putWikiGraphLibraryMetadata(
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
        await deleteWikiGraphLibraryMetadataKey(
          args.target,
          normalizeMetadataKey(args.key),
        ),
        args.json ?? false,
      );
      return;
    }
    case "clear": {
      await writeMetadataMap(
        await clearWikiGraphLibraryMetadata(args.target),
        args.json ?? false,
      );
      return;
    }
  }
}

async function writeLibrary(
  library: Awaited<ReturnType<typeof createWikiGraphLibrary>>,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(
      formatCLIJSON({
        uri: library.uri,
        id: library.publicId,
        folderPath: library.folderPath,
        isDefault: library.isDefault,
        stagingPath: library.stagingPath,
        createdAt: library.createdAt,
        updatedAt: library.updatedAt,
      }),
    );
    return;
  }
  await writeTextToStdout(`${library.uri}\n`);
}

async function writeLibraryArchives(
  archives: Awaited<ReturnType<typeof listWikiGraphLibraryArchives>>,
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

async function writeLibraryArchive(
  archive: Awaited<ReturnType<typeof addWikiGraphLibraryArchive>>,
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

function formatLibraryArchiveJSON(
  archive: Awaited<ReturnType<typeof addWikiGraphLibraryArchive>>,
): object {
  return {
    uri: archive.uri,
    id: archive.publicId,
    libraryUri: archive.libraryUri,
    relativePath: archive.relativePath,
    path: archive.path,
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

async function writeLibraryIndexState(
  state: Awaited<ReturnType<typeof readWikiGraphLibraryIndexState>>,
  json: boolean,
): Promise<void> {
  if (json) {
    await writeTextToStdout(formatCLIJSON(state));
    return;
  }

  await writeTextToStdout(
    [
      `Status: ${state.status}`,
      `Enabled: ${state.enabled ? "yes" : "no"}`,
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
  readonly unit?: "chapter" | "object" | "sentence";
}): ProgressCounter {
  const unit =
    input.unit === "chapter"
      ? "chapters"
      : input.unit === "sentence"
        ? "sentences"
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

import {
  deleteArchiveSearchSessions,
  isArchiveSearchIndexCurrent,
  listArchiveQueryableChapterIds,
  readSearchIndexCapabilityStatus,
  rebuildArchiveSearchIndex,
  WikiGraphArchiveFile,
} from "wiki-graph-sdk";

import type { CLIArchiveIndexArguments } from "../../args/index.js";
import { writeTextToStdout } from "../../support/index.js";
import { formatCLIJSON } from "../../support/index.js";
import {
  ProgressOutputWriter,
  type ProgressCounter,
} from "../../runtime/index.js";
import { resolveArchiveRuntimeLocation } from "./run/uri.js";

const INDEX_PROGRESS_OUTPUT_INTERVAL_MS = 6_000;

export async function runArchiveIndexCommand(
  args: CLIArchiveIndexArguments,
): Promise<void> {
  switch (args.action) {
    case "get":
      await readIndexCache(args);
      return;
    case "sync":
      await syncIndexCache(args);
      return;
    case "clean":
      await cleanIndexCache(args);
      return;
  }
}

async function readIndexCache(args: CLIArchiveIndexArguments): Promise<void> {
  const location = await resolveArchiveRuntimeLocation(args.archivePath);

  await new WikiGraphArchiveFile(location.archiveFile).readDocument(
    async (document) => {
      await writeIndexOutput(args, {
        capabilities: await readSearchIndexCapabilityStatus(document),
        current: await isArchiveSearchIndexCurrent(document),
      });
    },
  );
}

async function syncIndexCache(args: CLIArchiveIndexArguments): Promise<void> {
  const location = await resolveArchiveRuntimeLocation(args.archivePath);
  const writer = new ProgressOutputWriter({
    jsonl: args.jsonl ?? false,
    throttleMs: INDEX_PROGRESS_OUTPUT_INTERVAL_MS,
  });

  await new WikiGraphArchiveFile(location.archiveFile).write(
    async (document) => {
      await writer.write({
        json: { type: "started" },
        kind: "lifecycle",
        text: "index cache sync started\nsteps: checking -> collecting -> clearing -> indexing-text -> indexing-dense -> finalizing",
      });
      await writer.write({
        json: { phase: "checking", type: "status_snapshot" },
        kind: "status",
        phase: "checking",
      });
      const options =
        args.skipUnindexed === true
          ? { chapters: await listArchiveQueryableChapterIds(document) }
          : {};

      if (options.chapters?.length === 0) {
        throw new Error(
          "Wiki Graph index cache is not ready. No chapters have a current FTS artifact or source embedding artifact.",
        );
      }

      if (await isArchiveSearchIndexCurrent(document, options)) {
        await writer.write({
          json: { type: "already-current" },
          kind: "lifecycle",
          text: "already current",
        });
      } else {
        await rebuildArchiveSearchIndex(
          document,
          async (event) => {
            await writer.write({
              counters:
                event.done === undefined || event.total === undefined
                  ? []
                  : [formatIndexCounter(event)],
              json: {
                counters:
                  event.done === undefined || event.total === undefined
                    ? []
                    : [formatIndexCounter(event)],
                phase: event.phase,
                type: "status_snapshot",
              },
              kind: "status",
              phase: event.phase,
            });
          },
          options,
        );
      }

      await writer.write({
        json: { type: "completed" },
        kind: "lifecycle",
        text: "index cache synced",
      });
      await writer.write({
        json: { type: "succeeded" },
        kind: "lifecycle",
        text: "succeeded",
      });
    },
    { searchIndexWritebackPolicy: "cache" },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function cleanIndexCache(args: CLIArchiveIndexArguments): Promise<void> {
  const location = await resolveArchiveRuntimeLocation(args.archivePath);

  await new WikiGraphArchiveFile(location.archiveFile).write(
    async (document) => {
      await document.deleteSearchIndexDatabase();
      await writeIndexOutput(args, {
        capabilities: { dense: { current: false }, indexes: "missing" },
        current: false,
      });
    },
    { searchIndexWritebackPolicy: "cache" },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

function formatIndexCounter(input: {
  readonly done?: number;
  readonly total?: number;
  readonly unit?: "chapter" | "object" | "sentence" | "vector";
}): ProgressCounter {
  return {
    done: input.done ?? 0,
    name: formatIndexCounterName(input.unit),
    total: input.total ?? 0,
    unit: formatIndexUnit(input.unit),
  };
}

function formatIndexCounterName(
  unit: "chapter" | "object" | "sentence" | "vector" | undefined,
): string {
  switch (unit) {
    case "chapter":
      return "chapters";
    case "object":
      return "objects";
    case "sentence":
      return "sentences";
    case "vector":
      return "vectors";
    case undefined:
      return "items";
  }
}

function formatIndexUnit(
  unit: "chapter" | "object" | "sentence" | "vector" | undefined,
): string {
  switch (unit) {
    case "chapter":
      return "chapters";
    case "object":
      return "objects";
    case "sentence":
      return "sentences";
    case "vector":
      return "vectors";
    case undefined:
      return "items";
  }
}

async function writeIndexOutput(
  args: CLIArchiveIndexArguments,
  payload: {
    readonly capabilities: Awaited<
      ReturnType<typeof readSearchIndexCapabilityStatus>
    >;
    readonly current: boolean;
  },
): Promise<void> {
  if (args.json === true) {
    await writeTextToStdout(formatCLIJSON(payload));
    return;
  }

  await writeTextToStdout(
    [
      `Status: ${formatArchiveIndexStatus(payload)}`,
      `Enabled indexes: ${payload.capabilities.indexes}`,
      `Dense current: ${payload.capabilities.dense.current ? "yes" : "no"}`,
      ...(payload.capabilities.dense.model === undefined
        ? []
        : [`Dense model: ${payload.capabilities.dense.model}`]),
      ...(payload.capabilities.dense.dimensions === undefined
        ? []
        : [`Dense dimensions: ${payload.capabilities.dense.dimensions}`]),
      "",
    ].join("\n"),
  );
}

function formatArchiveIndexStatus(input: {
  readonly capabilities: Awaited<
    ReturnType<typeof readSearchIndexCapabilityStatus>
  >;
  readonly current: boolean;
}): "current" | "missing" | "outdated" {
  if (input.current) {
    return "current";
  }
  if (input.capabilities.indexes === "missing") {
    return "missing";
  }
  return "outdated";
}

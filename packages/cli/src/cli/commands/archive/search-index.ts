import {
  deleteArchiveSearchSessions,
  isArchiveSearchIndexCurrent,
  rebuildArchiveSearchIndex,
} from "wiki-graph-core";
import { readArchiveIndexSettings, setFtsIndexEmbedded } from "wiki-graph-core";
import { WikiGraphArchiveFile } from "wiki-graph-core";

import type { CLIArchiveIndexArguments } from "../../args.js";
import { writeTextToStdout } from "../../support/index.js";
import { formatCLIJSON } from "../../support/index.js";
import {
  ProgressOutputWriter,
  type ProgressCounter,
} from "../../runtime/index.js";

const INDEX_PROGRESS_OUTPUT_INTERVAL_MS = 6_000;

export async function runArchiveIndexCommand(
  args: CLIArchiveIndexArguments,
): Promise<void> {
  switch (args.action) {
    case "get":
      await readIndexSettings(args);
      return;
    case "enable":
      await enableIndex(args);
      return;
    case "embed":
      await embedIndex(args);
      return;
    case "external":
      await externalizeIndex(args);
      return;
    case "disable":
      await disableIndex(args);
      return;
  }
}

async function readIndexSettings(
  args: CLIArchiveIndexArguments,
): Promise<void> {
  await new WikiGraphArchiveFile(args.archivePath).readDocument(
    async (document) => {
      const settings = await readArchiveIndexSettings(document);

      await writeIndexOutput(args, {
        ftsEmbedded: settings.ftsEmbedded,
        ftsCurrent: await isArchiveSearchIndexCurrent(document),
      });
    },
  );
}

async function enableIndex(args: CLIArchiveIndexArguments): Promise<void> {
  const writer = new ProgressOutputWriter({
    jsonl: args.jsonl ?? false,
    throttleMs: INDEX_PROGRESS_OUTPUT_INTERVAL_MS,
  });

  await new WikiGraphArchiveFile(args.archivePath).write(
    async (document) => {
      await writer.write({
        json: { type: "started" },
        kind: "lifecycle",
        text: "index enable started\nsteps: checking -> collecting -> clearing -> indexing-text -> indexing-objects -> finalizing",
      });
      await writer.write({
        json: { phase: "checking", type: "status_snapshot" },
        kind: "status",
        phase: "checking",
      });

      if (await isArchiveSearchIndexCurrent(document)) {
        await writer.write({
          json: { type: "already-current" },
          kind: "lifecycle",
          text: "already current",
        });
      } else {
        await rebuildArchiveSearchIndex(document, async (event) => {
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
        });
      }

      await writer.write({
        json: { type: "completed" },
        kind: "lifecycle",
        text: "index enabled",
      });
      await writer.write({
        json: { type: "succeeded" },
        kind: "lifecycle",
        text: "succeeded",
      });
    },
    {
      searchIndexWritebackPolicy: await readSearchIndexWritebackPolicy(
        args.archivePath,
      ),
    },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function embedIndex(args: CLIArchiveIndexArguments): Promise<void> {
  let built = false;

  await new WikiGraphArchiveFile(args.archivePath).write(
    async (document) => {
      await setFtsIndexEmbedded(document, true);
      if (await isArchiveSearchIndexCurrent(document)) {
        await document.writeSearchIndexDatabase(async (database) => {
          await database.run(
            "UPDATE search_index_state SET value = value WHERE key = 'version'",
          );
        });
      } else {
        await rebuildArchiveSearchIndex(document);
        built = true;
      }
      await writeIndexOutput(args, {
        built,
        ftsEmbedded: true,
        ftsCurrent: await isArchiveSearchIndexCurrent(document),
      });
    },
    { searchIndexWritebackPolicy: "archive" },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function externalizeIndex(args: CLIArchiveIndexArguments): Promise<void> {
  await new WikiGraphArchiveFile(args.archivePath).write(
    async (document) => {
      await setFtsIndexEmbedded(document, false);
      await document.deleteSearchIndexDatabase();
      await writeIndexOutput(args, {
        ftsEmbedded: false,
        ftsCurrent: false,
      });
    },
    { searchIndexWritebackPolicy: "archive" },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function disableIndex(args: CLIArchiveIndexArguments): Promise<void> {
  await new WikiGraphArchiveFile(args.archivePath).write(
    async (document) => {
      await document.deleteSearchIndexDatabase();
      const settings = await readArchiveIndexSettings(document);

      await writeIndexOutput(args, {
        ftsEmbedded: settings.ftsEmbedded,
        ftsCurrent: false,
      });
    },
    {
      searchIndexWritebackPolicy: await readSearchIndexWritebackPolicy(
        args.archivePath,
      ),
    },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function readSearchIndexWritebackPolicy(
  archivePath: string,
): Promise<"archive" | "cache"> {
  let embedded = false;

  await new WikiGraphArchiveFile(archivePath).readDocument(async (document) => {
    embedded = (await readArchiveIndexSettings(document)).ftsEmbedded;
  });

  return embedded ? "archive" : "cache";
}

function formatIndexCounter(input: {
  readonly done?: number;
  readonly total?: number;
  readonly unit?: "chapter" | "object" | "sentence";
}): ProgressCounter {
  return {
    done: input.done ?? 0,
    name: formatIndexCounterName(input.unit),
    total: input.total ?? 0,
    unit: formatIndexUnit(input.unit),
  };
}

function formatIndexCounterName(
  unit: "chapter" | "object" | "sentence" | undefined,
): string {
  switch (unit) {
    case "chapter":
      return "chapters";
    case "object":
      return "objects";
    case "sentence":
      return "sentences";
    case undefined:
      return "items";
  }
}

function formatIndexUnit(
  unit: "chapter" | "object" | "sentence" | undefined,
): string {
  switch (unit) {
    case "chapter":
      return "chapters";
    case "object":
      return "objects";
    case "sentence":
      return "sentences";
    case undefined:
      return "items";
  }
}

async function writeIndexOutput(
  args: CLIArchiveIndexArguments,
  payload: {
    readonly built?: boolean;
    readonly ftsCurrent: boolean;
    readonly ftsEmbedded: boolean;
  },
): Promise<void> {
  if (args.json === true) {
    await writeTextToStdout(formatCLIJSON(payload));
    return;
  }

  await writeTextToStdout(
    [
      `FTS embedded: ${payload.ftsEmbedded ? "yes" : "no"}`,
      `FTS current: ${payload.ftsCurrent ? "yes" : "no"}`,
      ...(payload.built === undefined
        ? []
        : [`Built: ${payload.built ? "yes" : "no"}`]),
      "",
    ].join("\n"),
  );
}

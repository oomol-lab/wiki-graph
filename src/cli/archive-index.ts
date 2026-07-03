import {
  deleteArchiveSearchSessions,
  rebuildArchiveSearchIndex,
} from "../archive/query/index.js";
import {
  isSearchIndexCurrent,
  readArchiveIndexSettings,
  setFtsIndexEmbedded,
} from "../archive/search-index/index.js";
import { SpineDigestFile } from "../wikg/index.js";

import type { CLIArchiveIndexArguments } from "./args.js";
import { writeTextToStdout } from "./io.js";
import { formatCLIJSON } from "./json.js";

export async function runArchiveIndexCommand(
  args: CLIArchiveIndexArguments,
): Promise<void> {
  switch (args.action) {
    case "get":
      await readIndexSettings(args);
      return;
    case "build":
      await buildIndex(args);
      return;
    case "embed":
      await embedIndex(args);
      return;
    case "external":
      await externalizeIndex(args);
      return;
    case "clear":
      await clearIndex(args);
      return;
  }
}

async function readIndexSettings(
  args: CLIArchiveIndexArguments,
): Promise<void> {
  await new SpineDigestFile(args.archivePath).readDocument(async (document) => {
    const settings = await readArchiveIndexSettings(document);

    await writeIndexOutput(args, {
      ftsEmbedded: settings.ftsEmbedded,
      ftsCurrent: await isSearchIndexCurrent(document),
    });
  });
}

async function buildIndex(args: CLIArchiveIndexArguments): Promise<void> {
  let built = false;

  await new SpineDigestFile(args.archivePath).write(
    async (document) => {
      const settings = await readArchiveIndexSettings(document);

      if (!(await isSearchIndexCurrent(document))) {
        await rebuildArchiveSearchIndex(document);
        built = true;
      }
      await writeIndexOutput(args, {
        built,
        ftsEmbedded: settings.ftsEmbedded,
        ftsCurrent: await isSearchIndexCurrent(document),
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

  await new SpineDigestFile(args.archivePath).write(
    async (document) => {
      await setFtsIndexEmbedded(document, true);
      if (await isSearchIndexCurrent(document)) {
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
        ftsCurrent: await isSearchIndexCurrent(document),
      });
    },
    { searchIndexWritebackPolicy: "archive" },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function externalizeIndex(args: CLIArchiveIndexArguments): Promise<void> {
  await new SpineDigestFile(args.archivePath).write(
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

async function clearIndex(args: CLIArchiveIndexArguments): Promise<void> {
  await new SpineDigestFile(args.archivePath).write(async (document) => {
    await document.deleteSearchIndexDatabase();
    const settings = await readArchiveIndexSettings(document);

    await writeIndexOutput(args, {
      ftsEmbedded: settings.ftsEmbedded,
      ftsCurrent: false,
    });
  });
  await deleteArchiveSearchSessions(args.archivePath);
}

async function readSearchIndexWritebackPolicy(
  archivePath: string,
): Promise<"archive" | "cache"> {
  let embedded = false;

  await new SpineDigestFile(archivePath).readDocument(async (document) => {
    embedded = (await readArchiveIndexSettings(document)).ftsEmbedded;
  });

  return embedded ? "archive" : "cache";
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

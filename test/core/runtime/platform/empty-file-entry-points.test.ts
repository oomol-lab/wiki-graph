import { describe, expect, it } from "vitest";

import { NodeDirectory } from "../../../../packages/cli/src/runtime/node-platform.js";
import type { NodeFile } from "../../../../packages/cli/src/runtime/node-platform.js";
import { Database } from "../../../../packages/core/src/document/database.js";
import { openSearchIndexDatabase } from "../../../../packages/core/src/document/directory/search-index.js";
import { DirectoryFileStore } from "../../../../packages/core/src/document/directory/directory-file-store.js";
import {
  ensureWikiGraphHomeSchemaCurrent,
  readWikiGraphHomeSchemaVersion,
} from "../../../../packages/core/src/document/home-schema-upgrade.js";
import type {
  Directory,
  File,
} from "../../../../packages/core/src/runtime/platform/index.js";
import { withWikiGraphStorage } from "../../../../packages/core/src/runtime/platform/index.js";
import { assertArchiveUpgradeCoordinatorSafe } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/maintenance.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("empty host file entry points", () => {
  it("opens an empty document database through FileReader size", async () => {
    await withTempDir("wikigraph-empty-document-db-", async (path) => {
      const backing = (await new NodeDirectory(path).createFile(
        "database.db",
      )) as NodeFile;
      const probe = createEmptyFileProbe(backing);

      const database = await Database.open(
        probe.file,
        "CREATE TABLE marker (value INTEGER)",
        { create: true, mode: "readwrite" },
      );
      await database.close();

      assertReaderOnlyProbe(probe);
    });
  });

  it("initializes an empty search index through FileReader size", async () => {
    await withTempDir("wikigraph-empty-search-index-", async (path) => {
      const root = new NodeDirectory(path);
      const backing = (await root.createFile("index.db")) as NodeFile;
      const probe = createEmptyFileProbe(backing);
      const store = new DirectoryFileStore(
        replaceFiles(root, new Map([[backing.identity, probe.file]])),
      );

      await openSearchIndexDatabase({
        documentPath: "",
        fileStore: store,
        operation: () => undefined,
        readonly: false,
      });

      assertReaderOnlyProbe(probe);
    });
  });

  it("upgrades an empty home schema through FileReader size", async () => {
    await withTempDir("wikigraph-empty-home-schema-", async (path) => {
      const library = new NodeDirectory(`${path}/library`);
      const backing = (await library.createFile("core.sqlite")) as NodeFile;
      const probe = createEmptyFileProbe(backing);

      await withWikiGraphStorage(
        {
          documentStore: new NodeDirectory(`${path}/documents`),
          library: replaceFiles(
            library,
            new Map([[backing.identity, probe.file]]),
          ),
        },
        async () => {
          await ensureWikiGraphHomeSchemaCurrent();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
        },
      );

      assertReaderOnlyProbe(probe);
    });
  });

  it("checks empty coordinator maintenance state through FileReader size", async () => {
    await withTempDir("wikigraph-empty-coordinator-", async (path) => {
      const library = new NodeDirectory(`${path}/library`);
      const temporary = (await library.createDirectory("tmp")) as NodeDirectory;
      const backing = (await temporary.createFile(
        "wikg-coordinator.sqlite",
      )) as NodeFile;
      const archive = (await new NodeDirectory(path).createFile(
        "book.wikg",
      )) as NodeFile;
      const probe = createEmptyFileProbe(backing);

      await withWikiGraphStorage(
        {
          documentStore: new NodeDirectory(`${path}/documents`),
          library: replaceFiles(
            library,
            new Map([[backing.identity, probe.file]]),
          ),
        },
        async () => {
          await expect(
            assertArchiveUpgradeCoordinatorSafe(archive),
          ).resolves.toBeUndefined();
        },
      );

      assertReaderOnlyProbe(probe);
    });
  });
});

interface EmptyFileProbe {
  readonly file: File;
  readonly readerCloses: number;
  readonly readerOpens: number;
  readonly wholeReads: number;
}

function createEmptyFileProbe(backing: NodeFile): EmptyFileProbe {
  let readerCloses = 0;
  let readerOpens = 0;
  let wholeReads = 0;
  const file = new Proxy(backing, {
    get: (target, property, receiver) => {
      if (property === "getSize" || property === "size") return undefined;
      if (property === "read") {
        return () => {
          wholeReads += 1;
          return Promise.reject(new Error("whole-file read is forbidden"));
        };
      }
      if (property === "openReader") {
        return async () => {
          readerOpens += 1;
          const reader = await backing.openReader();
          let closed = false;
          return {
            ...reader,
            close: async () => {
              if (!closed) readerCloses += 1;
              closed = true;
              await reader.close();
            },
          };
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return {
    file,
    get readerCloses() {
      return readerCloses;
    },
    get readerOpens() {
      return readerOpens;
    },
    get wholeReads() {
      return wholeReads;
    },
  };
}

function assertReaderOnlyProbe(probe: EmptyFileProbe): void {
  expect(probe.wholeReads).toBe(0);
  expect(probe.readerOpens).toBeGreaterThan(0);
  expect(probe.readerCloses).toBe(probe.readerOpens);
}

function replaceFiles(
  backing: NodeDirectory,
  replacements: ReadonlyMap<string, File>,
): Directory {
  const replace = (file: File): File => replacements.get(file.identity) ?? file;
  return {
    createDirectory: async (name) =>
      replaceFiles(
        (await backing.createDirectory(name)) as NodeDirectory,
        replacements,
      ),
    createFile: async (name) => replace(await backing.createFile(name)),
    getDirectory: async (name) => {
      const directory = await backing.getDirectory(name);
      return directory === undefined
        ? undefined
        : replaceFiles(directory as NodeDirectory, replacements);
    },
    getFile: async (name) => {
      const file = await backing.getFile(name);
      return file === undefined ? undefined : replace(file);
    },
    identity: backing.identity,
    kind: "directory",
    list: async () =>
      (await backing.list()).map((entry) =>
        entry instanceof NodeDirectory
          ? replaceFiles(entry, replacements)
          : replace(entry as File),
      ),
    name: backing.name,
    remove: async (name, options) => await backing.remove(name, options),
  };
}

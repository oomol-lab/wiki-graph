import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NodeDirectory,
  nodeWikiGraphPlatform,
} from "../../../packages/cli/src/runtime/node-platform.js";
import { Database } from "../../../packages/core/src/document/database.js";
import { DirectoryDocument } from "../../../packages/core/src/document/directory/core.js";
import { DirectoryFileStore } from "../../../packages/core/src/document/directory/directory-file-store.js";
import { openSearchIndexDatabase } from "../../../packages/core/src/document/directory/search-index.js";
import type { DocumentFileStore } from "../../../packages/core/src/document/directory/types.js";
import {
  installWikiGraphPlatform,
  type HostDatabaseConnection,
} from "../../../packages/core/src/runtime/platform/index.js";
import { withTempDir } from "../../helpers/temp.js";

afterEach(() => installWikiGraphPlatform(nodeWikiGraphPlatform));

describe("database lifecycle", () => {
  it.each(["PRAGMA", "schema"] as const)(
    "closes the host connection when %s initialization fails",
    async (failure) => {
      await withTempDir("wikigraph-database-lifecycle-", async (path) => {
        const file = await new NodeDirectory(path).createFile("database.db");
        let closes = 0;
        const connection: HostDatabaseConnection = {
          close: () => {
            closes += 1;
            return Promise.resolve();
          },
          execute: vi.fn((sql: string) => {
            if (
              (failure === "PRAGMA" && sql.startsWith("PRAGMA")) ||
              (failure === "schema" && !sql.startsWith("PRAGMA"))
            ) {
              return Promise.reject(new Error(`${failure} failed`));
            }
            return Promise.resolve();
          }),
          queryAll: () => Promise.resolve([]),
          queryOne: () => Promise.resolve(undefined),
          run: () => Promise.resolve(),
        };
        installWikiGraphPlatform({
          ...nodeWikiGraphPlatform,
          database: { open: () => Promise.resolve(connection) },
        });

        await expect(
          Database.open(file, "CREATE TABLE marker (value INTEGER)", {
            create: true,
            mode: "readwrite",
          }),
        ).rejects.toThrow(`${failure} failed`);
        expect(closes).toBe(1);
      });
    },
  );

  it("closes the database and file store when document initialization fails", async () => {
    await withTempDir("wikigraph-document-lifecycle-", async (path) => {
      let activeConnections = 0;
      let fileStoreCloses = 0;
      installTrackedDatabasePlatform({
        onClose: () => {
          activeConnections -= 1;
        },
        onOpen: () => {
          activeConnections += 1;
        },
      });
      const backing = new DirectoryFileStore(new NodeDirectory(path));
      let ensureDirectoryCalls = 0;
      const fileStore = new Proxy(backing, {
        get(target, property, receiver) {
          if (property === "close") {
            return () => {
              fileStoreCloses += 1;
              return Promise.resolve();
            };
          }
          if (property === "ensureDirectory") {
            return async (directoryPath: string) => {
              ensureDirectoryCalls += 1;
              if (ensureDirectoryCalls > 1) {
                throw new Error("fragment setup failed");
              }
              await target.ensureDirectory(directoryPath);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as DocumentFileStore;

      await expect(DirectoryDocument.openFileStore(fileStore)).rejects.toThrow(
        "fragment setup failed",
      );
      expect(activeConnections).toBe(0);
      expect(fileStoreCloses).toBe(1);
    });
  });

  it("closes the database when search-index migration fails", async () => {
    await withTempDir("wikigraph-search-lifecycle-", async (path) => {
      let activeConnections = 0;
      installTrackedDatabasePlatform({
        failRun: "CREATE TABLE IF NOT EXISTS index_dirty_chapters",
        onClose: () => {
          activeConnections -= 1;
        },
        onOpen: () => {
          activeConnections += 1;
        },
      });
      const fileStore = new DirectoryFileStore(new NodeDirectory(path));

      await expect(
        openSearchIndexDatabase({
          documentPath: "",
          fileStore,
          operation: () => undefined,
          readonly: false,
        }),
      ).rejects.toThrow("migration failed");
      expect(activeConnections).toBe(0);
    });
  });
});

function installTrackedDatabasePlatform(input: {
  readonly failRun?: string;
  readonly onClose: () => void;
  readonly onOpen: () => void;
}): void {
  installWikiGraphPlatform({
    ...nodeWikiGraphPlatform,
    database: {
      open: async (file, options) => {
        const connection =
          options.mode === "readonly"
            ? await nodeWikiGraphPlatform.database.open(file, options)
            : await nodeWikiGraphPlatform.database.open(
                file as Parameters<
                  typeof nodeWikiGraphPlatform.database.open
                >[0],
                options,
              );
        input.onOpen();
        return {
          close: async () => {
            try {
              await connection.close();
            } finally {
              input.onClose();
            }
          },
          execute: async (sql) => await connection.execute(sql),
          queryAll: async (sql, params) =>
            await connection.queryAll(sql, params),
          queryOne: async (sql, params) =>
            await connection.queryOne(sql, params),
          run: async (sql, params) => {
            if (input.failRun !== undefined && sql.includes(input.failRun)) {
              throw new Error("migration failed");
            }
            await connection.run(sql, params);
          },
        };
      },
    },
  });
}

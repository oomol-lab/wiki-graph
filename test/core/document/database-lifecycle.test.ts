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
  type HostAsyncContext,
  type HostDatabaseConnection,
} from "../../../packages/core/src/runtime/platform/index.js";
import { withTempDir } from "../../helpers/temp.js";

afterEach(() => installWikiGraphPlatform(nodeWikiGraphPlatform));

describe("database lifecycle", () => {
  it("disables short-lived transaction contexts instead of accumulating enabled async hooks", async () => {
    const active = new Set<object>();
    const created: Array<{ disabled: number }> = [];
    installWikiGraphPlatform({
      ...nodeWikiGraphPlatform,
      asyncContext: {
        create<T>(): HostAsyncContext<T> {
          const native = nodeWikiGraphPlatform.asyncContext.create<T>();
          const record = { disabled: 0 };
          created.push(record);
          return {
            getStore: () => native.getStore(),
            enterWith: (store) => {
              active.add(record);
              native.enterWith(store);
            },
            run: (store, operation) => {
              active.add(record);
              return native.run(store, operation);
            },
            disable: () => {
              record.disabled++;
              active.delete(record);
              native.disable?.();
            },
          };
        },
      },
    });
    // No wall-clock threshold or forced GC: enabled context count is the
    // invariant, including on runtimes with a faster ALS implementation.
    for (let index = 0; index < 100; index++) {
      const database = new Database({
        close: () => Promise.resolve(),
        execute: () => Promise.resolve(),
        queryAll: () => Promise.resolve([]),
        queryOne: () => Promise.resolve(undefined),
        run: () => Promise.resolve(),
      });
      await database.transaction(async () => {
        expect(active.size).toBe(1);
        await database.run("INSERT");
      });
      await database.close();
      await database.close();
      expect(active.size).toBe(0);
    }
    expect(created).toHaveLength(100);
    expect(created.every((record) => record.disabled === 1)).toBe(true);
  });

  it("does not disable a connection's context until a failed native close can be retried", async () => {
    const disable = vi.fn();
    installWikiGraphPlatform({
      ...nodeWikiGraphPlatform,
      asyncContext: {
        create<T>(): HostAsyncContext<T> {
          const native = nodeWikiGraphPlatform.asyncContext.create<T>();
          return {
            getStore: () => native.getStore(),
            enterWith: (store) => native.enterWith(store),
            run: (store, operation) => native.run(store, operation),
            disable: () => {
              disable();
              native.disable?.();
            },
          };
        },
      },
    });
    const close = vi
      .fn()
      .mockRejectedValueOnce(new Error("close failed"))
      .mockResolvedValue(undefined);
    const database = new Database({
      close,
      execute: () => Promise.resolve(),
      queryAll: () => Promise.resolve([]),
      queryOne: () => Promise.resolve(undefined),
      run: () => Promise.resolve(),
    });
    await database.transaction(async () => {
      await database.run("INSERT");
    });
    await expect(database.close()).rejects.toThrow("close failed");
    expect(disable).not.toHaveBeenCalled();
    await database.transaction(async () => {
      await database.run("INSERT");
    });
    await database.close();
    expect(disable).toHaveBeenCalledOnce();
  });

  it("keeps older host contexts without disable compatible", async () => {
    installWikiGraphPlatform({
      ...nodeWikiGraphPlatform,
      asyncContext: {
        create<T>(): HostAsyncContext<T> {
          const native = nodeWikiGraphPlatform.asyncContext.create<T>();
          // The old host contract has no disposal hook. The host owns its
          // implementation; this test releases its own native tracker explicitly.
          cleanups.push(() => native.disable?.());
          return {
            getStore: () => native.getStore(),
            enterWith: (store) => native.enterWith(store),
            run: (store, operation) => native.run(store, operation),
          };
        },
      },
    });
    const cleanups: Array<() => void> = [];
    try {
      const database = new Database({
        close: () => Promise.resolve(),
        execute: () => Promise.resolve(),
        queryAll: () => Promise.resolve([]),
        queryOne: () => Promise.resolve(undefined),
        run: () => Promise.resolve(),
      });
      await database.transaction(async () => {
        await database.run("INSERT");
      });
      await database.close();
    } finally {
      for (const cleanup of cleanups) cleanup();
    }
  });

  it.each([false, true])(
    "releases document contexts even if store close fails (%s)",
    async (failClose) => {
      const disabled: Array<boolean> = [];
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        asyncContext: {
          create<T>(): HostAsyncContext<T> {
            const native = nodeWikiGraphPlatform.asyncContext.create<T>();
            const index = disabled.push(false) - 1;
            return {
              run: (store, operation) => native.run(store, operation),
              enterWith: (store) => native.enterWith(store),
              getStore: () => native.getStore(),
              disable: () => {
                disabled[index] = true;
                native.disable?.();
              },
            };
          },
        },
      });
      await withTempDir("wg-document-context-", async (root) => {
        const store = new DirectoryFileStore(new NodeDirectory(root));
        if (failClose)
          vi.spyOn(store, "close").mockRejectedValue(
            new Error("store close failed"),
          );
        const document = await DirectoryDocument.openFileStore(store);
        await document.openSession(async (opened) => {
          await opened.serials.listIds();
        });
        if (failClose)
          await expect(document.release()).rejects.toThrow(
            "store close failed",
          );
        else await document.release();
        expect(disabled.length).toBeGreaterThanOrEqual(2);
        expect(disabled.every(Boolean)).toBe(true);
      });
    },
  );

  it("closing one context does not destroy another database's nested transaction scope", async () => {
    const backend = () => ({
      close: () => Promise.resolve(),
      execute: () => Promise.resolve(),
      queryAll: () => Promise.resolve([]),
      queryOne: () => Promise.resolve(undefined),
      run: () => Promise.resolve(),
    });
    const first = new Database(backend());
    const second = new Database(backend());
    try {
      await first.transaction(async () => {
        await second.transaction(async () => {
          await first.run("nested write");
        });
        await second.close();
        await first.transaction(async () => {
          await first.run("still nested");
        });
      });
    } finally {
      await first.close();
      await second.close();
    }
  }, 2_000);
  it("retains reentrant admission until a callback that closes its database exits", async () => {
    const database = new Database({
      close: () => Promise.resolve(),
      execute: () => Promise.resolve(),
      queryAll: () => Promise.resolve([]),
      queryOne: () => Promise.resolve(undefined),
      run: () => Promise.resolve(),
    });
    await database.transaction(async () => {
      await database.close();
      // Without deferring context disposal, this queued behind its own parent
      // transaction forever instead of reaching the existing closed guard.
      await expect(database.run("after close")).rejects.toThrow(
        "Database is already closed",
      );
    });
    await database.close();
  }, 2_000);

  it.each([true, false])(
    "does not delete a damaged cache while opening (readonly=%s)",
    async (readonly) => {
      await withTempDir("wikigraph-damaged-cache-", async (path) => {
        const root = new NodeDirectory(path);
        const file = await root.createFile("index.db");
        const writer = await file.openWriter();
        await writer.write(new TextEncoder().encode("not a SQLite database"));
        await writer.commit();
        const fileStore = new DirectoryFileStore(root);
        const remove = vi.spyOn(fileStore, "deleteFile");
        await expect(
          openSearchIndexDatabase({
            documentPath: "",
            fileStore,
            readonly,
            operation: () => undefined,
          }),
        ).rejects.toThrow();
        expect(remove).not.toHaveBeenCalled();
      });
    },
  );

  it("does not classify cache permission/open failures as a disposable incompatible cache", async () => {
    await withTempDir("wikigraph-permission-cache-", async (path) => {
      const root = new NodeDirectory(path);
      const file = await root.createFile("index.db");
      const database = await Database.open(
        file,
        "CREATE TABLE search_index_state(key TEXT PRIMARY KEY, value TEXT)",
        { create: true, mode: "readwrite" },
      );
      await database.close();
      const fileStore = new DirectoryFileStore(root);
      const remove = vi.spyOn(fileStore, "deleteFile");
      const denied = Object.assign(new Error("database access denied"), {
        code: "SQLITE_CANTOPEN",
      });
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        database: { open: () => Promise.reject(denied) },
      });
      await expect(
        openSearchIndexDatabase({
          documentPath: "",
          fileStore,
          readonly: false,
          operation: () => undefined,
        }),
      ).rejects.toBe(denied);
      expect(remove).not.toHaveBeenCalled();
    });
  });
  it("releases the file store when the database provider open fails", async () => {
    await withTempDir("wikigraph-database-open-failure-", async (path) => {
      let fileStoreCloses = 0;
      const backing = new DirectoryFileStore(new NodeDirectory(path));
      const fileStore = new Proxy(backing, {
        get(target, property, receiver) {
          if (property === "close") {
            return () => {
              fileStoreCloses += 1;
              return Promise.resolve();
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as DocumentFileStore;
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        database: {
          open: () => Promise.reject(new Error("provider open failed")),
        },
      });

      await expect(DirectoryDocument.openFileStore(fileStore)).rejects.toThrow(
        "provider open failed",
      );
      expect(fileStoreCloses).toBe(1);
    });
  });

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

  it("closes the host connection when wrapper initialization fails", async () => {
    await withTempDir("wikigraph-database-wrapper-failure-", async (path) => {
      const file = await new NodeDirectory(path).createFile("database.db");
      let closes = 0;
      const connection: HostDatabaseConnection = {
        close: () => {
          closes += 1;
          return Promise.resolve();
        },
        execute: () => Promise.resolve(),
        queryAll: () => Promise.resolve([]),
        queryOne: () => Promise.resolve(undefined),
        run: () => Promise.resolve(),
      };
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        asyncContext: {
          create: () => {
            throw new Error("wrapper initialization failed");
          },
        },
        database: { open: () => Promise.resolve(connection) },
      });

      await expect(
        Database.open(file, "", { create: true, mode: "readwrite" }),
      ).rejects.toThrow("wrapper initialization failed");
      expect(closes).toBe(1);
    });
  });

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

  it("closes the database when a cache operation fails without running migrations", async () => {
    await withTempDir("wikigraph-search-lifecycle-", async (path) => {
      let activeConnections = 0;
      installTrackedDatabasePlatform({
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
          operation: () => {
            throw new Error("operation failed");
          },
          readonly: false,
        }),
      ).rejects.toThrow("operation failed");
      expect(activeConnections).toBe(0);
    });
  });

  it("does not delete an incompatible search index in readonly mode", async () => {
    await withTempDir("wikigraph-search-readonly-", async (path) => {
      const root = new NodeDirectory(path);
      await root.createFile("index.db");
      const fileStore = new DirectoryFileStore(root);
      const deleteFile = vi
        .spyOn(fileStore, "deleteFile")
        .mockRejectedValue(new Error("readonly index must not be deleted"));

      await expect(
        openSearchIndexDatabase({
          documentPath: "",
          fileStore,
          operation: () => undefined,
          readonly: true,
        }),
      ).rejects.toThrow("Search index cache is missing: index.db");
      expect(deleteFile).not.toHaveBeenCalled();
    });
  });

  it("closes the search-index connection when the operation fails", async () => {
    await withTempDir("wikigraph-search-operation-", async (path) => {
      let activeConnections = 0;
      installTrackedDatabasePlatform({
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
          operation: () => {
            throw new Error("operation failed");
          },
          readonly: false,
        }),
      ).rejects.toThrow("operation failed");
      expect(activeConnections).toBe(0);
    });
  });

  it("releases the file store when database close fails", async () => {
    await withTempDir("wikigraph-database-close-failure-", async (path) => {
      let activeConnections = 0;
      let fileStoreCloses = 0;
      installTrackedDatabasePlatform({
        failClose: true,
        onClose: () => {
          activeConnections -= 1;
        },
        onOpen: () => {
          activeConnections += 1;
        },
      });
      const backing = new DirectoryFileStore(new NodeDirectory(path));
      const fileStore = new Proxy(backing, {
        get(target, property, receiver) {
          if (property === "close") {
            return async () => {
              fileStoreCloses += 1;
              await target.close();
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as DocumentFileStore;
      const document = await DirectoryDocument.openFileStore(fileStore);

      await expect(document.release()).rejects.toThrow("close failed");
      expect(activeConnections).toBe(0);
      expect(fileStoreCloses).toBe(1);
    });
  });

  it("keeps shared provider sessions alive until every owner closes", async () => {
    await withTempDir("wikigraph-database-shared-owner-", async (path) => {
      const file = await new NodeDirectory(path).createFile("database.db");
      let references = 0;
      let sharedConnection: HostDatabaseConnection | undefined;
      let underlyingCloses = 0;
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        database: {
          open: async (_file, options) => {
            sharedConnection ??= await nodeWikiGraphPlatform.database.open(
              file,
              options.mode === "readonly"
                ? { create: true, mode: "readwrite" }
                : options,
            );
            references += 1;
            const connection = sharedConnection;
            let closed = false;
            return {
              close: async () => {
                if (closed) return;
                closed = true;
                references -= 1;
                if (references === 0) {
                  await connection.close();
                  underlyingCloses += 1;
                  sharedConnection = undefined;
                }
              },
              execute: async (sql) => await connection.execute(sql),
              queryAll: async (sql, params) =>
                await connection.queryAll(sql, params),
              queryOne: async (sql, params) =>
                await connection.queryOne(sql, params),
              run: async (sql, params) => await connection.run(sql, params),
            };
          },
        },
      });

      const first = await Database.open(
        file,
        "CREATE TABLE markers (value INTEGER)",
        { create: true, mode: "readwrite" },
      );
      const second = await Database.open(file, "", { mode: "readonly" });
      await first.close();
      expect(underlyingCloses).toBe(0);
      await expect(
        second.queryOne(
          "SELECT COUNT(*) AS count FROM markers",
          undefined,
          (row) => Number(row.count),
        ),
      ).resolves.toBe(0);
      await second.close();
      expect(references).toBe(0);
      expect(underlyingCloses).toBe(1);
    });
  });
});

function installTrackedDatabasePlatform(input: {
  readonly failClose?: boolean;
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
            if (input.failClose === true) {
              throw new Error("close failed");
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

import { createWriteStream } from "fs";
import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { finished } from "stream/promises";

import { ZipFile } from "yazl";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { Database } from "../../../../packages/core/src/document/index.js";
import { WikipageCache } from "../../../../packages/core/src/external/wikipage/cache.js";
import {
  ensureDefaultWikiGraphLibrary,
  parseWikiGraphLibraryUri,
} from "../../../../packages/core/src/library/registry.js";
import { withWikiGraphLibraryLock } from "../../../../packages/core/src/library/lock.js";
import { readWikiGraphLibraryIndexState } from "../../../../packages/core/src/library/search-index.js";
import { openContinuationCursorDatabase } from "../../../../packages/core/src/retrieval/query/continuation-cursor/store.js";
import { openSearchSessionDatabase } from "../../../../packages/core/src/retrieval/query/search-cache/database.js";
import { tryAcquireGcLock } from "../../../../packages/core/src/runtime/gc/lock.js";
import { openBuildQueueDatabase } from "../../../../packages/core/src/runtime/jobs/database.js";
import {
  ensureWikiGraphArchiveSchemaCurrent,
  ensureWikiGraphHomeSchemaCurrent,
  readWikiGraphArchiveSchemaVersion,
} from "../../../../packages/core/src/storage/schema-upgrade/index.js";
import {
  WIKG_MANIFEST_PATH,
  WIKG_MUTATION_TOKEN_PATH,
  SEARCH_INDEX_DATABASE_PATH,
} from "../../../../packages/core/src/storage/wikg/archive/constants.js";
import { createWikgMutationTokenContent } from "../../../../packages/core/src/storage/wikg/archive/manifest.js";
import {
  readWikgArchiveEntry,
  readWikgArchiveMutationToken,
} from "../../../../packages/core/src/storage/wikg/index.js";
import { createArchiveKey } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/archive-key.js";
import { withStateDatabase } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/state.js";
import {
  resolveWikiGraphHomeDirectoryPath,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../../packages/core/src/runtime/common/wiki-graph/dir.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("schema-upgrade", () => {
  beforeEach(() => {
    setWikiGraphStateDirectoryPathForTesting(undefined);
  });

  afterEach(() => {
    setWikiGraphStateDirectoryPathForTesting(undefined);
    delete process.env.WIKIGRAPH_STATE_DIR;
  });

  it("upgrades a legacy archive in place", async () => {
    await withTempDir("wikigraph-schema-upgrade-", async (root) => {
      setWikiGraphStateDirectoryPathForTesting(join(root, "home"));
      const archivePath = join(root, "book.wikg");
      await writeLegacyArchive(archivePath);
      const mutationToken = await readWikgArchiveMutationToken(archivePath);

      await ensureWikiGraphArchiveSchemaCurrent(archivePath);

      await expect(readWikgArchiveMutationToken(archivePath)).resolves.toBe(
        mutationToken,
      );
      await expect(
        readWikiGraphArchiveSchemaVersion(archivePath),
      ).resolves.toBe(2);
      await expect(
        readWikgArchiveEntry(archivePath, SEARCH_INDEX_DATABASE_PATH),
      ).resolves.toBeUndefined();
      await expect(
        readWikgArchiveEntry(archivePath, "toc.json"),
      ).resolves.toBeInstanceOf(Uint8Array);
      await expect(
        readWikgArchiveEntry(archivePath, WIKG_MANIFEST_PATH),
      ).resolves.toBeInstanceOf(Uint8Array);
    });
  });

  it("rejects a future archive schema version", async () => {
    await withTempDir("wikigraph-schema-future-archive-", async (root) => {
      setWikiGraphStateDirectoryPathForTesting(join(root, "home"));
      const archivePath = join(root, "book.wikg");
      await writeArchiveWithSchemaVersion(archivePath, 999);

      await expect(
        ensureWikiGraphArchiveSchemaCurrent(archivePath),
      ).rejects.toThrow("Unsupported Wiki Graph archive schema version: 999");
    });
  });

  it("rejects a future home schema version", async () => {
    await withTempDir("wikigraph-schema-future-home-", async (home) => {
      setWikiGraphStateDirectoryPathForTesting(home);
      await writeHomeSchemaVersion(home, 999);

      await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
        "Unsupported Wiki Graph home schema version: 999",
      );
    });
  });

  it("invalidates the home schema memo when core sqlite is replaced by future schema", async () => {
    await withTempDir("wikigraph-schema-future-home-replace-", async (home) => {
      setWikiGraphStateDirectoryPathForTesting(home);
      await ensureWikiGraphHomeSchemaCurrent();

      await rm(join(home, "core.sqlite"), { force: true });
      await writeHomeSchemaVersion(home, 999);

      await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
        "Unsupported Wiki Graph home schema version: 999",
      );
    });
  });

  it("invalidates the home schema memo when core sqlite is deleted and recreated as legacy", async () => {
    await withTempDir(
      "wikigraph-schema-legacy-home-recreate-",
      async (home) => {
        setWikiGraphStateDirectoryPathForTesting(home);
        await ensureWikiGraphHomeSchemaCurrent();

        await rm(join(home, "core.sqlite"), { force: true });
        await writeLegacyCoreDatabase(home);
        await ensureWikiGraphHomeSchemaCurrent();

        await expect(readHomeSchemaVersion(home)).resolves.toBe(2);
      },
    );
  });

  it("does not reuse the home schema memo after switching test home paths", async () => {
    await withTempDir("wikigraph-schema-home-switch-", async (root) => {
      const firstHome = join(root, "first-home");
      const secondHome = join(root, "second-home");

      setWikiGraphStateDirectoryPathForTesting(firstHome);
      await ensureWikiGraphHomeSchemaCurrent();

      setWikiGraphStateDirectoryPathForTesting(secondHome);
      await writeHomeSchemaVersion(secondHome, 999);

      await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
        "Unsupported Wiki Graph home schema version: 999",
      );
    });
  });

  it("upgrades a legacy home and keeps user config", async () => {
    await withTempDir("wikigraph-schema-home-", async (home) => {
      setWikiGraphStateDirectoryPathForTesting(home);

      const coreDatabasePath = join(home, "core.sqlite");
      const cacheDirectoryPath = join(home, "cache");
      const stagingDirectoryPath = join(home, "staging");
      const jobsDirectoryPath = join(home, "jobs");
      const tempDirectoryPath = join(home, "tmp");

      await mkdir(cacheDirectoryPath, { recursive: true });
      await mkdir(join(stagingDirectoryPath, "library", "1", "index"), {
        recursive: true,
      });
      await mkdir(join(jobsDirectoryPath, "cache"), { recursive: true });
      await mkdir(tempDirectoryPath, { recursive: true });
      await writeFile(join(cacheDirectoryPath, "search-sessions.sqlite"), "x");
      await writeFile(
        join(cacheDirectoryPath, "continuation-cursors.sqlite"),
        "x",
      );
      await writeFile(join(cacheDirectoryPath, "cache.sqlite"), "x");
      await writeFile(join(tempDirectoryPath, "gc.sqlite"), "x");
      await writeFile(join(tempDirectoryPath, "gc.last-run"), "x");

      const coreDatabase = await Database.open(coreDatabasePath);
      try {
        await coreDatabase.run(`
          CREATE TABLE config_sections (
            section TEXT NOT NULL,
            key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (section, key)
          )
        `);
        await coreDatabase.run(`
          INSERT INTO config_sections (section, key, value_json, updated_at)
          VALUES ('default', 'theme', '"dark"', '2026-07-23T00:00:00.000Z')
        `);
      } finally {
        await coreDatabase.close();
      }

      const stagingDatabase = await Database.open(
        join(stagingDirectoryPath, "staging.sqlite"),
      );
      try {
        await stagingDatabase.run(`
          CREATE TABLE entry_overlays (
            archive_key TEXT NOT NULL,
            archive_path TEXT NOT NULL,
            entry_path TEXT NOT NULL,
            kind TEXT NOT NULL,
            workspace_path TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (archive_key, entry_path)
          )
        `);
        await stagingDatabase.run(
          `
            INSERT INTO entry_overlays (
              archive_key, archive_path, entry_path, kind, workspace_path, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            "archive-key",
            join(home, "book.wikg"),
            SEARCH_INDEX_DATABASE_PATH,
            "file",
            join(stagingDirectoryPath, "library", "1", "index", "fts.db"),
            Date.now(),
          ],
        );
      } finally {
        await stagingDatabase.close();
      }

      await ensureWikiGraphHomeSchemaCurrent();

      const upgradedCore = await Database.open(coreDatabasePath, "", {
        readonly: true,
      });
      try {
        await expect(
          upgradedCore.queryOne(
            "SELECT value_json FROM config_sections WHERE section = ? AND key = ?",
            ["default", "theme"],
            (row) => String(row.value_json),
          ),
        ).resolves.toBe('"dark"');
        await expect(
          upgradedCore.queryOne(
            "SELECT version FROM schema_versions WHERE scope = ?",
            ["home"],
            (row) => Number(row.version),
          ),
        ).resolves.toBe(2);
      } finally {
        await upgradedCore.close();
      }

      await expect(
        readFile(join(cacheDirectoryPath, "search-sessions.sqlite")),
      ).rejects.toThrow();
      await expect(
        readFile(join(cacheDirectoryPath, "continuation-cursors.sqlite")),
      ).rejects.toThrow();
      await expect(
        readFile(join(cacheDirectoryPath, "cache.sqlite")),
      ).rejects.toThrow();
      await expect(
        stat(join(stagingDirectoryPath, "library")),
      ).rejects.toThrow();
      await expect(
        readFile(join(tempDirectoryPath, "gc.sqlite")),
      ).rejects.toThrow();
      await expect(
        readFile(join(tempDirectoryPath, "gc.last-run")),
      ).rejects.toThrow();

      const upgradedStaging = await Database.open(
        join(stagingDirectoryPath, "staging.sqlite"),
        "",
        {
          readonly: true,
        },
      );
      try {
        await expect(
          upgradedStaging.queryOne(
            "SELECT entry_path FROM entry_overlays WHERE archive_key = ?",
            ["archive-key"],
            (row) => String(row.entry_path),
          ),
        ).resolves.toBeUndefined();
      } finally {
        await upgradedStaging.close();
      }
    });
  });

  it("rejects a home upgrade when a library lock is active", async () => {
    await withTempDir("wikigraph-schema-block-", async (home) => {
      setWikiGraphStateDirectoryPathForTesting(home);

      const coreDatabase = await Database.open(join(home, "core.sqlite"));
      try {
        await coreDatabase.run(`
          CREATE TABLE library_locks (
            library_id INTEGER PRIMARY KEY,
            mode TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            owner_pid INTEGER NOT NULL,
            heartbeat_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          )
        `);
        await coreDatabase.run(
          `
            INSERT INTO library_locks (
              library_id, mode, owner_id, owner_pid, heartbeat_at, created_at
            ) VALUES (1, 'write', 'owner', ?, ?, ?)
          `,
          [process.pid, Date.now(), Date.now()],
        );
      } finally {
        await coreDatabase.close();
      }

      await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
        "active library locks",
      );
    });
  });

  it.each([
    ["archive_owners"],
    ["entry_locks"],
    ["entry_sqlite_leases"],
    ["archive_commit_locks"],
  ])("rejects an archive upgrade with active %s", async (tableName) => {
    await withTempDir("wikigraph-schema-archive-block-", async (root) => {
      setWikiGraphStateDirectoryPathForTesting(join(root, "home"));
      const archivePath = join(root, "book.wikg");
      await writeLegacyArchive(archivePath);
      await writeActiveCoordinatorState(join(root, "home"), {
        archiveKey: createArchiveKey(archivePath),
        tableName,
      });

      await expect(
        ensureWikiGraphArchiveSchemaCurrent(archivePath),
      ).rejects.toThrow("active coordinator state");
    });
  });

  it("rejects an archive upgrade with a non-fts overlay", async () => {
    await withTempDir(
      "wikigraph-schema-archive-overlay-block-",
      async (root) => {
        setWikiGraphStateDirectoryPathForTesting(join(root, "home"));
        const archivePath = join(root, "book.wikg");
        await writeLegacyArchive(archivePath);
        await writeHomeSchemaVersion(join(root, "home"), 2);
        await writeCoordinatorOverlay(join(root, "home"), {
          archiveKey: createArchiveKey(archivePath),
          entryPath: "database.db",
        });

        await expect(
          ensureWikiGraphArchiveSchemaCurrent(archivePath),
        ).rejects.toThrow("non-derived overlay state");
      },
    );
  });

  it("rejects a home upgrade with an active GC lock", async () => {
    await withBlockedHomeUpgrade("gc", async (home) => {
      await writeActiveGcLock(home);

      await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
        "active GC lock",
      );
    });
  });

  it("rejects a home upgrade with an active build job", async () => {
    await withBlockedHomeUpgrade("job", async (home) => {
      await writeBuildQueue(home, { activeJob: true });

      await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
        "active build jobs",
      );
    });
  });

  it("rejects a home upgrade with an active worker lease", async () => {
    await withBlockedHomeUpgrade("worker", async (home) => {
      await writeBuildQueue(home, { activeWorkerLease: true });

      await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
        "active build worker lease",
      );
    });
  });

  it.each([
    ["archive_owners"],
    ["entry_locks"],
    ["entry_sqlite_leases"],
    ["archive_commit_locks"],
  ])("rejects a home upgrade with active %s", async (tableName) => {
    await withBlockedHomeUpgrade(`coordinator-${tableName}`, async (home) => {
      await writeActiveCoordinatorState(home, {
        archiveKey: "archive-key",
        tableName,
      });

      await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
        "active coordinator state",
      );
    });
  });

  it("rejects a home upgrade with a non-fts overlay", async () => {
    await withBlockedHomeUpgrade("overlay", async (home) => {
      await writeCoordinatorOverlay(home, {
        archiveKey: "archive-key",
        entryPath: "database.db",
      });

      await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
        "non-derived coordinator overlays",
      );
    });
  });

  it("keeps core registry tables and constraints available after home upgrade", async () => {
    await withLegacyHome("wikigraph-schema-core-registry-", async (home) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib/index");
      expect(target).toBeDefined();
      await readWikiGraphLibraryIndexState(target!);
      await withWikiGraphLibraryLock(library.id, "read", () =>
        Promise.resolve(),
      );

      const database = await Database.open(join(home, "core.sqlite"), "", {
        readonly: true,
      });
      try {
        for (const tableName of [
          "libraries",
          "library_metadata",
          "library_archives",
          "library_locks",
        ]) {
          await expect(hasTable(database, tableName)).resolves.toBe(true);
        }
        await expect(
          hasIndex(database, "idx_libraries_single_default"),
        ).resolves.toBe(true);
        await expect(
          hasIndex(database, "idx_library_archives_library"),
        ).resolves.toBe(true);
      } finally {
        await database.close();
      }
    });
  });

  it.each([
    [
      "search-sessions.sqlite",
      async () => await closeDatabase(await openSearchSessionDatabase()),
    ],
    [
      "continuation-cursors.sqlite",
      async () => await closeDatabase(await openContinuationCursorDatabase()),
    ],
    [
      "cache/cache.sqlite",
      async () => await (await WikipageCache.open()).close(),
    ],
    [
      "jobs/job.sqlite",
      async () => await closeDatabase(await openBuildQueueDatabase()),
    ],
    ["tmp/gc.sqlite", async () => await (await tryAcquireGcLock())?.()],
    [
      "staging/staging.sqlite",
      async () => await withStateDatabase(() => Promise.resolve()),
    ],
    [
      "staging/library/<library-id>/index/fts.db",
      async () => {
        const target = parseWikiGraphLibraryUri("wikg://lib/index");
        expect(target).toBeDefined();
        await readWikiGraphLibraryIndexState(target!);
      },
    ],
  ])("opens %s only after the home schema gate", async (_name, open) => {
    await withLegacyHome("wikigraph-schema-gate-", async (home) => {
      await open();
      await expect(readHomeSchemaVersion(home)).resolves.toBe(2);
    });
  });

  it("resolves the legacy home env fallback", async () => {
    await withTempDir("wikigraph-schema-home-env-", async (home) => {
      process.env.WIKIGRAPH_STATE_DIR = home;
      setWikiGraphStateDirectoryPathForTesting(undefined);
      expect(resolveWikiGraphHomeDirectoryPath()).toBe(home);
      await Promise.resolve();
    });
  });
});

async function withLegacyHome(
  prefix: string,
  operation: (home: string) => Promise<void>,
): Promise<void> {
  await withTempDir(prefix, async (home) => {
    setWikiGraphStateDirectoryPathForTesting(home);
    await writeLegacyCoreDatabase(home);

    await operation(home);
  });
}

async function writeLegacyCoreDatabase(home: string): Promise<void> {
  const database = await Database.open(join(home, "core.sqlite"));
  try {
    await database.run(`
      CREATE TABLE config_sections (
        section TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (section, key)
      )
    `);
  } finally {
    await database.close();
  }
}

async function withBlockedHomeUpgrade(
  prefix: string,
  operation: (home: string) => Promise<void>,
): Promise<void> {
  await withLegacyHome(`wikigraph-schema-block-${prefix}-`, operation);
}

async function closeDatabase(database: Database): Promise<void> {
  await database.close();
}

async function readHomeSchemaVersion(
  home: string,
): Promise<number | undefined> {
  const database = await Database.open(join(home, "core.sqlite"), "", {
    readonly: true,
  });
  try {
    return await database.queryOne(
      "SELECT version FROM schema_versions WHERE scope = ?",
      ["home"],
      (row) => Number(row.version),
    );
  } finally {
    await database.close();
  }
}

async function writeHomeSchemaVersion(
  home: string,
  version: number,
): Promise<void> {
  await mkdir(home, { recursive: true });
  const database = await Database.open(join(home, "core.sqlite"));
  try {
    await database.run(`
      CREATE TABLE schema_versions (
        scope TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await database.run(
      "INSERT INTO schema_versions (scope, version, updated_at) VALUES ('home', ?, 'now')",
      [version],
    );
  } finally {
    await database.close();
  }
}

async function hasTable(
  database: Database,
  tableName: string,
): Promise<boolean> {
  return (
    (await database.queryOne(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName],
      () => true,
    )) === true
  );
}

async function hasIndex(
  database: Database,
  indexName: string,
): Promise<boolean> {
  return (
    (await database.queryOne(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = ?",
      [indexName],
      () => true,
    )) === true
  );
}

async function writeActiveGcLock(home: string): Promise<void> {
  await mkdir(join(home, "tmp"), { recursive: true });
  const database = await Database.open(join(home, "tmp", "gc.sqlite"));
  try {
    await database.run(`
      CREATE TABLE gc_locks (
        scope TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await database.run(
      "INSERT INTO gc_locks (scope, owner_id, owner_pid, heartbeat_at, created_at) VALUES ('global', 'owner', ?, ?, ?)",
      [process.pid, Date.now(), Date.now()],
    );
  } finally {
    await database.close();
  }
}

async function writeBuildQueue(
  home: string,
  options: {
    readonly activeJob?: boolean;
    readonly activeWorkerLease?: boolean;
  },
): Promise<void> {
  await mkdir(join(home, "jobs"), { recursive: true });
  const database = await Database.open(join(home, "jobs", "job.sqlite"));
  try {
    await database.run(`
      CREATE TABLE build_jobs (
        job_id TEXT PRIMARY KEY,
        state TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE build_worker_lease (
        id INTEGER PRIMARY KEY,
        owner_pid INTEGER,
        heartbeat_at INTEGER
      )
    `);
    if (options.activeJob === true) {
      await database.run(
        "INSERT INTO build_jobs (job_id, state) VALUES ('job', 'running')",
      );
    }
    if (options.activeWorkerLease === true) {
      await database.run(
        "INSERT INTO build_worker_lease (id, owner_pid, heartbeat_at) VALUES (1, ?, ?)",
        [process.pid, Date.now()],
      );
    }
  } finally {
    await database.close();
  }
}

async function writeActiveCoordinatorState(
  home: string,
  input: { readonly archiveKey: string; readonly tableName: string },
): Promise<void> {
  await mkdir(join(home, "staging"), { recursive: true });
  const database = await Database.open(join(home, "staging", "staging.sqlite"));
  try {
    await createCoordinatorStateTable(database, input.tableName);
    const entryPathColumn =
      input.tableName === "entry_locks" ||
      input.tableName === "entry_sqlite_leases"
        ? ", entry_path, mode"
        : "";
    const entryPathValues =
      input.tableName === "entry_locks" ||
      input.tableName === "entry_sqlite_leases"
        ? ", 'fts.db', 'read'"
        : "";
    await database.run(
      `INSERT INTO ${input.tableName} (archive_key${entryPathColumn}, owner_id, owner_pid, heartbeat_at, created_at) VALUES (?${entryPathValues}, 'owner', ?, ?, ?)`,
      [input.archiveKey, process.pid, Date.now(), Date.now()],
    );
  } finally {
    await database.close();
  }
}

async function writeCoordinatorOverlay(
  home: string,
  input: { readonly archiveKey: string; readonly entryPath: string },
): Promise<void> {
  await mkdir(join(home, "staging"), { recursive: true });
  const database = await Database.open(join(home, "staging", "staging.sqlite"));
  try {
    await database.run(`
      CREATE TABLE entry_overlays (
        archive_key TEXT NOT NULL,
        archive_path TEXT NOT NULL,
        entry_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        workspace_path TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (archive_key, entry_path)
      )
    `);
    await database.run(
      "INSERT INTO entry_overlays (archive_key, archive_path, entry_path, kind, workspace_path, updated_at) VALUES (?, ?, ?, 'file', NULL, ?)",
      [input.archiveKey, join(home, "book.wikg"), input.entryPath, Date.now()],
    );
  } finally {
    await database.close();
  }
}

async function createCoordinatorStateTable(
  database: Database,
  tableName: string,
): Promise<void> {
  if (tableName === "archive_commit_locks") {
    await database.run(`
      CREATE TABLE archive_commit_locks (
        archive_key TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    return;
  }

  const entryColumns =
    tableName === "entry_locks" || tableName === "entry_sqlite_leases"
      ? ", entry_path TEXT NOT NULL, mode TEXT NOT NULL"
      : "";
  await database.run(`
    CREATE TABLE ${tableName} (
      archive_key TEXT NOT NULL${entryColumns},
      owner_id TEXT NOT NULL,
      owner_pid INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

async function writeLegacyArchive(archivePath: string): Promise<void> {
  await writeArchiveWithSchemaVersion(archivePath, 1);
}

async function writeArchiveWithSchemaVersion(
  archivePath: string,
  schemaVersion: number,
): Promise<void> {
  await mkdir(dirname(archivePath), { recursive: true });

  const zipFile = new ZipFile();
  zipFile.addBuffer(
    createWikgMutationTokenContent(),
    WIKG_MUTATION_TOKEN_PATH,
    {
      compress: false,
    },
  );
  zipFile.addBuffer(
    Buffer.from(
      `${JSON.stringify({ formatVersion: 1, schemaVersion })}\n`,
      "utf8",
    ),
    WIKG_MANIFEST_PATH,
    {
      compress: false,
    },
  );
  zipFile.addBuffer(Buffer.from("legacy db", "utf8"), "database.db", {
    compress: false,
  });
  zipFile.addBuffer(Buffer.from("legacy toc", "utf8"), "toc.json", {
    compress: false,
  });
  zipFile.addBuffer(
    Buffer.from("legacy index", "utf8"),
    SEARCH_INDEX_DATABASE_PATH,
    {
      compress: false,
    },
  );

  zipFile.end();
  await writeZipFile(zipFile, archivePath);
}

async function writeZipFile(
  zipFile: ZipFile,
  outputPath: string,
): Promise<void> {
  const output = createWriteStream(outputPath);
  const outputDone = finished(output);
  const zipDone = finished(zipFile.outputStream);

  zipFile.outputStream.pipe(output);
  await Promise.all([outputDone, zipDone]);
}

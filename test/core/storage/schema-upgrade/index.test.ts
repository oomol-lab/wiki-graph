import { createWriteStream } from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { finished } from "stream/promises";

import { ZipFile } from "yazl";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { Database } from "../../../../packages/core/src/document/index.js";
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

  it("resolves the legacy home env fallback", async () => {
    await withTempDir("wikigraph-schema-home-env-", async (home) => {
      process.env.WIKIGRAPH_STATE_DIR = home;
      setWikiGraphStateDirectoryPathForTesting(undefined);
      expect(resolveWikiGraphHomeDirectoryPath()).toBe(home);
      await Promise.resolve();
    });
  });
});

async function writeLegacyArchive(archivePath: string): Promise<void> {
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
    Buffer.from('{"formatVersion":1}\n', "utf8"),
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

import { access, copyFile, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  Database,
  DirectoryDocument,
} from "../../../../packages/core/src/document/index.js";
import { upgradeWikiGraphArchiveSchema as upgradeWikiGraphArchiveSchemaFromPublicAPI } from "../../../../packages/core/src/index.js";
import {
  ensureWikiGraphArchiveSchemaCurrent,
  ensureWikiGraphHomeSchemaCurrent,
  readWikiGraphArchiveSchemaVersion,
  readWikiGraphHomeSchemaVersion,
  upgradeWikiGraphArchiveSchema,
} from "../../../../packages/core/src/storage/schema-upgrade/index.js";
import { assertWikiGraphLibrarySchemaCurrent } from "../../../../packages/core/src/maintenance/upgrade.js";
import {
  createWikiGraphLibrary,
  parseWikiGraphLibraryUri,
  scanWikiGraphLibrary,
} from "../../../../packages/core/src/library/index.js";
import { createPortableHash } from "../../../../packages/core/src/utils/crypto.js";
import {
  readWikgArchiveEntry,
  readWikgArchiveMutationToken,
  WikiGraphArchiveFile,
  writeWikgArchive,
} from "../../../../packages/core/src/storage/wikg/index.js";
import {
  SEARCH_INDEX_DATABASE_PATH,
  WIKG_MANIFEST_PATH,
} from "../../../../packages/core/src/storage/wikg/archive/constants.js";
import {
  installWikiGraphPlatform,
  type Directory,
  withWikiGraphStorage,
} from "../../../../packages/core/src/runtime/platform/index.js";
import {
  createNodeWikiGraphStorage,
  nodeWikiGraphPlatform,
  NodeDirectory,
  NodeFile,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("schema-upgrade", () => {
  it("upgrades v4 sentence character positions for Unicode ranges", async () => {
    await withFixture(async ({ archive, root }) => {
      await new WikiGraphArchiveFile(archive).write(async (document) => {
        const draft = await document.getSerialFragments(1).createDraft();
        draft.addSentence("Alpha.", 1);
        draft.addSentence("朱元璋。", 2);
        await draft.commit();
      });
      await removeTextCharacterColumns(archive, root);
      await rewriteManifest(archive, 4, false);

      await expect(
        upgradeWikiGraphArchiveSchema(archive),
      ).resolves.toMatchObject({ changed: true, schemaChanged: true });
      await expect(readWikiGraphArchiveSchemaVersion(archive)).resolves.toBe(5);
      await new WikiGraphArchiveFile(archive).readDocument(async (document) => {
        await expect(
          document.getSerialFragments(1).readTextInRangeWithOffsets(1, 1),
        ).resolves.toEqual({
          sourceEnd: 10,
          sourceStart: 6,
          text: "朱元璋。",
        });
      });
    });
  });

  it("upgrades a copied v3 archive and supports source provenance", async () => {
    await withFixture(async ({ archive, root }) => {
      const firstDigest = "a".repeat(64);
      const secondDigest = `${"a".repeat(12)}b${"1".repeat(51)}`;
      const thirdDigest = `${"a".repeat(12)}bc${"2".repeat(50)}`;
      const fragments = [
        "epubcfi(/6/2!/4/2)",
        "epubcfi(/6/2!/4/4)",
        "epubcfi(/6/2!/4/6)",
      ] as const;
      const seededArchive = new WikiGraphArchiveFile(archive);
      await seededArchive.write(async (document) => {
        await document.sourceProvenance.replace(
          1,
          await document.serials.getRevision(1),
          {
            artifacts: [firstDigest, secondDigest, thirdDigest].map(
              (digest, index) => ({
                digest,
                identifier: `chapter-${index + 1}.xhtml`,
                mediaType: "application/epub+zip",
                name: "book.epub",
              }),
            ),
            mappings: [firstDigest, secondDigest, thirdDigest].map(
              (digest, index) => ({
                artifactDigest: digest,
                locator: { cfi: fragments[index]! },
                sourceEnd: index + 1,
                sourceStart: index,
              }),
            ),
          },
        );
      });
      await removeSourceArtifactShortUidColumn(archive, root);
      await rewriteManifest(archive, 3, true);
      const sourceBytes = await readFile(archive.path);
      const sourceToken = await readWikgArchiveMutationToken(archive);
      const upgradedArchive = new NodeFile(join(root, "upgraded.wikg"));
      await copyFile(archive.path, upgradedArchive.path);
      await expect(
        ensureWikiGraphArchiveSchemaCurrent(upgradedArchive),
      ).rejects.toThrow("must be upgraded");

      await expect(
        upgradeWikiGraphArchiveSchema(upgradedArchive),
      ).resolves.toMatchObject({
        changed: true,
        schemaChanged: true,
      });
      await expect(
        readWikiGraphArchiveSchemaVersion(upgradedArchive),
      ).resolves.toBe(5);
      await expect(readWikgArchiveMutationToken(upgradedArchive)).resolves.toBe(
        sourceToken,
      );
      await expect(
        readWikgArchiveEntry(upgradedArchive, SEARCH_INDEX_DATABASE_PATH),
      ).resolves.toBeUndefined();

      const extracted = new NodeDirectory(join(root, "extracted"));
      await mkdir(extracted.path, { recursive: true });
      const databaseBytes = await readWikgArchiveEntry(
        upgradedArchive,
        "database.db",
      );
      expect(databaseBytes).toBeDefined();
      const databaseFile = await extracted.createFile("database.db");
      const writer = await databaseFile.openWriter();
      await writer.write(databaseBytes!);
      await writer.commit();
      const database = await Database.open(databaseFile, "", {
        readonly: true,
      });
      try {
        const artifactColumns = await database.queryAll(
          "PRAGMA table_info(source_artifacts)",
          undefined,
          (row) => ({ name: String(row.name), notNull: Number(row.notnull) }),
        );
        expect(artifactColumns).toContainEqual({
          name: "short_uid",
          notNull: 1,
        });
        const artifactIndexes = await database.queryAll(
          "PRAGMA index_list(source_artifacts)",
          undefined,
          (row) => ({ name: String(row.name), unique: Number(row.unique) }),
        );
        expect(
          artifactIndexes.filter((index) => index.unique === 1),
        ).toHaveLength(2);
        const locatorColumns = await database.queryAll(
          "PRAGMA table_info(source_locators)",
          undefined,
          (row) => String(row.name),
        );
        expect(locatorColumns).toContain("fragment");
        const locatorIndexes = await database.queryAll(
          "PRAGMA index_list(source_locators)",
          undefined,
          (row) => ({ name: String(row.name), unique: Number(row.unique) }),
        );
        expect(locatorIndexes).toContainEqual({
          name: "sqlite_autoindex_source_locators_1",
          unique: 1,
        });
        await expect(
          database.queryAll(
            "PRAGMA foreign_key_check",
            undefined,
            (row) => row,
          ),
        ).resolves.toStrictEqual([]);
      } finally {
        await database.close();
      }

      const upgraded = new WikiGraphArchiveFile(upgradedArchive);
      await upgraded.readDocument(async (document) => {
        expect(
          (await document.sourceProvenance.listArtifacts()).map(
            ({ digest, id, shortUid }) => ({ digest, id, shortUid }),
          ),
        ).toStrictEqual([
          { digest: firstDigest, id: 1, shortUid: "a".repeat(12) },
          {
            digest: secondDigest,
            id: 2,
            shortUid: `${"a".repeat(12)}b`,
          },
          {
            digest: thirdDigest,
            id: 3,
            shortUid: `${"a".repeat(12)}bc`,
          },
        ]);
        await expect(
          document.sourceProvenance.getArtifact("a".repeat(12)),
        ).resolves.toMatchObject({ digest: firstDigest });
        await expect(
          document.sourceProvenance.getArtifact(`${"a".repeat(12)}b`),
        ).resolves.toMatchObject({ digest: secondDigest });
        await expect(
          document.sourceProvenance.getArtifact(secondDigest),
        ).resolves.toMatchObject({ shortUid: `${"a".repeat(12)}b` });
        await expect(
          document.sourceProvenance.getArtifact(`${"a".repeat(12)}b1`),
        ).resolves.toBeUndefined();
        await expect(
          document.sourceProvenance.getLocator(
            `${"a".repeat(12)}bc`,
            fragments[2],
          ),
        ).resolves.toMatchObject({
          artifact: { digest: thirdDigest },
          fragment: fragments[2],
          locator: { cfi: fragments[2] },
        });
        expect(await document.sourceProvenance.listMap(1)).toMatchObject([
          {
            artifact: {
              digest: firstDigest,
              identifier: "chapter-1.xhtml",
              mediaType: "application/epub+zip",
              name: "book.epub",
              shortUid: "a".repeat(12),
            },
            fragment: fragments[0],
            locator: { cfi: fragments[0] },
            sourceEnd: 1,
            sourceStart: 0,
          },
          {
            artifact: {
              digest: secondDigest,
              identifier: "chapter-2.xhtml",
              shortUid: `${"a".repeat(12)}b`,
            },
            fragment: fragments[1],
            sourceEnd: 2,
            sourceStart: 1,
          },
          {
            artifact: {
              digest: thirdDigest,
              identifier: "chapter-3.xhtml",
              shortUid: `${"a".repeat(12)}bc`,
            },
            fragment: fragments[2],
            sourceEnd: 3,
            sourceStart: 2,
          },
        ]);
      });

      expect(await readFile(archive.path)).toEqual(sourceBytes);
      await expect(readWikgArchiveMutationToken(archive)).resolves.toBe(
        sourceToken,
      );
    });
  });

  it("repairs missing chapter keys even when the schema is current", async () => {
    await withFixture(async ({ archive }) => {
      const entries = await readZipEntries(archive);
      await nodeWikiGraphPlatform.zip.write(
        archive,
        entries.map((entry) =>
          entry.name === "toc.json"
            ? {
                data: new TextEncoder().encode(
                  `${JSON.stringify({ items: [{ serialId: 1, title: "Chapter" }], version: 1 })}\n`,
                ),
                name: entry.name,
              }
            : entry,
        ),
      );
      await expect(
        upgradeWikiGraphArchiveSchema(archive),
      ).resolves.toMatchObject({
        changed: true,
        repairedToc: true,
        schemaChanged: false,
      });
      const toc = await readWikgArchiveEntry(archive, "toc.json");
      expect(JSON.parse(new TextDecoder().decode(toc))).toMatchObject({
        items: [{ key: expect.any(String), serialId: 1 }],
      });
    });
  });

  it("rejects future archive schema versions without rewriting the file", async () => {
    await withFixture(async ({ archive }) => {
      await rewriteManifest(archive, 99, false);
      await expect(upgradeWikiGraphArchiveSchema(archive)).rejects.toThrow(
        "Unsupported Wiki Graph archive schema version: 99",
      );
      await expect(readWikiGraphArchiveSchemaVersion(archive)).resolves.toBe(
        99,
      );
    });
  });

  it("upgrades home schema under the injected library root", async () => {
    await withTempDir("wikigraph-home-schema-", async (root) => {
      await withWikiGraphStorage(
        createNodeWikiGraphStorage(join(root, "state")),
        async () => {
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(0);
          await ensureWikiGraphHomeSchemaCurrent();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
        },
      );
    });
  });

  it("upgrades concurrent host storage roots independently", async () => {
    await withTempDir("wikigraph-home-schema-a-", async (firstRoot) => {
      await withTempDir("wikigraph-home-schema-b-", async (secondRoot) => {
        const storages = [firstRoot, secondRoot].map((root) =>
          createNodeWikiGraphStorage(join(root, "state")),
        );

        await Promise.all(
          storages.map(
            async (storage) =>
              await withWikiGraphStorage(storage, async () => {
                await ensureWikiGraphHomeSchemaCurrent();
                await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
              }),
          ),
        );
      });
    });
  });

  it("migrates a v3 home atomically while preserving important registry data", async () => {
    await withTempDir("wikigraph-home-v3-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, libraryPath);
      const archivePath = join(libraryPath, "book.wikg");
      await writeFile(archivePath, "archive-v4-is-untouched");
      await createDerivedHomeState(statePath);

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await ensureWikiGraphHomeSchemaCurrent();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);

          const database = await Database.open(
            new NodeFile(join(statePath, "core.sqlite")),
            "",
            { readonly: true },
          );
          try {
            const columns = await database.queryAll(
              "PRAGMA table_info(libraries)",
              undefined,
              (row) => String(row.name),
            );
            expect(columns).toContain("folder_identity");
            expect(columns).not.toContain("folder_path");
            await expect(
              database.queryOne(
                "SELECT folder_identity FROM libraries WHERE id = 7",
                undefined,
                (row) => String(row.folder_identity),
              ),
            ).resolves.toBe(new NodeDirectory(libraryPath).identity);
            await expect(
              database.queryOne(
                "SELECT folder_identity FROM libraries WHERE id = 8",
                undefined,
                (row) => String(row.folder_identity),
              ),
            ).resolves.toBe(
              new NodeDirectory(join(statePath, "default-library")).identity,
            );
            await expect(
              database.queryOne(
                "SELECT value_json FROM config_sections WHERE section = 'llm'",
                undefined,
                (row) => String(row.value_json),
              ),
            ).resolves.toBe('{"model":"test"}');
            await expect(
              database.queryOne(
                "SELECT value_json FROM library_metadata WHERE library_id = 7 AND key = 'label'",
                undefined,
                (row) => String(row.value_json),
              ),
            ).resolves.toBe('"Fixture"');
            await expect(
              database.queryOne(
                "SELECT relative_path FROM library_archives WHERE library_id = 7",
                undefined,
                (row) => String(row.relative_path),
              ),
            ).resolves.toBe("book.wikg");
          } finally {
            await database.close();
          }

          await expect(readFile(archivePath, "utf8")).resolves.toBe(
            "archive-v4-is-untouched",
          );
          await expectPathMissing(join(statePath, "cache/cache.sqlite"));
          await expectPathMissing(join(statePath, "jobs/job.sqlite"));
          await expectPathMissing(join(statePath, "staging/staging.sqlite"));
          await expectPathMissing(
            join(statePath, "tmp/wikg-coordinator.sqlite"),
          );
          await expectPathMissing(join(statePath, "documents/.wikg-work"));

          await ensureWikiGraphHomeSchemaCurrent();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
        },
      );
    });
  });

  it("upgrades an archive through Core while its home is still v3", async () => {
    await withFixture(async ({ archive, root }) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, libraryPath);
      const mutationToken = await readWikgArchiveMutationToken(archive);
      const toc = await readWikgArchiveEntry(archive, "toc.json");
      await rewriteManifest(archive, 3, true);

      await expect(
        upgradeWikiGraphArchiveSchemaFromPublicAPI(archive),
      ).resolves.toMatchObject({ changed: true, schemaChanged: true });

      await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
      await expect(readWikiGraphArchiveSchemaVersion(archive)).resolves.toBe(5);
      await expect(readWikgArchiveMutationToken(archive)).resolves.toBe(
        mutationToken,
      );
      await expect(readWikgArchiveEntry(archive, "toc.json")).resolves.toEqual(
        toc,
      );
      await expect(
        readWikgArchiveEntry(archive, "database.db"),
      ).resolves.toBeDefined();
      await expect(
        new NodeDirectory(join(statePath, "documents")).list(),
      ).resolves.toStrictEqual([]);
    });
  });

  it("keeps the v3 marker and important data when migration fails, then retries", async () => {
    await withTempDir("wikigraph-home-retry-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, "relative-path-cannot-be-resolved");

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
            "Cannot migrate unavailable library Directory",
          );
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(3);

          const file = new NodeFile(join(statePath, "core.sqlite"));
          const database = await Database.open(file);
          try {
            await expect(
              database.queryOne(
                "SELECT value_json FROM config_sections WHERE section = 'llm'",
                undefined,
                (row) => String(row.value_json),
              ),
            ).resolves.toBe('{"model":"test"}');
            await database.run(
              "UPDATE libraries SET folder_path = ? WHERE id = 7",
              [libraryPath],
            );
          } finally {
            await database.close();
          }

          await ensureWikiGraphHomeSchemaCurrent();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
        },
      );
    });
  });

  it("retries a partially migrated directory identity with a strict host adapter", async () => {
    await withTempDir("wikigraph-home-strict-retry-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, libraryPath, {
        includeOpaqueLibrary: false,
      });

      const storage = createNodeWikiGraphStorage(statePath);
      const documentStore = failFirstDirectoryList(storage.documentStore);
      const migratedIdentity = new NodeDirectory(libraryPath).identity;
      const legacyReferences: string[] = [];
      const identityReferences: string[] = [];
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        resources: {
          getDirectory: (identity) => {
            identityReferences.push(identity);
            return Promise.resolve(
              identity === migratedIdentity
                ? new NodeDirectory(libraryPath)
                : undefined,
            );
          },
          getFile: async (identity) =>
            await nodeWikiGraphPlatform.resources.getFile(identity),
          resolveLegacyDirectory: (reference) => {
            legacyReferences.push(reference);
            return Promise.resolve(
              reference === libraryPath
                ? new NodeDirectory(libraryPath)
                : undefined,
            );
          },
        },
      });

      try {
        await withWikiGraphStorage(
          { documentStore, library: storage.library },
          async () => {
            await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
              "simulated derived cleanup failure",
            );
            await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(3);

            const database = await Database.open(
              new NodeFile(join(statePath, "core.sqlite")),
              "",
              { readonly: true },
            );
            try {
              const columns = await database.queryAll(
                "PRAGMA table_info(libraries)",
                undefined,
                (row) => String(row.name),
              );
              expect(columns).toContain("folder_identity");
              await expect(
                database.queryOne(
                  "SELECT folder_identity FROM libraries WHERE id = 7",
                  undefined,
                  (row) => String(row.folder_identity),
                ),
              ).resolves.toBe(migratedIdentity);
              await expect(
                database.queryOne(
                  "SELECT value_json FROM config_sections WHERE section = 'llm'",
                  undefined,
                  (row) => String(row.value_json),
                ),
              ).resolves.toBe('{"model":"test"}');
              await expect(
                database.queryOne(
                  "SELECT relative_path FROM library_archives WHERE library_id = 7",
                  undefined,
                  (row) => String(row.relative_path),
                ),
              ).resolves.toBe("book.wikg");
            } finally {
              await database.close();
            }

            await expect(
              ensureWikiGraphHomeSchemaCurrent(),
            ).resolves.toBeUndefined();
            await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
            expect(legacyReferences).toStrictEqual([libraryPath]);
            expect(identityReferences).toContain(migratedIdentity);
          },
        );
      } finally {
        installWikiGraphPlatform(nodeWikiGraphPlatform);
      }
    });
  });

  it("blocks v3 home migration before writes when coordinator state is active", async () => {
    await withTempDir("wikigraph-home-active-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, libraryPath);
      await seedCurrentCoordinator(statePath, {
        archiveIdentity: new NodeFile(join(root, "book.wikg")).identity,
        entryPath: "database.db",
        withActiveOwner: true,
      });

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
            "active coordinator state",
          );
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(3);
          const database = await Database.open(
            new NodeFile(join(statePath, "core.sqlite")),
            "",
            { readonly: true },
          );
          try {
            const columns = await database.queryAll(
              "PRAGMA table_info(libraries)",
              undefined,
              (row) => String(row.name),
            );
            expect(columns).toContain("folder_path");
          } finally {
            await database.close();
          }
        },
      );
    });
  });

  it("discards unfinished build jobs when no worker lease is active", async () => {
    await withTempDir("wikigraph-home-build-inactive-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, libraryPath);
      await mkdir(join(statePath, "cache"), { recursive: true });
      await writeFile(
        join(statePath, "cache/cache.sqlite"),
        "keep-before-gate",
      );
      await mkdir(join(statePath, "jobs"), { recursive: true });
      const jobs = await Database.open(
        new NodeFile(join(statePath, "jobs/job.sqlite")),
      );
      try {
        await jobs.execute(`
          CREATE TABLE build_jobs (state TEXT NOT NULL);
          CREATE TABLE build_worker_lease (
            id INTEGER PRIMARY KEY,
            owner_id TEXT,
            owner_pid INTEGER,
            heartbeat_at INTEGER
          );
        `);
        await jobs.run("INSERT INTO build_jobs VALUES ('queued')");
      } finally {
        await jobs.close();
      }

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await expect(
            ensureWikiGraphHomeSchemaCurrent(),
          ).resolves.toBeUndefined();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
          await expectPathMissing(join(statePath, "cache/cache.sqlite"));
          await expectPathMissing(join(statePath, "jobs/job.sqlite"));
        },
      );
    });
  });

  it("blocks v3 home migration while a build worker lease is active", async () => {
    await withTempDir("wikigraph-home-build-active-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, libraryPath);
      await mkdir(join(statePath, "cache"), { recursive: true });
      await writeFile(
        join(statePath, "cache/cache.sqlite"),
        "keep-before-gate",
      );
      await mkdir(join(statePath, "jobs"), { recursive: true });
      const jobs = await Database.open(
        new NodeFile(join(statePath, "jobs/job.sqlite")),
      );
      try {
        await jobs.execute(`
          CREATE TABLE build_jobs (state TEXT NOT NULL);
          CREATE TABLE build_worker_lease (
            id INTEGER PRIMARY KEY,
            owner_id TEXT,
            owner_pid INTEGER,
            heartbeat_at INTEGER
          );
        `);
        await jobs.run("INSERT INTO build_jobs VALUES ('running')");
        await jobs.run(
          "INSERT INTO build_worker_lease VALUES (1, 'worker', 1234, ?)",
          [Date.now()],
        );
      } finally {
        await jobs.close();
      }

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
            "Cannot upgrade home with an active build worker. Stop the active operation, then run `wg maintenance upgrade home`. See: `wg maintenance upgrade --help`.",
          );
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(3);
          await expect(
            readFile(join(statePath, "cache/cache.sqlite"), "utf8"),
          ).resolves.toBe("keep-before-gate");
        },
      );
    });
  });

  it("rejects future home schema versions without rewriting their marker", async () => {
    await withTempDir("wikigraph-home-future-", async (root) => {
      const statePath = join(root, "state");
      await mkdir(statePath, { recursive: true });
      const database = await Database.open(
        new NodeFile(join(statePath, "core.sqlite")),
      );
      try {
        await database.execute(`
          CREATE TABLE schema_versions (
            scope TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        await database.run(
          "INSERT INTO schema_versions VALUES ('home', 99, 'future')",
        );
      } finally {
        await database.close();
      }

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
            "Unsupported Wiki Graph home schema version: 99",
          );
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(99);
        },
      );
    });
  });

  it("blocks archive maintenance for active coordinator and non-derived overlays", async () => {
    await withFixture(async ({ archive, root }) => {
      await rewriteManifest(archive, 3, false);
      const statePath = join(root, "state");
      await seedCurrentCoordinator(statePath, {
        archiveIdentity: archive.identity,
        entryPath: "database.db",
        withActiveOwner: true,
      });
      await expect(upgradeWikiGraphArchiveSchema(archive)).rejects.toThrow(
        "active coordinator state",
      );
      await expect(readWikiGraphArchiveSchemaVersion(archive)).resolves.toBe(3);
    });

    await withFixture(async ({ archive, root }) => {
      await rewriteManifest(archive, 3, false);
      await seedCurrentCoordinator(join(root, "state"), {
        archiveIdentity: archive.identity,
        entryPath: "database.db",
        withActiveOwner: false,
      });
      await expect(upgradeWikiGraphArchiveSchema(archive)).rejects.toThrow(
        "non-derived overlay state",
      );
      await expect(readWikiGraphArchiveSchemaVersion(archive)).resolves.toBe(3);
    });
  });

  it("discards orphaned derived overlays after archive maintenance commits", async () => {
    await withFixture(async ({ archive, root }) => {
      await rewriteManifest(archive, 3, false);
      const statePath = join(root, "state");
      await seedCurrentCoordinator(statePath, {
        archiveIdentity: archive.identity,
        entryPath: "index.db",
        withActiveOwner: false,
      });

      await expect(
        upgradeWikiGraphArchiveSchema(archive),
      ).resolves.toMatchObject({ changed: true, schemaChanged: true });
      const coordinator = await Database.open(
        new NodeFile(join(statePath, "tmp/wikg-coordinator.sqlite")),
        "",
        { readonly: true },
      );
      try {
        await expect(
          coordinator.queryOne(
            "SELECT 1 AS present FROM entry_overlays LIMIT 1",
            undefined,
            () => true,
          ),
        ).resolves.toBeUndefined();
      } finally {
        await coordinator.close();
      }
    });
  });

  it("rejects a future archive during library preflight", async () => {
    await withFixture(async ({ archive, root }) => {
      const library = await createWikiGraphLibrary({
        folder: new NodeDirectory(root),
      });
      const target = parseWikiGraphLibraryUri(library.uri);
      expect(target).toBeDefined();
      await scanWikiGraphLibrary(target!);
      await rewriteManifest(archive, 99, false);
      await expect(
        assertWikiGraphLibrarySchemaCurrent(target!),
      ).rejects.toThrow("unsupported future archive schema v99");
    });
  });
});

async function withFixture(
  operation: (fixture: {
    readonly archive: NodeFile;
    readonly root: string;
  }) => Promise<void>,
): Promise<void> {
  await withTempDir("wikigraph-schema-upgrade-", async (root) => {
    await withWikiGraphStorage(
      createNodeWikiGraphStorage(join(root, "state")),
      async () => {
        const documentPath = join(root, "document");
        await mkdir(documentPath, { recursive: true });
        const directory = new NodeDirectory(documentPath);
        const document = await DirectoryDocument.open(directory);
        try {
          await document.createSerial();
          await document.writeToc({
            items: [
              { children: [], key: "chapter", serialId: 1, title: "Chapter" },
            ],
            version: 1,
          });
        } finally {
          await document.release();
        }
        const archive = new NodeFile(join(root, "book.wikg"));
        await writeWikgArchive(directory, archive);
        await operation({ archive, root });
      },
    );
  });
}

async function rewriteManifest(
  archive: NodeFile,
  schemaVersion: number,
  addDerivedIndex: boolean,
): Promise<void> {
  const entries = (await readZipEntries(archive))
    .filter((entry) => entry.name !== WIKG_MANIFEST_PATH)
    .map((entry) => ({ data: entry.data, name: entry.name }));
  entries.push({
    data: new TextEncoder().encode(
      `${JSON.stringify({ formatVersion: 1, schemaVersion })}\n`,
    ),
    name: WIKG_MANIFEST_PATH,
  });
  if (addDerivedIndex) {
    entries.push({
      data: new Uint8Array([1, 2, 3]),
      name: SEARCH_INDEX_DATABASE_PATH,
    });
  }
  await nodeWikiGraphPlatform.zip.write(archive, entries);
}

async function removeSourceArtifactShortUidColumn(
  archive: NodeFile,
  root: string,
): Promise<void> {
  const entries = await readZipEntries(archive);
  const databaseEntry = entries.find((entry) => entry.name === "database.db");
  if (databaseEntry === undefined) {
    throw new Error("Fixture archive has no database.db entry.");
  }

  const databasePath = join(root, "v3-database.db");
  await writeFile(databasePath, databaseEntry.data);
  const database = await Database.open(new NodeFile(databasePath));
  try {
    await database.execute(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE source_artifacts_legacy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        digest BLOB NOT NULL UNIQUE,
        media_type TEXT NOT NULL,
        name TEXT,
        identifier TEXT
      );
      INSERT INTO source_artifacts_legacy (
        id, digest, media_type, name, identifier
      )
      SELECT id, digest, media_type, name, identifier
      FROM source_artifacts;
      DROP TABLE source_artifacts;
      ALTER TABLE source_artifacts_legacy RENAME TO source_artifacts;
    `);
  } finally {
    await database.close();
  }
  const databaseBytes = await readFile(databasePath);
  await nodeWikiGraphPlatform.zip.write(
    archive,
    entries.map((entry) =>
      entry.name === "database.db"
        ? { data: databaseBytes, name: entry.name }
        : entry,
    ),
  );
}

async function removeTextCharacterColumns(
  archive: NodeFile,
  root: string,
): Promise<void> {
  const entries = await readZipEntries(archive);
  const databaseEntry = entries.find((entry) => entry.name === "database.db");
  if (databaseEntry === undefined) {
    throw new Error("Fixture archive has no database.db entry.");
  }
  const databasePath = join(root, "v4-database.db");
  await writeFile(databasePath, databaseEntry.data);
  const database = await Database.open(new NodeFile(databasePath));
  try {
    await database.execute(`
      ALTER TABLE text_sentence_records DROP COLUMN character_offset;
      ALTER TABLE text_sentence_records DROP COLUMN character_length;
    `);
  } finally {
    await database.close();
  }
  const databaseBytes = await readFile(databasePath);
  await nodeWikiGraphPlatform.zip.write(
    archive,
    entries.map((entry) =>
      entry.name === "database.db"
        ? { data: databaseBytes, name: entry.name }
        : entry,
    ),
  );
}

async function readZipEntries(
  archive: NodeFile,
): Promise<Array<{ readonly data: Uint8Array; readonly name: string }>> {
  const reader = await nodeWikiGraphPlatform.zip.open(archive);
  try {
    const entries: Array<{ data: Uint8Array; name: string }> = [];
    for (const name of await reader.listEntries()) {
      const data = await reader.readEntry(name);
      if (data !== undefined) entries.push({ data, name });
    }
    return entries;
  } finally {
    await reader.close();
  }
}

async function createV3Home(
  statePath: string,
  libraryReference: string,
  options: { readonly includeOpaqueLibrary?: boolean } = {},
): Promise<void> {
  await mkdir(statePath, { recursive: true });
  const database = await Database.open(
    new NodeFile(join(statePath, "core.sqlite")),
  );
  try {
    await database.execute(`
      CREATE TABLE schema_versions (
        scope TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE config_sections (
        section TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE libraries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        folder_path TEXT NOT NULL UNIQUE,
        is_default INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE library_metadata (
        library_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (library_id, key)
      );
      CREATE TABLE library_archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        public_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    await database.run("INSERT INTO schema_versions VALUES ('home', 3, 'v3')");
    await database.run(
      `INSERT INTO config_sections VALUES ('llm', '{"model":"test"}', 'v3')`,
    );
    await database.run(
      "INSERT INTO libraries VALUES (7, 'fixture-lib', ?, 0, 'created', 'updated')",
      [libraryReference],
    );
    if (options.includeOpaqueLibrary !== false) {
      await database.run(
        "INSERT INTO libraries VALUES (8, 'opaque-lib', ?, 1, 'created', 'updated')",
        [new NodeDirectory(join(statePath, "default-library")).identity],
      );
    }
    await database.run(
      `INSERT INTO library_metadata VALUES (7, 'label', '"Fixture"', 'v3')`,
    );
    await database.run(
      "INSERT INTO library_archives VALUES (11, 7, 'fixture-archive', 'book.wikg', 'present', 'created', 'updated')",
    );
  } finally {
    await database.close();
  }
}

function failFirstDirectoryList(directory: Directory): Directory {
  let shouldFail = true;
  return {
    createDirectory: async (name) => await directory.createDirectory(name),
    createFile: async (name) => await directory.createFile(name),
    getDirectory: async (name) => await directory.getDirectory(name),
    getFile: async (name) => await directory.getFile(name),
    identity: directory.identity,
    list: async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("simulated derived cleanup failure");
      }
      return await directory.list();
    },
    name: directory.name,
    remove: async (name, options) => await directory.remove(name, options),
  };
}

async function createDerivedHomeState(statePath: string): Promise<void> {
  for (const path of [
    "cache/cache.sqlite",
    "cache/search-sessions.sqlite",
    "staging/library/7/index/index.db",
    "documents/.wikg-work/orphan/snapshot",
  ]) {
    const filePath = join(statePath, path);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, "derived");
  }

  await mkdir(join(statePath, "jobs"), { recursive: true });
  const jobs = await Database.open(
    new NodeFile(join(statePath, "jobs/job.sqlite")),
  );
  try {
    await jobs.execute(`
      CREATE TABLE build_jobs (state TEXT NOT NULL);
      CREATE TABLE build_worker_lease (
        id INTEGER PRIMARY KEY,
        owner_id TEXT,
        owner_pid INTEGER,
        heartbeat_at INTEGER
      );
    `);
    await jobs.run("INSERT INTO build_jobs VALUES ('completed')");
  } finally {
    await jobs.close();
  }

  await mkdir(join(statePath, "staging"), { recursive: true });
  const legacy = await Database.open(
    new NodeFile(join(statePath, "staging/staging.sqlite")),
  );
  try {
    await legacy.execute(`
      CREATE TABLE archive_owners (
        owner_id TEXT PRIMARY KEY,
        heartbeat_at INTEGER NOT NULL
      );
      CREATE TABLE entry_overlays (entry_path TEXT NOT NULL);
    `);
    await legacy.run("INSERT INTO entry_overlays VALUES ('database.db')");
  } finally {
    await legacy.close();
  }

  await seedCurrentCoordinator(statePath, {
    archiveIdentity: "node-file:b3JwaGFu",
    entryPath: "database.db",
    withActiveOwner: false,
  });
}

async function seedCurrentCoordinator(
  statePath: string,
  input: {
    readonly archiveIdentity: string;
    readonly entryPath: string;
    readonly withActiveOwner: boolean;
  },
): Promise<void> {
  await mkdir(join(statePath, "tmp"), { recursive: true });
  const database = await Database.open(
    new NodeFile(join(statePath, "tmp/wikg-coordinator.sqlite")),
  );
  const archiveKey = createPortableHash("sha256")
    .update(input.archiveIdentity)
    .digest("hex");
  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS archive_owners (
        archive_key TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        host_instance_id TEXT NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (archive_key, owner_id)
      );
      CREATE TABLE IF NOT EXISTS entry_overlays (
        archive_key TEXT NOT NULL,
        archive_identity TEXT NOT NULL,
        entry_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_digest TEXT,
        workspace_identity TEXT,
        workspace_path TEXT,
        owner_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (archive_key, entry_path)
      );
      CREATE TABLE IF NOT EXISTS entry_locks (
        lock_id TEXT PRIMARY KEY,
        archive_key TEXT NOT NULL,
        entry_path TEXT NOT NULL,
        mode TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entry_sqlite_leases (
        archive_key TEXT NOT NULL,
        entry_path TEXT NOT NULL,
        mode TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (archive_key, entry_path, owner_id)
      );
      CREATE TABLE IF NOT EXISTS archive_commit_locks (
        archive_key TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    if (input.withActiveOwner) {
      await database.run(
        "INSERT INTO archive_owners VALUES (?, 'owner', ?, ?, ?)",
        [
          archiveKey,
          nodeWikiGraphPlatform.lifecycle.instanceId,
          Date.now(),
          Date.now(),
        ],
      );
    }
    await database.run(
      `INSERT INTO entry_overlays (
         archive_key, archive_identity, entry_path, kind, owner_id, updated_at
       ) VALUES (?, ?, ?, 'deleted', 'owner', ?)`,
      [archiveKey, input.archiveIdentity, input.entryPath, Date.now()],
    );
  } finally {
    await database.close();
  }
}

async function expectPathMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow();
}

import { mkdir, rm, stat, utimes, writeFile } from "fs/promises";
import { dirname, join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { createWikiGraphTempDirectory } from "../../../../packages/core/src/runtime/common/wiki-graph/temp.js";
import {
  getWikiGraphStateDirectoryPathForTesting,
  resolveWikiGraphHomeDirectoryPath,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../../packages/core/src/runtime/common/wiki-graph/dir.js";
import {
  Database,
  DirectoryDocument,
} from "../../../../packages/core/src/document/index.js";
import { addBuildJob } from "../../../../packages/core/src/api/index.js";
import { createWikiGraphLibrary } from "../../../../packages/core/src/index.js";
import { tryRunWikiGraphGc } from "../../../../packages/core/src/runtime/gc/index.js";
import {
  createSearchSession,
  rebuildArchiveSearchIndex,
} from "../../../../packages/core/src/retrieval/query/index.js";
import { writeWikgArchive } from "../../../../packages/core/src/storage/wikg/archive/index.js";
import { WikiGraphArchiveFile } from "../../../../packages/core/src/storage/wikg/index.js";
import { WikipageCache } from "../../../../packages/core/src/external/wikipage/index.js";
import { withTempDir } from "../../../helpers/temp.js";

const originalStateDir = getWikiGraphStateDirectoryPathForTesting();

describe("gc", () => {
  afterEach(() => {
    restoreWikiGraphStateDir(originalStateDir);
  });

  it("cleans expired search sessions, completed jobs, and old controlled tmp directories", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));

      await createExpiredSearchSession();
      const job = await createCompletedOldJob(path);
      const tmpPath = await createOldTmpDirectory();
      const sqliteCachePath = await createOldCoordinatorSqliteCache(path);
      const sqliteCacheParentPath = dirname(sqliteCachePath);

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      expect(report.jobs.map((item) => item.name)).toStrictEqual([
        "wikg-coordinator",
        "search-cache",
        "library-index",
        "wikipage-cache",
        "build-queue",
        "tmp",
      ]);
      expect(report.removed).toBeGreaterThanOrEqual(3);
      await expect(stat(sqliteCachePath)).rejects.toThrow();
      await expect(stat(sqliteCacheParentPath)).rejects.toThrow();
      await expect(stat(tmpPath)).rejects.toThrow();
      await expect(stat(job.workspacePath)).rejects.toThrow();
      await expect(stat(job.cachePath)).rejects.toThrow();
      await expect(stat(job.logPath)).rejects.toThrow();
      await expect(stat(job.eventsPath)).rejects.toThrow();
      await expect(
        countRows("cache/search-sessions.sqlite", "search_sessions"),
      ).resolves.toBe(0);
      await expect(countRows("jobs/job.sqlite", "build_jobs")).resolves.toBe(0);
    });
  });

  it("removes expired wikipage cache entries", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      await createWikipageCacheRows(
        new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      );

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      expect(
        report.jobs.find((item) => item.name === "wikipage-cache"),
      ).toMatchObject({
        removed: 2,
        scanned: 2,
      });
      await expect(countRows("cache/cache.sqlite", "qid_cache")).resolves.toBe(
        0,
      );
      await expect(
        countRows("cache/cache.sqlite", "disambiguation_cache"),
      ).resolves.toBe(0);
    });
  });

  it("keeps fresh wikipage cache entries during forced GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      await createWikipageCacheRows(new Date().toISOString());

      const report = await tryRunWikiGraphGc({ force: true });

      expect(report.skipped).toBe(false);
      expect(
        report.jobs.find((item) => item.name === "wikipage-cache"),
      ).toMatchObject({
        removed: 0,
        scanned: 2,
      });
      await expect(countRows("cache/cache.sqlite", "qid_cache")).resolves.toBe(
        1,
      );
      await expect(
        countRows("cache/cache.sqlite", "disambiguation_cache"),
      ).resolves.toBe(1);
    });
  });

  it("reports expired wikipage cache entries during dry-run GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      await createWikipageCacheRows(
        new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      );

      const report = await tryRunWikiGraphGc({ dryRun: true });

      expect(report.skipped).toBe(false);
      const wikipageCacheJob = report.jobs.find(
        (item) => item.name === "wikipage-cache",
      );

      expect(wikipageCacheJob).toMatchObject({
        removed: 2,
        scanned: 2,
      });
      expect(wikipageCacheJob?.freedBytes).toBeGreaterThan(0);
      await expect(countRows("cache/cache.sqlite", "qid_cache")).resolves.toBe(
        1,
      );
      await expect(
        countRows("cache/cache.sqlite", "disambiguation_cache"),
      ).resolves.toBe(1);
    });
  });

  it("skips when another GC run owns the global lock", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      await insertGcLock();

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(true);
      expect(report.jobs).toStrictEqual([]);
    });
  });

  it("removes orphan library index staging while preserving valid and locked libraries", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const library = await createWikiGraphLibrary({
        folderPath: join(path, "library"),
      });
      const validPath = join(library.stagingPath, "index");
      const orphanPath = join(path, "state", "staging", "library", "999");
      const lockedPath = join(path, "state", "staging", "library", "1000");
      const stateLockedPath = join(path, "state", "staging", "library", "1001");

      await mkdir(validPath, { recursive: true });
      await mkdir(orphanPath, { recursive: true });
      await mkdir(lockedPath, { recursive: true });
      await mkdir(stateLockedPath, { recursive: true });
      await writeFile(join(validPath, "fts.db"), "valid", "utf8");
      await writeFile(join(orphanPath, "fts.db"), "orphan", "utf8");
      await writeFile(join(lockedPath, "fts.db"), "locked", "utf8");
      await writeFile(join(stateLockedPath, "fts.db"), "state-locked", "utf8");
      await insertLibraryLock(1000);
      await insertStateLibraryLock(1001);

      const report = await tryRunWikiGraphGc();
      const libraryIndexJob = report.jobs.find(
        (item) => item.name === "library-index",
      );

      expect(report.skipped).toBe(false);
      expect(libraryIndexJob).toMatchObject({ removed: 1, scanned: 4 });
      await expect(stat(validPath)).resolves.toBeDefined();
      await expect(stat(orphanPath)).rejects.toThrow();
      await expect(stat(lockedPath)).resolves.toBeDefined();
      await expect(stat(stateLockedPath)).resolves.toBeDefined();
    });
  });

  it("keeps library index staging when registry ids cannot be read", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const libraryPath = join(path, "state", "staging", "library", "1");

      await mkdir(libraryPath, { recursive: true });
      await writeFile(join(libraryPath, "fts.db"), "library", "utf8");

      const report = await tryRunWikiGraphGc();
      const libraryIndexJob = report.jobs.find(
        (item) => item.name === "library-index",
      );

      expect(report.skipped).toBe(false);
      expect(libraryIndexJob).toMatchObject({ removed: 0, scanned: 0 });
      await expect(stat(libraryPath)).resolves.toBeDefined();
    });
  });

  it("keeps fresh sqlite cache during normal GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const sqliteCachePath = await createCoordinatorSqliteCache(path, {
        updatedAt: Date.now(),
      });

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      await expect(stat(sqliteCachePath)).resolves.toBeDefined();
    });
  });

  it("removes fresh sqlite cache during forced GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const sqliteCachePath = await createCoordinatorSqliteCache(path, {
        updatedAt: Date.now(),
      });

      const report = await tryRunWikiGraphGc({ force: true });

      expect(report.skipped).toBe(false);
      expect(
        report.jobs.find((item) => item.name === "wikg-coordinator"),
      ).toMatchObject({
        removed: 1,
        scanned: 1,
      });
      await expect(stat(sqliteCachePath)).rejects.toThrow();
    });
  });

  it("removes stale empty workspace directories", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const workspaceBucketPath = join(
        path,
        "state",
        "staging",
        "work",
        "archive-key",
      );
      const buildJobBucketPath = join(path, "state", "jobs", "work", "job-id");

      await mkdir(workspaceBucketPath, { recursive: true });
      await mkdir(buildJobBucketPath, { recursive: true });
      await writeFile(join(workspaceBucketPath, ".DS_Store"), "finder");
      await writeFile(join(buildJobBucketPath, ".DS_Store"), "finder");
      await makeOldPath(workspaceBucketPath);
      await makeOldPath(buildJobBucketPath);

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      const wikgCoordinatorJob = report.jobs.find(
        (item) => item.name === "wikg-coordinator",
      );

      expect(wikgCoordinatorJob?.removed).toBeGreaterThanOrEqual(1);
      expect(
        report.jobs.find((item) => item.name === "build-queue"),
      ).toMatchObject({ removed: 1 });
      await expect(stat(workspaceBucketPath)).rejects.toThrow();
      await expect(stat(buildJobBucketPath)).rejects.toThrow();
    });
  });

  it("removes dirty external fts sqlite cache during normal GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const sqliteCachePath = await createCoordinatorSqliteCache(path, {
        entryPath: "fts.db",
        updatedAt: Date.now() - 2 * 60 * 60 * 1000,
      });

      const normalReport = await tryRunWikiGraphGc();

      expect(normalReport.skipped).toBe(false);
      expect(
        normalReport.jobs.find((item) => item.name === "wikg-coordinator"),
      ).toMatchObject({
        removed: 1,
        scanned: 1,
      });
      await expect(stat(sqliteCachePath)).rejects.toThrow();
    });
  });

  it("keeps current external fts sqlite cache during normal GC and removes it during forced GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const { ftsPath } = await createArchiveWithExternalSearchIndex(path);

      await makeCoordinatorOverlayOld("fts.db");
      const normalReport = await tryRunWikiGraphGc();

      expect(normalReport.skipped).toBe(false);
      await expect(stat(ftsPath)).resolves.toBeDefined();
      const forcedReport = await tryRunWikiGraphGc({ force: true });

      expect(forcedReport.skipped).toBe(false);
      expect(
        forcedReport.jobs.find((item) => item.name === "wikg-coordinator")
          ?.removed,
      ).toBeGreaterThanOrEqual(1);
      await expect(stat(ftsPath)).rejects.toThrow();
    });
  });

  it("removes external fts sqlite cache when the source archive is missing", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const { archivePath, ftsPath } =
        await createArchiveWithExternalSearchIndex(path);

      await rm(archivePath, { force: true });
      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      await expect(stat(ftsPath)).rejects.toThrow();
    });
  });

  it("removes external fts sqlite cache when the archive fingerprint changes", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const { archivePath, ftsPath } =
        await createArchiveWithExternalSearchIndex(path);

      await new WikiGraphArchiveFile(archivePath).write(async (document) => {
        await document.openSession(async (openedDocument) => {
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("Changed archive content.", 3);
          await draft.commit();
        });
      });

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      await expect(stat(ftsPath)).rejects.toThrow();
    });
  });

  it("removes orphaned coordinator workspace files", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const workspaceBucketPath = join(
        path,
        "state",
        "staging",
        "work",
        "archive-key",
      );
      const referencedPath = join(workspaceBucketPath, "database.db");
      const orphanedPath = join(
        workspaceBucketPath,
        "texts",
        "source",
        "1.txt",
      );

      await mkdir(dirname(orphanedPath), { recursive: true });
      await writeFile(referencedPath, "referenced", "utf8");
      await writeFile(orphanedPath, "orphaned", "utf8");
      await createCoordinatorOverlay(path, {
        archiveKey: "archive-key",
        entryPath: "database.db",
        workspacePath: referencedPath,
      });

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      const wikgCoordinatorJob = report.jobs.find(
        (item) => item.name === "wikg-coordinator",
      );

      expect(wikgCoordinatorJob?.removed).toBeGreaterThanOrEqual(1);
      await expect(stat(referencedPath)).resolves.toBeDefined();
      await expect(stat(orphanedPath)).rejects.toThrow();
    });
  });

  it("removes empty coordinator workspace descendants", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const workspaceBucketPath = join(
        path,
        "state",
        "staging",
        "work",
        "archive-key",
      );
      const referencedPath = join(workspaceBucketPath, "database.db");
      const sourceDirectoryPath = join(workspaceBucketPath, "texts", "source");
      const summaryDirectoryPath = join(
        workspaceBucketPath,
        "texts",
        "summary",
      );

      await mkdir(sourceDirectoryPath, { recursive: true });
      await mkdir(summaryDirectoryPath, { recursive: true });
      await writeFile(referencedPath, "referenced", "utf8");
      await writeFile(join(summaryDirectoryPath, ".DS_Store"), "finder");
      await createCoordinatorOverlay(path, {
        archiveKey: "archive-key",
        entryPath: "database.db",
        workspacePath: referencedPath,
      });

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      const wikgCoordinatorJob = report.jobs.find(
        (item) => item.name === "wikg-coordinator",
      );

      expect(wikgCoordinatorJob?.removed).toBeGreaterThanOrEqual(2);
      await expect(stat(referencedPath)).resolves.toBeDefined();
      await expect(stat(sourceDirectoryPath)).rejects.toThrow();
      await expect(stat(summaryDirectoryPath)).rejects.toThrow();
      await expect(stat(join(workspaceBucketPath, "texts"))).rejects.toThrow();
      await expect(stat(workspaceBucketPath)).resolves.toBeDefined();
    });
  });

  it("keeps fresh terminal build jobs during normal GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const job = await createCompletedJob(path, {
        ageMs: 0,
        state: "failed",
      });

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      expect(
        report.jobs.find((item) => item.name === "build-queue"),
      ).toMatchObject({ removed: 0 });
      await expect(stat(job.workspacePath)).resolves.toBeDefined();
      await expect(stat(job.cachePath)).resolves.toBeDefined();
      await expect(stat(job.logPath)).resolves.toBeDefined();
      await expect(countRows("jobs/job.sqlite", "build_jobs")).resolves.toBe(1);
    });
  });

  it("removes fresh terminal build jobs during forced GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const job = await createCompletedJob(path, {
        ageMs: 0,
        state: "failed",
      });

      const report = await tryRunWikiGraphGc({ force: true });

      expect(report.skipped).toBe(false);
      expect(
        report.jobs.find((item) => item.name === "build-queue"),
      ).toMatchObject({ removed: 1 });
      await expect(stat(job.workspacePath)).rejects.toThrow();
      await expect(stat(job.cachePath)).rejects.toThrow();
      await expect(stat(job.logPath)).rejects.toThrow();
      await expect(countRows("jobs/job.sqlite", "build_jobs")).resolves.toBe(0);
    });
  });
});

async function createOldCoordinatorSqliteCache(path: string): Promise<string> {
  return await createCoordinatorSqliteCache(path, {
    updatedAt: Date.now() - 2 * 60 * 60 * 1000,
  });
}

async function createArchiveWithExternalSearchIndex(path: string): Promise<{
  readonly archivePath: string;
  readonly ftsPath: string;
}> {
  const documentPath = join(path, "document");
  const archivePath = join(path, "book.wikg");
  const document = await DirectoryDocument.open(documentPath);

  try {
    await document.openSession(async (openedDocument) => {
      await openedDocument.createSerial();
      const draft = await openedDocument.getSerialFragments(1).createDraft();

      draft.addSentence("Indexed source sentence.", 3);
      await draft.commit();
      await openedDocument.writeToc({
        items: [{ children: [], serialId: 1, title: "Indexed" }],
        version: 1,
      });
    });
  } finally {
    await document.release();
  }

  await writeWikgArchive(documentPath, archivePath);
  await new WikiGraphArchiveFile(archivePath).write(
    async (openedDocument) => {
      await rebuildArchiveSearchIndex(openedDocument);
    },
    { searchIndexWritebackPolicy: "cache" },
  );

  const ftsPath = await readCoordinatorWorkspacePath("fts.db");

  if (ftsPath === undefined) {
    throw new Error("Expected external fts cache overlay.");
  }

  return { archivePath, ftsPath };
}

async function readCoordinatorWorkspacePath(
  entryPath: string,
): Promise<string | undefined> {
  const database = await openStateDatabase("staging/staging.sqlite");

  try {
    return await database.queryOne(
      `
SELECT workspace_path
FROM entry_overlays
WHERE entry_path = ?
ORDER BY updated_at DESC
LIMIT 1
`,
      [entryPath],
      (row) =>
        typeof row.workspace_path === "string" ? row.workspace_path : undefined,
    );
  } finally {
    await database.close();
  }
}

async function makeCoordinatorOverlayOld(entryPath: string): Promise<void> {
  const database = await openStateDatabase("staging/staging.sqlite");

  try {
    await database.run(
      `
UPDATE entry_overlays
SET updated_at = ?
WHERE entry_path = ?
`,
      [Date.now() - 2 * 60 * 60 * 1000, entryPath],
    );
  } finally {
    await database.close();
  }
}

async function createCoordinatorSqliteCache(
  path: string,
  options: { readonly entryPath?: string; readonly updatedAt: number },
): Promise<string> {
  const archivePath = join(path, "book.wikg");
  const workspacePath = join(
    path,
    "state",
    "staging",
    "work",
    "archive-key",
    "db",
  );
  const entryPath = options.entryPath ?? "database.db";

  await writeFile(archivePath, "archive", "utf8");
  await mkdir(join(path, "state", "staging", "work", "archive-key"), {
    recursive: true,
  });
  await writeFile(workspacePath, "sqlite-cache", "utf8");
  await writeFile(
    join(path, "state", "staging", "work", "archive-key", ".DS_Store"),
    "finder",
    "utf8",
  );

  const database = await openStateDatabase(
    "staging/staging.sqlite",
    `
CREATE TABLE IF NOT EXISTS entry_overlays (
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace_path TEXT,
  archive_signature TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path)
);
`,
  );

  try {
    await database.run(
      `
INSERT INTO entry_overlays (
  archive_key, archive_path, entry_path, kind, workspace_path,
  archive_signature, updated_at
) VALUES (?, ?, ?, 'file', ?, 'test-signature', ?)
`,
      ["archive-key", archivePath, entryPath, workspacePath, options.updatedAt],
    );
  } finally {
    await database.close();
  }

  return workspacePath;
}

async function createCoordinatorOverlay(
  path: string,
  input: {
    readonly archiveKey: string;
    readonly entryPath: string;
    readonly workspacePath: string;
  },
): Promise<void> {
  const archivePath = join(path, "book.wikg");

  await writeFile(archivePath, "archive", "utf8");
  const database = await openStateDatabase(
    "staging/staging.sqlite",
    `
CREATE TABLE IF NOT EXISTS entry_overlays (
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace_path TEXT,
  archive_signature TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path)
);
`,
  );

  try {
    await database.run(
      `
INSERT INTO entry_overlays (
  archive_key, archive_path, entry_path, kind, workspace_path,
  archive_signature, updated_at
) VALUES (?, ?, ?, 'file', ?, 'test-signature', ?)
`,
      [
        input.archiveKey,
        archivePath,
        input.entryPath,
        input.workspacePath,
        Date.now(),
      ],
    );
  } finally {
    await database.close();
  }
}

async function createExpiredSearchSession(): Promise<void> {
  const sessionId = await createSearchSession({
    archiveKey: "archive-key",
    chapters: null,
    items: [],
    lens: "broad",
    match: "any",
    order: "rank",
    query: "query",
    revisionScope: JSON.stringify({ chaptersRevision: 0, scope: "all" }),
    terms: ["query"],
    types: null,
  });
  const database = await openStateDatabase("cache/search-sessions.sqlite");

  try {
    await database.run(
      "UPDATE search_sessions SET expires_at = ? WHERE session_id = ?",
      [Date.now() - 1, sessionId],
    );
  } finally {
    await database.close();
  }
}

async function createWikipageCacheRows(checkedAt: string): Promise<void> {
  const cache = await WikipageCache.open();

  try {
    await cache.putQids(
      [
        {
          checkedAt,
          description: "test entity",
          label: "Entity",
          qid: "Q1",
          sitelinks: [
            {
              isDisambiguation: true,
              title: "Entity",
              wiki: "enwiki",
            },
          ],
          updatedAt: checkedAt,
        },
      ],
      "en",
    );
    await cache.putDisambiguations(
      [
        {
          checkedAt,
          disambiguationQid: "Q1",
          pages: [
            {
              linkedQids: [],
              text: "Entity page text.",
              title: "Entity",
              wiki: "enwiki",
            },
          ],
        },
      ],
      "enwiki",
    );
  } finally {
    await cache.close();
  }
}

async function createCompletedOldJob(path: string): Promise<{
  readonly cachePath: string;
  readonly eventsPath: string;
  readonly logPath: string;
  readonly workspacePath: string;
}> {
  return await createCompletedJob(path, {
    ageMs: 8 * 24 * 60 * 60 * 1000,
    state: "succeeded",
  });
}

async function createCompletedJob(
  path: string,
  options: {
    readonly ageMs: number;
    readonly state: "canceled" | "failed" | "succeeded";
  },
): Promise<{
  readonly cachePath: string;
  readonly eventsPath: string;
  readonly logPath: string;
  readonly workspacePath: string;
}> {
  const job = await addBuildJob({
    archivePath: join(path, "book.wikg"),
    chapterId: 1,
    target: "reading-summary",
  });
  await mkdir(job.workspacePath, { recursive: true });
  await writeFile(join(job.workspacePath, "artifact.txt"), "artifact", "utf8");
  await writeFile(join(job.cachePath, "request.txt"), "cache", "utf8");
  await writeFile(join(job.logPath, "run.log"), "log", "utf8");
  await writeFile(job.eventsPath, "event\n", "utf8");

  const database = await openStateDatabase("jobs/job.sqlite");

  try {
    const updatedAt = Date.now() - options.ageMs;

    await database.run(
      `
UPDATE build_jobs
SET state = ?, updated_at = ?, finished_at = ?
WHERE job_id = ?
`,
      [options.state, updatedAt, updatedAt, job.jobId],
    );
  } finally {
    await database.close();
  }

  return job;
}

async function createOldTmpDirectory(): Promise<string> {
  const tmpPath = await createWikiGraphTempDirectory("cli-output");
  const filePath = join(tmpPath, "output.txt");
  const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);

  await writeFile(filePath, "temporary", "utf8");
  await utimes(filePath, oldDate, oldDate);
  await utimes(tmpPath, oldDate, oldDate);

  return tmpPath;
}

async function makeOldPath(path: string): Promise<void> {
  const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);

  await utimes(path, oldDate, oldDate);
}

async function insertGcLock(): Promise<void> {
  const database = await openStateDatabase(
    "tmp/gc.sqlite",
    `
CREATE TABLE IF NOT EXISTS gc_locks (
  scope TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  );
  const now = Date.now();

  try {
    await database.run(
      `
INSERT INTO gc_locks (
  scope, owner_id, owner_pid, heartbeat_at, created_at
) VALUES ('global', 'test-owner', ?, ?, ?)
`,
      [process.pid, now, now],
    );
  } finally {
    await database.close();
  }
}

async function insertLibraryLock(libraryId: number): Promise<void> {
  const database = await openStateDatabase(
    "core.sqlite",
    `
CREATE TABLE IF NOT EXISTS library_locks (
  library_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  );

  try {
    await database.run(
      `
INSERT INTO library_locks (
  library_id, mode, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, 'write', 'test-owner', ?, ?, ?)
`,
      [libraryId, process.pid, Date.now(), Date.now()],
    );
  } finally {
    await database.close();
  }
}

async function insertStateLibraryLock(libraryId: number): Promise<void> {
  const database = await openStateDatabase(
    "core.sqlite",
    `
CREATE TABLE IF NOT EXISTS state_locks (
  scope TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, resource_key, owner_id)
);
`,
  );

  try {
    await database.run(
      `
INSERT INTO state_locks (
  scope, resource_key, mode, owner_id, owner_pid, heartbeat_at, created_at
) VALUES ('library', ?, 'write', 'test-owner', ?, ?, ?)
`,
      [String(libraryId), process.pid, Date.now(), Date.now()],
    );
  } finally {
    await database.close();
  }
}

async function countRows(
  databaseName: string,
  tableName: string,
): Promise<number> {
  const database = await openStateDatabase(databaseName);

  try {
    return (
      (await database.queryOne(
        `SELECT COUNT(*) AS count FROM ${tableName}`,
        undefined,
        (row) => Number(row.count),
      )) ?? 0
    );
  } finally {
    await database.close();
  }
}

async function openStateDatabase(
  databaseName: string,
  schemaSql = "",
): Promise<Database> {
  const stateDirPath = resolveWikiGraphHomeDirectoryPath();

  await mkdir(dirname(join(stateDirPath, databaseName)), {
    recursive: true,
  });
  return await Database.open(join(stateDirPath, databaseName), schemaSql);
}

function restoreWikiGraphStateDir(value: string | undefined): void {
  setWikiGraphStateDirectoryPathForTesting(value);
}

import { mkdir, stat, utimes, writeFile } from "fs/promises";
import { dirname, join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getWikiGraphStateDirectoryPathForTesting,
  resolveWikiGraphHomeDirectoryPath,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../helpers/wiki-graph-storage.js";
import { Database } from "../../../../packages/core/src/document/index.js";
import { addBuildJob } from "../../../../packages/core/src/api/index.js";
import { createWikiGraphLibrary } from "../../../../packages/core/src/index.js";
import { tryRunWikiGraphGc } from "../../../../packages/core/src/runtime/gc/index.js";
import { createSearchSession } from "../../../../packages/core/src/retrieval/query/index.js";
import { WikipageCache } from "../../../../packages/core/src/external/wikipage/index.js";
import { withTempDir } from "../../../helpers/temp.js";
import {
  getNodeResourcePath,
  NodeDirectory,
  NodeFile,
} from "../../../../packages/cli/src/runtime/node-platform.js";

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
      const abandonedSessionPath = await createCoordinatorSession(path, {
        ageMs: 2 * 60 * 60 * 1000,
      });

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
      await expect(stat(abandonedSessionPath)).rejects.toThrow();
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

  it("treats a missing document store as empty", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));

      const report = await tryRunWikiGraphGc({ dryRun: true });
      const coordinatorJob = report.jobs.find(
        (item) => item.name === "wikg-coordinator",
      );

      expect(report.skipped).toBe(false);
      expect(coordinatorJob).toStrictEqual({
        freedBytes: 0,
        name: "wikg-coordinator",
        removed: 0,
        scanned: 0,
      });
    });
  });

  it("removes orphan library index staging while preserving valid and locked libraries", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      await mkdir(join(path, "library"));
      const library = await createWikiGraphLibrary({
        folder: new NodeDirectory(join(path, "library")),
      });
      const validPath = join(getNodeResourcePath(library.staging), "index");
      const orphanPath = join(path, "state", "staging", "library", "999");
      const lockedPath = join(path, "state", "staging", "library", "1000");
      const stateLockedPath = join(path, "state", "staging", "library", "1001");

      await mkdir(validPath, { recursive: true });
      await mkdir(orphanPath, { recursive: true });
      await mkdir(lockedPath, { recursive: true });
      await mkdir(stateLockedPath, { recursive: true });
      await writeFile(join(validPath, "index.db"), "valid", "utf8");
      await writeFile(join(orphanPath, "index.db"), "orphan", "utf8");
      await writeFile(join(lockedPath, "index.db"), "locked", "utf8");
      await writeFile(
        join(stateLockedPath, "index.db"),
        "state-locked",
        "utf8",
      );
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
      await writeFile(join(libraryPath, "index.db"), "library", "utf8");

      const report = await tryRunWikiGraphGc();
      const libraryIndexJob = report.jobs.find(
        (item) => item.name === "library-index",
      );

      expect(report.skipped).toBe(false);
      expect(libraryIndexJob).toMatchObject({ removed: 0, scanned: 0 });
      await expect(stat(libraryPath)).resolves.toBeDefined();
    });
  });

  it("keeps fresh host archive sessions during normal GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const sessionPath = await createCoordinatorSession(path, { ageMs: 0 });

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      expect(
        report.jobs.find((item) => item.name === "wikg-coordinator"),
      ).toMatchObject({ removed: 0, scanned: 1 });
      await expect(stat(sessionPath)).resolves.toBeDefined();
    });
  });

  it("removes fresh host archive sessions during forced GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const sessionPath = await createCoordinatorSession(path, { ageMs: 0 });

      const report = await tryRunWikiGraphGc({ force: true });

      expect(report.skipped).toBe(false);
      expect(
        report.jobs.find((item) => item.name === "wikg-coordinator"),
      ).toMatchObject({
        removed: 1,
        scanned: 1,
      });
      await expect(stat(sessionPath)).rejects.toThrow();
    });
  });

  it("removes derived archive search caches during forced GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const cachePath = join(
        path,
        "state",
        "documents",
        ".wikg-cache",
        "opaque-key",
      );
      await mkdir(cachePath, { recursive: true });
      await writeFile(join(cachePath, "index.db"), "cache", "utf8");

      const report = await tryRunWikiGraphGc({ force: true });

      expect(report.skipped).toBe(false);
      expect(
        report.jobs.find((item) => item.name === "wikg-coordinator"),
      ).toMatchObject({ removed: 1, scanned: 1 });
      await expect(stat(cachePath)).rejects.toThrow();
    });
  });

  it("reports abandoned host archive sessions without removing them during dry-run GC", async () => {
    await withTempDir("wikigraph-gc-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(join(path, "state"));
      const sessionPath = await createCoordinatorSession(path, {
        ageMs: 2 * 60 * 60 * 1000,
      });

      const report = await tryRunWikiGraphGc({ dryRun: true });

      expect(report.skipped).toBe(false);
      expect(
        report.jobs.find((item) => item.name === "wikg-coordinator"),
      ).toMatchObject({
        removed: 1,
        scanned: 1,
      });
      await expect(stat(sessionPath)).resolves.toBeDefined();
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

async function createCoordinatorSession(
  path: string,
  options: { readonly ageMs: number },
): Promise<string> {
  const sessionPath = join(path, "state", "documents", ".wikg-session-test");
  const artifactPath = join(sessionPath, "database.db");
  await mkdir(sessionPath, { recursive: true });
  await writeFile(artifactPath, "session data", "utf8");
  if (options.ageMs > 0) {
    const modifiedAt = new Date(Date.now() - options.ageMs);
    await utimes(artifactPath, modifiedAt, modifiedAt);
    await utimes(sessionPath, modifiedAt, modifiedAt);
  }
  return sessionPath;
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
    archive: new NodeFile(join(path, "book.wikg")),
    chapterId: 1,
    target: "reading-summary",
  });
  const workspacePath = getNodeResourcePath(job.workspace);
  const cachePath = getNodeResourcePath(job.cache);
  const logPath = getNodeResourcePath(job.log);
  const eventsPath = getNodeResourcePath(job.events);
  await mkdir(workspacePath, { recursive: true });
  await writeFile(join(workspacePath, "artifact.txt"), "artifact", "utf8");
  await writeFile(join(cachePath, "request.txt"), "cache", "utf8");
  await writeFile(join(logPath, "run.log"), "log", "utf8");
  await writeFile(eventsPath, "event\n", "utf8");

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

  return { cachePath, eventsPath, logPath, workspacePath };
}

async function createOldTmpDirectory(): Promise<string> {
  const tmpPath = join(
    resolveWikiGraphHomeDirectoryPath(),
    "tmp",
    "cli-output",
    `cli-output-${Date.now()}`,
  );
  await mkdir(tmpPath, { recursive: true });
  const filePath = join(tmpPath, "output.txt");
  const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);

  await writeFile(filePath, "temporary", "utf8");
  await utimes(filePath, oldDate, oldDate);
  await utimes(tmpPath, oldDate, oldDate);

  return tmpPath;
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
  return await Database.open(join(stateDirPath, databaseName), schemaSql, {
    create: true,
    mode: "readwrite",
  });
}

function restoreWikiGraphStateDir(value: string | undefined): void {
  setWikiGraphStateDirectoryPathForTesting(value);
}

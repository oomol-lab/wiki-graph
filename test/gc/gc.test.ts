import { mkdir, stat, utimes, writeFile } from "fs/promises";
import { dirname, join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { createWikiGraphTempDirectory } from "../../src/common/wiki-graph-temp.js";
import { Database } from "../../src/document/index.js";
import { addBuildJob } from "../../src/facade/index.js";
import { tryRunWikiGraphGc } from "../../src/gc/index.js";
import { createSearchSession } from "../../src/archive/query/index.js";
import { withTempDir } from "../helpers/temp.js";

const originalStateDir = process.env.WIKIGRAPH_STATE_DIR;

describe("gc", () => {
  afterEach(() => {
    restoreEnv("WIKIGRAPH_STATE_DIR", originalStateDir);
  });

  it("cleans expired search sessions, completed jobs, and old controlled tmp directories", async () => {
    await withTempDir("spinedigest-gc-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = join(path, "state");

      await createExpiredSearchSession();
      const job = await createCompletedOldJob(path);
      const tmpPath = await createOldTmpDirectory();
      const sqliteCachePath = await createOldCoordinatorSqliteCache(path);
      const sqliteCacheParentPath = dirname(sqliteCachePath);
      const jobParentPath = dirname(job.workspacePath);

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      expect(report.jobs.map((item) => item.name)).toStrictEqual([
        "wikg-coordinator",
        "search-cache",
        "build-queue",
        "tmp",
      ]);
      expect(report.removed).toBeGreaterThanOrEqual(3);
      await expect(stat(sqliteCachePath)).rejects.toThrow();
      await expect(stat(sqliteCacheParentPath)).rejects.toThrow();
      await expect(stat(tmpPath)).rejects.toThrow();
      await expect(stat(job.workspacePath)).rejects.toThrow();
      await expect(stat(jobParentPath)).rejects.toThrow();
      await expect(stat(job.eventsPath)).rejects.toThrow();
      await expect(
        countRows("cache/search-sessions.sqlite", "search_sessions"),
      ).resolves.toBe(0);
      await expect(countRows("jobs/job.sqlite", "build_jobs")).resolves.toBe(0);
    });
  });

  it("skips when another GC run owns the global lock", async () => {
    await withTempDir("spinedigest-gc-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = join(path, "state");
      await insertGcLock();

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(true);
      expect(report.jobs).toStrictEqual([]);
    });
  });

  it("keeps fresh sqlite cache during normal GC", async () => {
    await withTempDir("spinedigest-gc-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = join(path, "state");
      const sqliteCachePath = await createCoordinatorSqliteCache(path, {
        updatedAt: Date.now(),
      });

      const report = await tryRunWikiGraphGc();

      expect(report.skipped).toBe(false);
      await expect(stat(sqliteCachePath)).resolves.toBeDefined();
    });
  });

  it("removes fresh sqlite cache during forced GC", async () => {
    await withTempDir("spinedigest-gc-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = join(path, "state");
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

  it("removes stale empty workspace bucket directories", async () => {
    await withTempDir("spinedigest-gc-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = join(path, "state");
      const workspaceBucketPath = join(
        path,
        "state",
        "staging",
        "work",
        "archive-key",
      );
      const buildJobBucketPath = join(
        path,
        "state",
        "jobs",
        "work",
        "archive-key",
      );

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

  it("keeps external fts sqlite cache during normal GC and removes it during forced GC", async () => {
    await withTempDir("spinedigest-gc-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = join(path, "state");
      const sqliteCachePath = await createCoordinatorSqliteCache(path, {
        entryPath: "fts.db",
        updatedAt: Date.now() - 2 * 60 * 60 * 1000,
      });

      const normalReport = await tryRunWikiGraphGc();

      expect(normalReport.skipped).toBe(false);
      await expect(stat(sqliteCachePath)).resolves.toBeDefined();

      const forcedReport = await tryRunWikiGraphGc({ force: true });

      expect(forcedReport.skipped).toBe(false);
      expect(
        forcedReport.jobs.find((item) => item.name === "wikg-coordinator"),
      ).toMatchObject({
        removed: 1,
        scanned: 1,
      });
      await expect(stat(sqliteCachePath)).rejects.toThrow();
    });
  });

  it("removes orphaned coordinator workspace files", async () => {
    await withTempDir("spinedigest-gc-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = join(path, "state");
      const workspaceBucketPath = join(
        path,
        "state",
        "staging",
        "work",
        "archive-key",
      );
      const referencedPath = join(workspaceBucketPath, "book-meta.json");
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
        entryPath: "book-meta.json",
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

  it("keeps fresh terminal build jobs during normal GC", async () => {
    await withTempDir("spinedigest-gc-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = join(path, "state");
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
      await expect(countRows("jobs/job.sqlite", "build_jobs")).resolves.toBe(1);
    });
  });

  it("removes fresh terminal build jobs during forced GC", async () => {
    await withTempDir("spinedigest-gc-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = join(path, "state");
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
      await expect(countRows("jobs/job.sqlite", "build_jobs")).resolves.toBe(0);
    });
  });
});

async function createOldCoordinatorSqliteCache(path: string): Promise<string> {
  return await createCoordinatorSqliteCache(path, {
    updatedAt: Date.now() - 2 * 60 * 60 * 1000,
  });
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

async function createCompletedOldJob(path: string): Promise<{
  readonly eventsPath: string;
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
  readonly eventsPath: string;
  readonly workspacePath: string;
}> {
  const job = await addBuildJob({
    archivePath: join(path, "book.wikg"),
    chapterId: 1,
    target: "reading-summary",
  });
  await mkdir(job.workspacePath, { recursive: true });
  await writeFile(join(job.workspacePath, "artifact.txt"), "artifact", "utf8");
  await writeFile(join(dirname(job.workspacePath), ".DS_Store"), "finder");
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
  if (process.env.WIKIGRAPH_STATE_DIR === undefined) {
    throw new Error("WIKIGRAPH_STATE_DIR is not set.");
  }

  await mkdir(dirname(join(process.env.WIKIGRAPH_STATE_DIR, databaseName)), {
    recursive: true,
  });
  return await Database.open(
    join(process.env.WIKIGRAPH_STATE_DIR, databaseName),
    schemaSql,
  );
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

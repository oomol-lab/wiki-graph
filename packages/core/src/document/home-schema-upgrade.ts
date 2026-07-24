import { mkdir, rm, stat } from "fs/promises";
import { dirname, join, resolve } from "path";

import {
  resolveWikiGraphCacheDatabasePath,
  resolveWikiGraphCacheDirectoryPath,
  resolveWikiGraphCoreDatabasePath,
  resolveWikiGraphJobsDirectoryPath,
  resolveWikiGraphStagingDirectoryPath,
  resolveWikiGraphTempRootDirectoryPath,
} from "../runtime/common/wiki-graph/dir.js";
import { isNodeError } from "../utils/node-error.js";

import { Database } from "./database.js";

const CURRENT_HOME_SCHEMA_VERSION = 2;
const LOCK_STALE_TIMEOUT_MS = 5 * 60 * 1000;
const SEARCH_INDEX_DATABASE_PATH = "fts.db";
let homeSchemaUpgradeInFlight: Promise<void> | undefined;
let currentHomeSchemaDatabaseMemo: HomeSchemaDatabaseMemo | undefined;
const HOME_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS schema_versions (
    scope TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

interface HomeSchemaDatabaseFingerprint {
  readonly dev: number;
  readonly ino: number;
  readonly mtimeMs: number;
  readonly size: number;
}

interface HomeSchemaDatabaseMemo {
  readonly fingerprint: HomeSchemaDatabaseFingerprint;
  readonly path: string;
}

export async function ensureWikiGraphHomeSchemaCurrent(): Promise<void> {
  const coreDatabasePath = resolveWikiGraphCoreDatabasePath();
  const resolvedCoreDatabasePath = resolve(coreDatabasePath);
  const fingerprint = await readHomeSchemaDatabaseFingerprint(coreDatabasePath);

  if (isCurrentHomeSchemaDatabaseMemo(resolvedCoreDatabasePath, fingerprint)) {
    return;
  }

  if (homeSchemaUpgradeInFlight !== undefined) {
    await homeSchemaUpgradeInFlight;
    const refreshedFingerprint =
      await readHomeSchemaDatabaseFingerprint(coreDatabasePath);
    if (
      isCurrentHomeSchemaDatabaseMemo(
        resolvedCoreDatabasePath,
        refreshedFingerprint,
      )
    ) {
      return;
    }
  }

  const refreshedFingerprint =
    await readHomeSchemaDatabaseFingerprint(coreDatabasePath);

  if (homeSchemaUpgradeInFlight !== undefined) {
    await homeSchemaUpgradeInFlight;
    return ensureWikiGraphHomeSchemaCurrent();
  }

  if (
    isCurrentHomeSchemaDatabaseMemo(
      resolvedCoreDatabasePath,
      refreshedFingerprint,
    )
  ) {
    return;
  }

  homeSchemaUpgradeInFlight = (async () => {
    if (!(await pathExists(coreDatabasePath))) {
      await writeHomeSchemaVersion(
        coreDatabasePath,
        CURRENT_HOME_SCHEMA_VERSION,
      );
      await memoizeCurrentHomeSchemaDatabase(resolvedCoreDatabasePath);
      return;
    }

    const schemaVersion =
      await readWikiGraphHomeSchemaVersion(coreDatabasePath);

    if (schemaVersion > CURRENT_HOME_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported Wiki Graph home schema version: ${schemaVersion}.`,
      );
    }

    if (schemaVersion < CURRENT_HOME_SCHEMA_VERSION) {
      await assertHomeUpgradeSafe();
      await cleanupHomeDerivedData();
      await writeHomeSchemaVersion(
        coreDatabasePath,
        CURRENT_HOME_SCHEMA_VERSION,
      );
    }

    await memoizeCurrentHomeSchemaDatabase(resolvedCoreDatabasePath);
  })();

  try {
    await homeSchemaUpgradeInFlight;
    return;
  } finally {
    homeSchemaUpgradeInFlight = undefined;
  }
}

async function memoizeCurrentHomeSchemaDatabase(
  resolvedCoreDatabasePath: string,
): Promise<void> {
  const fingerprint = await readHomeSchemaDatabaseFingerprint(
    resolvedCoreDatabasePath,
  );

  if (fingerprint === undefined) {
    currentHomeSchemaDatabaseMemo = undefined;
    return;
  }

  currentHomeSchemaDatabaseMemo = {
    fingerprint,
    path: resolvedCoreDatabasePath,
  };
}

async function readHomeSchemaDatabaseFingerprint(
  coreDatabasePath: string,
): Promise<HomeSchemaDatabaseFingerprint | undefined> {
  try {
    const stats = await stat(coreDatabasePath);

    return {
      dev: stats.dev,
      ino: stats.ino,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function isCurrentHomeSchemaDatabaseMemo(
  resolvedCoreDatabasePath: string,
  fingerprint: HomeSchemaDatabaseFingerprint | undefined,
): boolean {
  if (
    fingerprint === undefined ||
    currentHomeSchemaDatabaseMemo === undefined
  ) {
    return false;
  }

  return (
    currentHomeSchemaDatabaseMemo.path === resolvedCoreDatabasePath &&
    isSameHomeSchemaDatabaseFingerprint(
      currentHomeSchemaDatabaseMemo.fingerprint,
      fingerprint,
    )
  );
}

function isSameHomeSchemaDatabaseFingerprint(
  left: HomeSchemaDatabaseFingerprint,
  right: HomeSchemaDatabaseFingerprint,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

export async function readWikiGraphHomeSchemaVersion(
  coreDatabasePath = resolveWikiGraphCoreDatabasePath(),
): Promise<number> {
  if (!(await pathExists(coreDatabasePath))) {
    return 0;
  }

  const database = await Database.open(coreDatabasePath, "", {
    readonly: true,
  });

  try {
    if (!(await tableExists(database, "schema_versions"))) {
      return 1;
    }

    const version = await database.queryOne(
      "SELECT version FROM schema_versions WHERE scope = ?",
      ["home"],
      (row) => Number(row.version),
    );

    return version ?? 1;
  } finally {
    await database.close();
  }
}

export function isWikiGraphHomeSchemaGateDatabasePath(
  databasePath: string,
): boolean {
  const resolvedDatabasePath = resolve(databasePath);

  return getWikiGraphHomeSchemaGateDatabasePaths().some(
    (gatePath) => resolvedDatabasePath === resolve(gatePath),
  );
}

function getWikiGraphHomeSchemaGateDatabasePaths(): readonly string[] {
  const cacheDirectoryPath = resolveWikiGraphCacheDirectoryPath();

  return [
    resolveWikiGraphCoreDatabasePath(),
    join(cacheDirectoryPath, "search-sessions.sqlite"),
    join(cacheDirectoryPath, "continuation-cursors.sqlite"),
    resolveWikiGraphCacheDatabasePath(),
    join(resolveWikiGraphJobsDirectoryPath(), "job.sqlite"),
    join(resolveWikiGraphTempRootDirectoryPath(), "gc.sqlite"),
    join(resolveWikiGraphStagingDirectoryPath(), "staging.sqlite"),
  ];
}

async function writeHomeSchemaVersion(
  coreDatabasePath: string,
  version: number,
): Promise<void> {
  await mkdir(dirname(coreDatabasePath), { recursive: true });
  const database = await Database.open(coreDatabasePath);

  try {
    await database.run(HOME_SCHEMA_SQL);
    await database.run(
      `
        INSERT INTO schema_versions (scope, version, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(scope) DO UPDATE SET
          version = excluded.version,
          updated_at = excluded.updated_at
      `,
      ["home", version, new Date().toISOString()],
    );
  } finally {
    await database.close();
  }
}

async function cleanupHomeDerivedData(): Promise<void> {
  const cacheDirectoryPath = resolveWikiGraphCacheDirectoryPath();
  const stagingDirectoryPath = resolveWikiGraphStagingDirectoryPath();
  const jobsDirectoryPath = resolveWikiGraphJobsDirectoryPath();
  const tempDirectoryPath = resolveWikiGraphTempRootDirectoryPath();

  await deletePathIfExists(join(cacheDirectoryPath, "search-sessions.sqlite"));
  await deletePathIfExists(
    join(cacheDirectoryPath, "continuation-cursors.sqlite"),
  );
  await deletePathIfExists(resolveWikiGraphCacheDatabasePath());
  await deletePathIfExists(join(stagingDirectoryPath, "library"));
  await deletePathIfExists(join(tempDirectoryPath, "gc.sqlite"));
  await deletePathIfExists(join(tempDirectoryPath, "gc.last-run"));
  await deletePathIfExists(join(jobsDirectoryPath, "cache"));
  await deletePathIfExists(join(jobsDirectoryPath, "job.sqlite"));

  const stagingDatabasePath = join(stagingDirectoryPath, "staging.sqlite");
  if (await pathExists(stagingDatabasePath)) {
    await removeArchiveSearchIndexOverlays(stagingDatabasePath);
  }
}

async function assertHomeUpgradeSafe(): Promise<void> {
  await assertCoreLocksSafe();
  await assertGcLockSafe();
  await assertCoordinatorStateSafe();
  await assertBuildQueueSafe();
}

async function assertCoreLocksSafe(): Promise<void> {
  const coreDatabasePath = resolveWikiGraphCoreDatabasePath();

  if (!(await pathExists(coreDatabasePath))) {
    return;
  }

  const database = await Database.open(coreDatabasePath, "", {
    readonly: true,
  });

  try {
    if (await tableExists(database, "library_locks")) {
      const rows = await database.queryAll(
        `
          SELECT owner_pid, heartbeat_at
          FROM library_locks
        `,
        undefined,
        (row) => ({
          heartbeatAt: Number(row.heartbeat_at),
          ownerPid: Number(row.owner_pid),
        }),
      );

      if (rows.some((row) => isActiveLock(row.ownerPid, row.heartbeatAt))) {
        throw new Error("Cannot upgrade home with active library locks.");
      }
    }

    if (!(await tableExists(database, "state_locks"))) {
      return;
    }

    const stateLockRows = await database.queryAll(
      `
        SELECT owner_pid, heartbeat_at
        FROM state_locks
        WHERE scope = 'library'
      `,
      undefined,
      (row) => ({
        heartbeatAt: Number(row.heartbeat_at),
        ownerPid: Number(row.owner_pid),
      }),
    );

    if (
      stateLockRows.some((row) => isActiveLock(row.ownerPid, row.heartbeatAt))
    ) {
      throw new Error("Cannot upgrade home with active library locks.");
    }
  } finally {
    await database.close();
  }
}

async function assertGcLockSafe(): Promise<void> {
  const gcDatabasePath = join(
    resolveWikiGraphTempRootDirectoryPath(),
    "gc.sqlite",
  );

  if (!(await pathExists(gcDatabasePath))) {
    return;
  }

  const database = await Database.open(gcDatabasePath, "", {
    readonly: true,
  });

  try {
    if (!(await tableExists(database, "gc_locks"))) {
      return;
    }

    const rows = await database.queryAll(
      "SELECT owner_pid, heartbeat_at FROM gc_locks",
      undefined,
      (row) => ({
        heartbeatAt: Number(row.heartbeat_at),
        ownerPid: Number(row.owner_pid),
      }),
    );

    if (rows.some((row) => isActiveLock(row.ownerPid, row.heartbeatAt))) {
      throw new Error("Cannot upgrade home with an active GC lock.");
    }
  } finally {
    await database.close();
  }
}

async function assertCoordinatorStateSafe(): Promise<void> {
  const stagingDatabasePath = join(
    resolveWikiGraphStagingDirectoryPath(),
    "staging.sqlite",
  );

  if (!(await pathExists(stagingDatabasePath))) {
    return;
  }

  const database = await Database.open(stagingDatabasePath, "", {
    readonly: true,
  });

  try {
    for (const tableName of [
      "archive_owners",
      "entry_locks",
      "entry_sqlite_leases",
      "archive_commit_locks",
    ]) {
      if (!(await tableExists(database, tableName))) {
        continue;
      }

      const rows = await database.queryAll(
        `
          SELECT owner_pid, heartbeat_at
          FROM ${tableName}
        `,
        undefined,
        (row) => ({
          heartbeatAt: Number(row.heartbeat_at),
          ownerPid: Number(row.owner_pid),
        }),
      );

      if (rows.some((row) => isActiveLock(row.ownerPid, row.heartbeatAt))) {
        throw new Error(
          `Cannot upgrade home with active coordinator state: ${tableName}.`,
        );
      }
    }

    if (!(await tableExists(database, "entry_overlays"))) {
      return;
    }

    const overlays = await database.queryAll(
      `
        SELECT entry_path
        FROM entry_overlays
      `,
      undefined,
      (row) => String(row.entry_path),
    );

    const problematicOverlay = overlays.find(
      (entryPath) => entryPath !== SEARCH_INDEX_DATABASE_PATH,
    );
    if (problematicOverlay !== undefined) {
      throw new Error(
        "Cannot upgrade home with non-derived coordinator overlays.",
      );
    }
  } finally {
    await database.close();
  }
}

async function assertBuildQueueSafe(): Promise<void> {
  const jobsDatabasePath = join(
    resolveWikiGraphJobsDirectoryPath(),
    "job.sqlite",
  );

  if (!(await pathExists(jobsDatabasePath))) {
    return;
  }

  const database = await Database.open(jobsDatabasePath, "", {
    readonly: true,
  });

  try {
    if (await tableExists(database, "build_jobs")) {
      const activeJobs = await database.queryAll(
        `
          SELECT job_id
          FROM build_jobs
          WHERE state IN ('queued', 'running', 'canceling', 'paused')
        `,
        undefined,
        (row) => String(row.job_id),
      );

      if (activeJobs.length > 0) {
        throw new Error("Cannot upgrade home with active build jobs.");
      }
    }

    if (await tableExists(database, "build_worker_lease")) {
      const lease = await database.queryOne(
        `
          SELECT owner_pid, heartbeat_at
          FROM build_worker_lease
          WHERE id = 1
        `,
        undefined,
        (row) => ({
          heartbeatAt:
            row.heartbeat_at === null ? undefined : Number(row.heartbeat_at),
          ownerPid: row.owner_pid === null ? undefined : Number(row.owner_pid),
        }),
      );

      if (
        lease?.ownerPid !== undefined &&
        lease.heartbeatAt !== undefined &&
        isActiveLock(lease.ownerPid, lease.heartbeatAt)
      ) {
        throw new Error(
          "Cannot upgrade home with an active build worker lease.",
        );
      }
    }
  } finally {
    await database.close();
  }
}

async function removeArchiveSearchIndexOverlays(
  stagingDatabasePath: string,
  archiveKey?: string,
): Promise<void> {
  const database = await Database.open(stagingDatabasePath);

  try {
    if (!(await tableExists(database, "entry_overlays"))) {
      return;
    }

    const whereClause =
      archiveKey === undefined
        ? "WHERE entry_path = ?"
        : "WHERE archive_key = ? AND entry_path = ?";
    const parameters =
      archiveKey === undefined
        ? [SEARCH_INDEX_DATABASE_PATH]
        : [archiveKey, SEARCH_INDEX_DATABASE_PATH];
    const overlays = await database.queryAll(
      `
        SELECT archive_key, workspace_path
        FROM entry_overlays
        ${whereClause}
      `,
      parameters,
      (row) => ({
        archiveKey: String(row.archive_key),
        workspacePath:
          row.workspace_path === null ? undefined : String(row.workspace_path),
      }),
    );

    for (const overlay of overlays) {
      if (overlay.workspacePath !== undefined) {
        await deletePathIfExists(overlay.workspacePath);
      }
    }

    await database.run(
      `
        DELETE FROM entry_overlays
        ${whereClause}
      `,
      parameters,
    );
  } finally {
    await database.close();
  }
}

async function tableExists(
  database: Database,
  tableName: string,
): Promise<boolean> {
  const row = await database.queryOne(
    `
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `,
    [tableName],
    () => true,
  );

  return row === true;
}

function isActiveLock(ownerPid: number, heartbeatAt: number): boolean {
  return (
    Date.now() - heartbeatAt <= LOCK_STALE_TIMEOUT_MS &&
    isProcessAlive(ownerPid)
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function deletePathIfExists(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

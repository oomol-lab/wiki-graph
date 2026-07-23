import { randomUUID } from "crypto";
import { mkdir, rename, rm, stat } from "fs/promises";
import { dirname, join, resolve } from "path";

import { Database } from "../../document/database.js";
import {
  resolveWikiGraphCacheDatabasePath,
  resolveWikiGraphCoreDatabasePath,
  resolveWikiGraphHomeDirectoryPath,
  resolveWikiGraphJobsDirectoryPath,
  resolveWikiGraphStagingDirectoryPath,
  resolveWikiGraphTempRootDirectoryPath,
} from "../../runtime/common/wiki-graph/dir.js";
import {
  SEARCH_INDEX_DATABASE_PATH,
  WIKG_MANIFEST_PATH,
} from "../wikg/archive/constants.js";
import { parseWikgManifest } from "../wikg/archive/manifest.js";
import { normalizeArchivePath } from "../wikg/archive/paths.js";
import {
  openIndexedArchive,
  readArchiveEntryText,
} from "../wikg/archive/zip.js";
import { writeWikgArchiveWithOverlays } from "../wikg/archive/write.js";
import { createArchiveKey } from "../wikg/wikg-coordinator/archive-key.js";

const CURRENT_ARCHIVE_SCHEMA_VERSION = 2;
const CURRENT_HOME_SCHEMA_VERSION = 2;
const LOCK_STALE_TIMEOUT_MS = 5 * 60 * 1000;
let homeSchemaUpgradeInFlight: Promise<void> | undefined;
const HOME_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS schema_versions (
    scope TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export async function ensureWikiGraphArchiveSchemaCurrent(
  archivePath: string,
): Promise<void> {
  const schemaVersion = await readWikiGraphArchiveSchemaVersion(archivePath);

  if (schemaVersion > CURRENT_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Wiki Graph archive schema version: ${schemaVersion}.`,
    );
  }
  if (schemaVersion < CURRENT_ARCHIVE_SCHEMA_VERSION) {
    await upgradeWikiGraphArchiveSchema(archivePath);
  }
}

export async function readWikiGraphArchiveSchemaVersion(
  archivePath: string,
): Promise<number> {
  const { entries, zipFile } = await openIndexedArchive(resolve(archivePath));

  try {
    const manifestEntry = entries.find(
      (entry) => normalizeArchivePath(entry.fileName) === WIKG_MANIFEST_PATH,
    );

    if (manifestEntry === undefined) {
      throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
    }

    return parseWikgManifest(
      await readArchiveEntryText(resolve(archivePath), manifestEntry),
    ).schemaVersion;
  } finally {
    zipFile.close();
  }
}

export async function upgradeWikiGraphArchiveSchema(
  archivePath: string,
): Promise<void> {
  const resolvedArchivePath = resolve(archivePath);
  const schemaVersion =
    await readWikiGraphArchiveSchemaVersion(resolvedArchivePath);

  if (schemaVersion === CURRENT_ARCHIVE_SCHEMA_VERSION) {
    return;
  }

  if (schemaVersion > CURRENT_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Wiki Graph archive schema version: ${schemaVersion}.`,
    );
  }

  await ensureWikiGraphHomeSchemaCurrent();

  const archiveKey = createArchiveKey(resolvedArchivePath);
  await assertArchiveUpgradeSafe(archiveKey);

  const temporaryPath = join(
    dirname(resolvedArchivePath),
    `.${getArchiveBasename(resolvedArchivePath)}.${process.pid}.${randomUUID()}.upgrade.tmp`,
  );

  await writeWikgArchiveWithOverlays(
    resolvedArchivePath,
    temporaryPath,
    [
      {
        entryPath: SEARCH_INDEX_DATABASE_PATH,
        kind: "deleted",
      },
    ],
    { preserveMutationToken: true },
  );
  await rename(temporaryPath, resolvedArchivePath);
  await cleanupArchiveDerivedData(archiveKey);
}

export async function ensureWikiGraphHomeSchemaCurrent(): Promise<void> {
  if (homeSchemaUpgradeInFlight !== undefined) {
    await homeSchemaUpgradeInFlight;
    return;
  }

  homeSchemaUpgradeInFlight = (async () => {
    const coreDatabasePath = resolveWikiGraphCoreDatabasePath();
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
  })();

  try {
    await homeSchemaUpgradeInFlight;
    return;
  } finally {
    homeSchemaUpgradeInFlight = undefined;
  }
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
  const homeDirectoryPath = resolveWikiGraphHomeDirectoryPath();
  const cacheDirectoryPath = join(homeDirectoryPath, "cache");
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

  const stagingDatabasePath = join(stagingDirectoryPath, "staging.sqlite");
  if (await pathExists(stagingDatabasePath)) {
    await removeArchiveSearchIndexOverlays(stagingDatabasePath);
  }
}

async function cleanupArchiveDerivedData(archiveKey: string): Promise<void> {
  const cacheDirectoryPath = join(resolveWikiGraphHomeDirectoryPath(), "cache");
  await deletePathIfExists(join(cacheDirectoryPath, "search-sessions.sqlite"));
  await deletePathIfExists(
    join(cacheDirectoryPath, "continuation-cursors.sqlite"),
  );

  const stagingDatabasePath = join(
    resolveWikiGraphStagingDirectoryPath(),
    "staging.sqlite",
  );
  if (await pathExists(stagingDatabasePath)) {
    await removeArchiveSearchIndexOverlays(stagingDatabasePath, archiveKey);
  }
}

async function assertArchiveUpgradeSafe(archiveKey: string): Promise<void> {
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
          WHERE archive_key = ?
        `,
        [archiveKey],
        (row) => ({
          heartbeatAt: Number(row.heartbeat_at),
          ownerPid: Number(row.owner_pid),
        }),
      );

      if (rows.some((row) => isActiveLock(row.ownerPid, row.heartbeatAt))) {
        throw new Error(
          `Cannot upgrade archive with active coordinator state: ${archiveKey}.`,
        );
      }
    }

    if (await tableExists(database, "entry_overlays")) {
      const overlays = await database.queryAll(
        `
          SELECT entry_path
          FROM entry_overlays
          WHERE archive_key = ?
        `,
        [archiveKey],
        (row) => String(row.entry_path),
      );

      const problematicOverlay = overlays.find(
        (entryPath) => entryPath !== SEARCH_INDEX_DATABASE_PATH,
      );
      if (problematicOverlay !== undefined) {
        throw new Error(
          `Cannot upgrade archive with non-derived overlay state: ${archiveKey}.`,
        );
      }
    }
  } finally {
    await database.close();
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
    if (!(await tableExists(database, "library_locks"))) {
      return;
    }

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
        SELECT entry_path, workspace_path
        FROM entry_overlays
      `,
      undefined,
      (row) => ({
        entryPath: String(row.entry_path),
        workspacePath:
          row.workspace_path === null ? undefined : String(row.workspace_path),
      }),
    );

    const problematicOverlay = overlays.find(
      (overlay) => overlay.entryPath !== SEARCH_INDEX_DATABASE_PATH,
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

function getArchiveBasename(archivePath: string): string {
  return archivePath.split(/[\\/]/u).pop() ?? "archive.wikg";
}

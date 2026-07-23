import { randomUUID } from "crypto";
import { rename, rm, stat } from "fs/promises";
import { dirname, join, resolve } from "path";

import { Database } from "../../document/database.js";
import { ensureWikiGraphHomeSchemaCurrent } from "../../document/home-schema-upgrade.js";
import {
  resolveWikiGraphHomeDirectoryPath,
  resolveWikiGraphStagingDirectoryPath,
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

export {
  ensureWikiGraphHomeSchemaCurrent,
  readWikiGraphHomeSchemaVersion,
} from "../../document/home-schema-upgrade.js";

const CURRENT_ARCHIVE_SCHEMA_VERSION = 2;
const LOCK_STALE_TIMEOUT_MS = 5 * 60 * 1000;

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

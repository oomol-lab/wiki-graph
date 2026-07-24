import { getNumber, getString, type Database } from "../document/database.js";
import { openSharedStateDatabase } from "../document/index.js";
import { resolveWikiGraphCoreDatabasePath } from "../runtime/common/wiki-graph/dir.js";
import {
  acquireStateLock,
  isStateLocked,
  withStateLock,
  type StateLockMode,
} from "../state-lock.js";
import { isNodeError } from "../utils/node-error.js";

const LEGACY_LIBRARY_LOCK_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS library_locks (
    library_id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    owner_pid INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`;
const LIBRARY_LOCK_SCOPE = "library";
const LIBRARY_LOCK_STALE_MS = 5 * 60 * 1000;

export type LibraryLockMode = StateLockMode;

export async function withWikiGraphLibraryLock<T>(
  libraryId: number,
  mode: LibraryLockMode,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await withStateLock(
    createLibraryLockOptions(libraryId, mode),
    operation,
  );
}

export async function acquireWikiGraphLibraryLock(
  libraryId: number,
  mode: LibraryLockMode,
): Promise<() => Promise<void>> {
  const release = await acquireStateLock(
    createLibraryLockOptions(libraryId, mode),
  );

  if (release === undefined) {
    throw new Error("Wiki Graph library lock was not acquired.");
  }

  return release;
}

export async function tryAcquireWikiGraphLibraryLock(
  libraryId: number,
  mode: LibraryLockMode,
): Promise<(() => Promise<void>) | undefined> {
  return await acquireStateLock({
    ...createLibraryLockOptions(libraryId, mode),
    wait: false,
  });
}

export async function isWikiGraphLibraryLocked(
  libraryId: number,
): Promise<boolean> {
  return (
    (await isStateLocked({
      databasePath: resolveWikiGraphCoreDatabasePath(),
      resourceKey: formatLibraryResourceKey(libraryId),
      scope: LIBRARY_LOCK_SCOPE,
      staleMs: LIBRARY_LOCK_STALE_MS,
    })) || (await isLegacyWikiGraphLibraryLocked(libraryId))
  );
}

function createLibraryLockOptions(libraryId: number, mode: LibraryLockMode) {
  return {
    databasePath: resolveWikiGraphCoreDatabasePath(),
    mode,
    resourceKey: formatLibraryResourceKey(libraryId),
    scope: LIBRARY_LOCK_SCOPE,
    staleMs: LIBRARY_LOCK_STALE_MS,
  };
}

function formatLibraryResourceKey(libraryId: number): string {
  return String(libraryId);
}

async function isLegacyWikiGraphLibraryLocked(
  libraryId: number,
): Promise<boolean> {
  const database = await openLegacyLibraryLockDatabase();

  try {
    const existing = await database.queryOne(
      "SELECT owner_pid, heartbeat_at FROM library_locks WHERE library_id = ?",
      [libraryId],
      (row) => ({
        heartbeatAt: getNumber(row, "heartbeat_at"),
        ownerPid: getNumber(row, "owner_pid"),
      }),
    );

    return existing !== undefined && isLockActive(existing);
  } finally {
    await database.close();
  }
}

async function openLegacyLibraryLockDatabase(): Promise<Database> {
  const database = await openSharedStateDatabase(
    resolveWikiGraphCoreDatabasePath(),
    LEGACY_LIBRARY_LOCK_SCHEMA_SQL,
  );

  await ensureLegacyLibraryLockColumns(database);
  return database;
}

async function ensureLegacyLibraryLockColumns(
  database: Database,
): Promise<void> {
  const columns = new Set(
    await database.queryAll(
      "PRAGMA table_info(library_locks)",
      undefined,
      (row) => getString(row, "name"),
    ),
  );

  if (!columns.has("heartbeat_at")) {
    await database.run(
      "ALTER TABLE library_locks ADD COLUMN heartbeat_at INTEGER NOT NULL DEFAULT 0",
    );
  }
}

function isLockActive(lock: {
  readonly heartbeatAt: number;
  readonly ownerPid: number;
}): boolean {
  return (
    Date.now() - lock.heartbeatAt <= LIBRARY_LOCK_STALE_MS &&
    isProcessAlive(lock.ownerPid)
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") {
      return false;
    }

    return true;
  }
}

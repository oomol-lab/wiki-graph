import { randomUUID } from "crypto";

import { openSharedStateDatabase, type Database } from "../document/index.js";
import { getNumber, getString } from "../document/database.js";
import { resolveWikiGraphCoreDatabasePath } from "../runtime/common/wiki-graph/dir.js";

const LIBRARY_LOCK_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS library_locks (
    library_id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    owner_pid INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

const LIBRARY_LOCK_HEARTBEAT_INTERVAL_MS = 15_000;
const LIBRARY_LOCK_STALE_MS = 5 * 60 * 1000;

export type LibraryLockMode = "read" | "write";

export async function withWikiGraphLibraryLock<T>(
  libraryId: number,
  mode: LibraryLockMode,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireWikiGraphLibraryLock(libraryId, mode);

  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function acquireWikiGraphLibraryLock(
  libraryId: number,
  mode: LibraryLockMode,
): Promise<() => Promise<void>> {
  const ownerId = `${process.pid}-${randomUUID()}`;
  const database = await openLibraryLockDatabase();

  try {
    await database.transaction(async () => {
      const existing = await database.queryOne(
        "SELECT mode, owner_id, owner_pid, heartbeat_at FROM library_locks WHERE library_id = ?",
        [libraryId],
        (row) => ({
          heartbeatAt: getNumber(row, "heartbeat_at"),
          mode: getString(row, "mode"),
          ownerId: getString(row, "owner_id"),
          ownerPid: getNumber(row, "owner_pid"),
        }),
      );

      if (existing !== undefined) {
        if (isLockActive(existing)) {
          throw new Error(
            `Wiki Graph library is locked for ${existing.mode}: ${libraryId}.`,
          );
        }
        await database.run(
          "DELETE FROM library_locks WHERE library_id = ? AND owner_id = ?",
          [libraryId, existing.ownerId],
        );
      }

      await database.run(
        `
          INSERT INTO library_locks (
            library_id, mode, owner_id, owner_pid, heartbeat_at, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [libraryId, mode, ownerId, process.pid, Date.now(), Date.now()],
      );
    });
  } finally {
    await database.close();
  }

  const heartbeat = setInterval(() => {
    void updateLibraryLockHeartbeat(libraryId, ownerId).catch(() => undefined);
  }, LIBRARY_LOCK_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  return async () => {
    clearInterval(heartbeat);
    const releaseDatabase = await openLibraryLockDatabase();

    try {
      await releaseDatabase.run(
        "DELETE FROM library_locks WHERE library_id = ? AND owner_id = ?",
        [libraryId, ownerId],
      );
    } finally {
      await releaseDatabase.close();
    }
  };
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
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

export async function isWikiGraphLibraryLocked(
  libraryId: number,
): Promise<boolean> {
  return await withLibraryLockDatabase(async (database) => {
    const existing = await database.queryOne(
      "SELECT owner_pid, heartbeat_at FROM library_locks WHERE library_id = ?",
      [libraryId],
      (row) => ({
        heartbeatAt: getNumber(row, "heartbeat_at"),
        ownerPid: getNumber(row, "owner_pid"),
      }),
    );

    return existing !== undefined && isLockActive(existing);
  });
}

async function updateLibraryLockHeartbeat(
  libraryId: number,
  ownerId: string,
): Promise<void> {
  await withLibraryLockDatabase(async (database) => {
    await database.run(
      `
UPDATE library_locks
SET heartbeat_at = ?
WHERE library_id = ?
  AND owner_id = ?
`,
      [Date.now(), libraryId, ownerId],
    );
  });
}

async function withLibraryLockDatabase<T>(
  operation: (database: Database) => Promise<T>,
): Promise<T> {
  const database = await openLibraryLockDatabase();

  try {
    return await operation(database);
  } finally {
    await database.close();
  }
}

async function openLibraryLockDatabase(): Promise<Database> {
  const database = await openSharedStateDatabase(
    resolveWikiGraphCoreDatabasePath(),
    LIBRARY_LOCK_SCHEMA_SQL,
  );

  await ensureLibraryLockColumns(database);
  return database;
}

async function ensureLibraryLockColumns(database: Database): Promise<void> {
  await database.transaction(async () => {
    const columns = new Set(
      (
        await database.queryAll(
          "PRAGMA table_info(library_locks)",
          undefined,
          (row) => getString(row, "name"),
        )
      ).values(),
    );

    if (!columns.has("heartbeat_at")) {
      await database.run(
        "ALTER TABLE library_locks ADD COLUMN heartbeat_at INTEGER NOT NULL DEFAULT 0",
      );
    }
  });
}

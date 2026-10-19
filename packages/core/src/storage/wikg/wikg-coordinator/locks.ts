import { getNumber, getString } from "../../../document/database.js";
import { randomUuid } from "../../../utils/crypto.js";

import { LOCK_POLL_INTERVAL_MS, LOCK_STALE_TIMEOUT_MS } from "./constants.js";
import {
  cleanupStaleState,
  mapEntryLock,
  withCoordinatorState,
} from "./state.js";
import type {
  CoordinatorOwner,
  EntryLockMode,
  SqliteLeaseMode,
} from "./types.js";

export async function acquireArchiveCommitLock(
  archiveKey: string,
  owner: CoordinatorOwner,
): Promise<(() => Promise<void>) | undefined> {
  while (true) {
    const acquired = await withCoordinatorState(async (database) => {
      return await database.transaction(async () => {
        await cleanupStaleState(database, archiveKey);
        const readers = await database.queryOne(
          `SELECT 1 AS present FROM archive_owners AS owner
LEFT JOIN archive_settlements AS settlement
  ON settlement.archive_key = owner.archive_key
 AND settlement.owner_id = owner.owner_id
WHERE owner.archive_key = ? AND owner.owner_id <> ?
  AND settlement.owner_id IS NULL LIMIT 1`,
          [archiveKey, owner.ownerId],
          () => true,
        );
        // Waiting here can deadlock: the foreign callback may be awaiting this
        // session's completion. Published overlays remain durable for settlement.
        if (readers === true) return "deferred" as const;
        await database.run(
          `
INSERT OR IGNORE INTO archive_commit_locks (
  archive_key, owner_id, created_at
) VALUES (?, ?, ?)
`,
          [archiveKey, owner.ownerId, Date.now()],
        );
        return (
          (await database.queryOne(
            "SELECT owner_id FROM archive_commit_locks WHERE archive_key = ?",
            [archiveKey],
            (row) => getString(row, "owner_id"),
          )) === owner.ownerId
        );
      });
    });
    if (acquired === "deferred") return undefined;
    if (acquired) {
      return async () => {
        await withCoordinatorState(async (database) => {
          await database.run(
            "DELETE FROM archive_commit_locks WHERE archive_key = ? AND owner_id = ?",
            [archiveKey, owner.ownerId],
          );
        });
      };
    }
    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

export async function acquireEntryLock(
  archiveKey: string,
  entryPath: string,
  mode: EntryLockMode,
  owner: CoordinatorOwner,
): Promise<() => Promise<void>> {
  const lockId = randomUuid();
  while (true) {
    const acquired = await withCoordinatorState(async (database) => {
      return await database.transaction(async () => {
        await cleanupStaleState(database, archiveKey);
        const locks = await database.queryAll(
          "SELECT entry_path, mode, owner_id FROM entry_locks WHERE archive_key = ?",
          [archiveKey],
          mapEntryLock,
        );
        if (
          locks.some(
            (lock) =>
              lock.ownerId !== owner.ownerId &&
              pathsConflict(entryPath, lock.entryPath) &&
              locksConflict(mode, lock.mode),
          )
        ) {
          return false;
        }
        await database.run(
          `
INSERT INTO entry_locks (
  lock_id, archive_key, entry_path, mode, owner_id, created_at
) VALUES (?, ?, ?, ?, ?, ?)
`,
          [lockId, archiveKey, entryPath, mode, owner.ownerId, Date.now()],
        );
        return true;
      });
    });
    if (acquired) {
      return async () => {
        await withCoordinatorState(async (database) => {
          await database.run(
            `
DELETE FROM entry_locks
WHERE lock_id = ? AND owner_id = ?
`,
            [lockId, owner.ownerId],
          );
        });
      };
    }
    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

export async function withEntryLock<T>(
  archiveKey: string,
  entryPath: string,
  mode: EntryLockMode,
  owner: CoordinatorOwner,
  operation: () => Promise<T> | T,
): Promise<T> {
  const release = await acquireEntryLock(archiveKey, entryPath, mode, owner);
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function acquireSqliteLease(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
  readonly mode: SqliteLeaseMode;
  readonly owner: CoordinatorOwner;
}): Promise<void> {
  const deadline = Date.now() + LOCK_STALE_TIMEOUT_MS;
  while (true) {
    const acquired = await withCoordinatorState(async (database) => {
      return await database.transaction(async () => {
        await cleanupStaleState(database, input.archiveKey);
        const locks = await database.queryAll(
          `
SELECT entry_path, mode, owner_id
FROM entry_locks
WHERE archive_key = ? AND entry_path = ?
`,
          [input.archiveKey, input.entryPath],
          mapEntryLock,
        );
        if (
          locks.some(
            (lock) =>
              lock.ownerId !== input.owner.ownerId && lock.mode === "write",
          )
        ) {
          return false;
        }
        await database.run(
          `
INSERT INTO entry_sqlite_leases (
  archive_key, entry_path, mode, owner_id, created_at
) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(archive_key, entry_path, owner_id)
DO UPDATE SET mode = excluded.mode
`,
          [
            input.archiveKey,
            input.entryPath,
            input.mode,
            input.owner.ownerId,
            Date.now(),
          ],
        );
        return true;
      });
    });
    if (acquired) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for SQLite ${input.mode} lease: ${input.entryPath}.`,
      );
    }
    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

export async function releaseSqliteLease(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
  readonly ownerId: string;
}): Promise<void> {
  await withCoordinatorState(async (database) => {
    await database.run(
      `
DELETE FROM entry_sqlite_leases
WHERE archive_key = ? AND entry_path = ? AND owner_id = ?
`,
      [input.archiveKey, input.entryPath, input.ownerId],
    );
  });
}

export async function waitForSqliteLeasesToDrain(
  archiveKey: string,
  entryPath: string,
  owner: CoordinatorOwner,
): Promise<void> {
  const deadline = Date.now() + LOCK_STALE_TIMEOUT_MS;
  while (true) {
    const count = await withCoordinatorState(async (database) => {
      await cleanupStaleState(database, archiveKey);
      return await database.queryOne(
        `
SELECT COUNT(*) AS count
FROM entry_sqlite_leases
WHERE archive_key = ? AND entry_path = ? AND owner_id <> ?
`,
        [archiveKey, entryPath, owner.ownerId],
        (row) => getNumber(row, "count"),
      );
    });
    if ((count ?? 0) === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for SQLite leases: ${entryPath}.`);
    }
    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

function locksConflict(
  requested: EntryLockMode,
  existing: EntryLockMode,
): boolean {
  if (requested === "state" || existing === "state") {
    return requested === "state" && existing === "state";
  }
  return requested !== "read" || existing !== "read";
}

function pathsConflict(left: string, right: string): boolean {
  return (
    left === right ||
    (left.endsWith("/") && right.startsWith(left)) ||
    (right.endsWith("/") && left.startsWith(right))
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) =>
    globalThis.setTimeout(resolve, milliseconds),
  );
}

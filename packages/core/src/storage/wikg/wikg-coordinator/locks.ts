import { createOwnerId, delay } from "./archive-key.js";
import { LOCK_POLL_INTERVAL_MS, LOCK_STALE_TIMEOUT_MS } from "./constants.js";
import {
  cleanupStaleState,
  getNumber,
  mapArchiveCommitLock,
  mapEntryLock,
  withStateDatabase,
} from "./state.js";
import type { EntryLockMode, SqliteLeaseMode } from "./types.js";

export async function acquireArchiveCommitLock(
  archiveKey: string,
): Promise<() => Promise<void>> {
  const ownerId = createOwnerId();

  while (true) {
    const acquired = await withStateDatabase(async (state) => {
      await cleanupStaleState(state);
      return await state.transaction(async () => {
        const existing = await state.queryOne(
          "SELECT * FROM archive_commit_locks WHERE archive_key = ?",
          [archiveKey],
          mapArchiveCommitLock,
        );

        if (existing !== undefined) {
          return false;
        }

        await state.run(
          `
INSERT INTO archive_commit_locks (
  archive_key, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?)
`,
          [archiveKey, ownerId, process.pid, Date.now(), Date.now()],
        );
        return true;
      });
    });

    if (acquired) {
      return async () => {
        await withStateDatabase(async (releaseState) => {
          await releaseState.run(
            "DELETE FROM archive_commit_locks WHERE archive_key = ? AND owner_id = ?",
            [archiveKey, ownerId],
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
): Promise<() => Promise<void>> {
  const ownerId = createOwnerId();

  while (true) {
    const acquired = await withStateDatabase(async (state) => {
      await cleanupStaleState(state);
      return await state.transaction(async () => {
        const conflicts = await state.queryAll(
          `
SELECT *
FROM entry_locks
WHERE archive_key = ?
`,
          [archiveKey],
          mapEntryLock,
        );

        if (
          conflicts.some(
            (lock) =>
              lock.ownerId !== ownerId &&
              lockPathsConflict(entryPath, lock.entryPath) &&
              locksConflict(mode, lock.mode),
          )
        ) {
          return false;
        }

        await state.run(
          `
INSERT INTO entry_locks (
  archive_key, entry_path, mode, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`,
          [
            archiveKey,
            entryPath,
            mode,
            ownerId,
            process.pid,
            Date.now(),
            Date.now(),
          ],
        );
        return true;
      });
    });

    if (acquired) {
      return async () => {
        await withStateDatabase(async (releaseState) => {
          await releaseState.run(
            `
DELETE FROM entry_locks
WHERE archive_key = ? AND entry_path = ? AND owner_id = ?
`,
            [archiveKey, entryPath, ownerId],
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
  operation: () => Promise<T> | T,
): Promise<T> {
  const release = await acquireEntryLock(archiveKey, entryPath, mode);

  try {
    return await operation();
  } finally {
    await release();
  }
}

function locksConflict(requested: EntryLockMode, existing: EntryLockMode) {
  if (requested === "state" || existing === "state") {
    return requested === "state" && existing === "state";
  }
  if (requested === "read" && existing === "read") {
    return false;
  }

  return true;
}

function lockPathsConflict(requested: string, existing: string): boolean {
  return (
    requested === existing ||
    lockPathContains(requested, existing) ||
    lockPathContains(existing, requested)
  );
}

function lockPathContains(parent: string, child: string): boolean {
  return parent.endsWith("/") && child.startsWith(parent);
}

export async function acquireSqliteLease(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
  readonly mode: SqliteLeaseMode;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    await state.run(
      `
INSERT OR REPLACE INTO entry_sqlite_leases (
  archive_key, entry_path, mode, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`,
      [
        input.archiveKey,
        input.entryPath,
        input.mode,
        input.ownerId,
        process.pid,
        Date.now(),
        Date.now(),
      ],
    );
  });
}

export async function releaseSqliteLease(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.run(
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
): Promise<void> {
  while (true) {
    const count = await withStateDatabase(async (state) => {
      await cleanupStaleState(state);
      return await state.queryOne(
        `
SELECT COUNT(*) AS count
FROM entry_sqlite_leases AS lease
LEFT JOIN archive_owners AS owner
  ON owner.archive_key = lease.archive_key
 AND owner.owner_id = lease.owner_id
WHERE lease.archive_key = ?
  AND lease.entry_path = ?
  AND (
    owner.owner_id IS NULL
    OR owner.heartbeat_at > ?
  )
`,
        [archiveKey, entryPath, Date.now() - LOCK_STALE_TIMEOUT_MS],
        (row) => getNumber(row, "count"),
      );
    });

    if (count === 0) {
      return;
    }

    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

import { LOCK_STALE_TIMEOUT_MS } from "./constants.js";
import { flushArchiveOverlays } from "./flusher.js";
import {
  cleanupStaleState,
  createPlaceholders,
  getString,
  withStateDatabase,
} from "./state.js";

export async function registerArchiveOwner(input: {
  readonly archiveKey: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    await state.run(
      `
INSERT OR REPLACE INTO archive_owners (
  archive_key, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?)
`,
      [input.archiveKey, input.ownerId, process.pid, Date.now(), Date.now()],
    );
  });
}

export async function heartbeatArchiveOwner(input: {
  readonly archiveKey: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.run(
      `
UPDATE archive_owners
SET heartbeat_at = ?, owner_pid = ?
WHERE archive_key = ? AND owner_id = ?
`,
      [Date.now(), process.pid, input.archiveKey, input.ownerId],
    );
  });
}

export async function unregisterArchiveOwner(input: {
  readonly archiveKey: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.transaction(async () => {
      await state.run(
        "DELETE FROM entry_sqlite_leases WHERE archive_key = ? AND owner_id = ?",
        [input.archiveKey, input.ownerId],
      );
      await state.run(
        "DELETE FROM archive_owners WHERE archive_key = ? AND owner_id = ?",
        [input.archiveKey, input.ownerId],
      );
    });
  });
}

export async function reapArchive(archiveKey: string): Promise<void> {
  await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
  });

  const staleOwnerIds = await withStateDatabase(
    async (state) =>
      await state.queryAll(
        `
SELECT owner_id
FROM archive_owners
WHERE archive_key = ?
  AND heartbeat_at <= ?
`,
        [archiveKey, Date.now() - LOCK_STALE_TIMEOUT_MS],
        (row) => getString(row, "owner_id"),
      ),
  );

  if (staleOwnerIds.length === 0) {
    return;
  }

  await withStateDatabase(async (state) => {
    await state.transaction(async () => {
      await state.run(
        `
DELETE FROM entry_sqlite_leases
WHERE archive_key = ?
  AND owner_id IN (${createPlaceholders(staleOwnerIds.length)})
`,
        [archiveKey, ...staleOwnerIds],
      );
      await state.run(
        `
DELETE FROM archive_owners
WHERE archive_key = ?
  AND owner_id IN (${createPlaceholders(staleOwnerIds.length)})
`,
        [archiveKey, ...staleOwnerIds],
      );
    });
  });

  await flushArchiveOverlays(archiveKey);
}

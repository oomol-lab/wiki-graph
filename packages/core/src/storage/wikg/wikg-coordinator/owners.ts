import { getWikiGraphPlatform } from "../../../runtime/platform/index.js";
import { randomUuid } from "../../../utils/crypto.js";

import { cleanupStaleState, withCoordinatorState } from "./state.js";
import type { CoordinatorOwner } from "./types.js";

export function createCoordinatorOwner(): CoordinatorOwner {
  return {
    hostInstanceId: getWikiGraphPlatform().lifecycle.instanceId,
    ownerId: randomUuid(),
  };
}

export async function registerArchiveOwner(
  archiveKey: string,
  owner: CoordinatorOwner,
): Promise<void> {
  while (true) {
    const registered = await withCoordinatorState(async (database) => {
      return await database.transaction(async () => {
        await cleanupStaleState(database, archiveKey);
        const replacement = await database.queryOne(
          "SELECT owner_id FROM archive_replacement_locks WHERE archive_key = ?",
          [archiveKey],
          () => true,
        );
        if (replacement === true) return false;
        const now = Date.now();
        await database.run(
          `
INSERT INTO archive_owners (
  archive_key, owner_id, host_instance_id, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?)
`,
          [archiveKey, owner.ownerId, owner.hostInstanceId, now, now],
        );
        return true;
      });
    });
    if (registered) return;
    await delay();
  }
}

export async function registerArchiveReplacementOwner(
  archiveKey: string,
  owner: CoordinatorOwner,
): Promise<void> {
  while (true) {
    const registered = await withCoordinatorState(async (database) => {
      return await database.transaction(async () => {
        await cleanupStaleState(database, archiveKey);
        const now = Date.now();
        await database.run(
          `
INSERT INTO archive_owners (
  archive_key, owner_id, host_instance_id, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?)
`,
          [archiveKey, owner.ownerId, owner.hostInstanceId, now, now],
        );
        await database.run(
          `
INSERT OR IGNORE INTO archive_replacement_locks (
  archive_key, owner_id, created_at
) VALUES (?, ?, ?)
`,
          [archiveKey, owner.ownerId, now],
        );
        const lockOwner = await database.queryOne(
          "SELECT owner_id FROM archive_replacement_locks WHERE archive_key = ?",
          [archiveKey],
          (row) => String(row.owner_id),
        );
        if (lockOwner === owner.ownerId) return true;
        await database.run(
          "DELETE FROM archive_owners WHERE archive_key = ? AND owner_id = ?",
          [archiveKey, owner.ownerId],
        );
        return false;
      });
    });
    if (registered) return;
    await delay();
  }
}

export async function waitForOtherArchiveOwnersToDrain(
  archiveKey: string,
  ownerId: string,
): Promise<void> {
  while (true) {
    const remaining = await withCoordinatorState(async (database) => {
      await cleanupStaleState(database, archiveKey);
      return await database.queryOne(
        `
SELECT COUNT(*) AS count
FROM archive_owners
WHERE archive_key = ? AND owner_id <> ?
`,
        [archiveKey, ownerId],
        (row) => Number(row.count),
      );
    });
    if ((remaining ?? 0) === 0) return;
    await delay();
  }
}

export async function heartbeatArchiveOwner(
  archiveKey: string,
  owner: CoordinatorOwner,
): Promise<void> {
  await withCoordinatorState(async (database) => {
    await database.run(
      `
UPDATE archive_owners
SET heartbeat_at = ?, host_instance_id = ?
WHERE archive_key = ? AND owner_id = ?
`,
      [Date.now(), owner.hostInstanceId, archiveKey, owner.ownerId],
    );
  });
}

export async function unregisterArchiveOwner(
  archiveKey: string,
  ownerId: string,
): Promise<void> {
  await withCoordinatorState(async (database) => {
    await database.transaction(async () => {
      await database.run(
        "DELETE FROM entry_sqlite_leases WHERE archive_key = ? AND owner_id = ?",
        [archiveKey, ownerId],
      );
      await database.run(
        "DELETE FROM entry_locks WHERE archive_key = ? AND owner_id = ?",
        [archiveKey, ownerId],
      );
      await database.run(
        "DELETE FROM archive_commit_locks WHERE archive_key = ? AND owner_id = ?",
        [archiveKey, ownerId],
      );
      await database.run(
        "DELETE FROM archive_replacement_locks WHERE archive_key = ? AND owner_id = ?",
        [archiveKey, ownerId],
      );
      await database.run(
        "DELETE FROM archive_owners WHERE archive_key = ? AND owner_id = ?",
        [archiveKey, ownerId],
      );
    });
  });
}

async function delay(): Promise<void> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 100));
}

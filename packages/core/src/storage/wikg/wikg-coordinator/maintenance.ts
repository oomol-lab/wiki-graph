import { Database, getNumber, getString } from "../../../document/database.js";
import {
  getRelativeFile,
  getWikiGraphPlatform,
  getWikiGraphStorage,
  isHostFileEmpty,
  type File,
} from "../../../runtime/platform/index.js";
import { createPortableHash } from "../../../utils/crypto.js";

import {
  LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH,
  LOCK_STALE_TIMEOUT_MS,
  SEARCH_INDEX_DATABASE_ENTRY_PATH,
} from "./constants.js";
import { removeWorkspaceSnapshot } from "./workspace.js";

export async function assertArchiveUpgradeCoordinatorSafe(
  archive: File,
): Promise<void> {
  const state = await getRelativeFile(
    getWikiGraphStorage().library,
    "tmp/wikg-coordinator.sqlite",
  );
  if (state === undefined || (await isEmpty(state))) return;

  const archiveKey = createArchiveKey(archive);
  const database = await Database.open(state, "", { readonly: true });
  try {
    if (await tableExists(database, "archive_owners")) {
      const owners = await database.queryAll(
        `SELECT host_instance_id, heartbeat_at
         FROM archive_owners
         WHERE archive_key = ?`,
        [archiveKey],
        (row) => ({
          heartbeatAt: getNumber(row, "heartbeat_at"),
          hostInstanceId: getString(row, "host_instance_id"),
        }),
      );
      for (const owner of owners) {
        const alive = await getWikiGraphPlatform().lifecycle.isInstanceAlive(
          owner.hostInstanceId,
        );
        if (
          alive === true ||
          (alive === undefined &&
            Date.now() - owner.heartbeatAt <= LOCK_STALE_TIMEOUT_MS)
        ) {
          throw new Error(
            `Cannot upgrade archive with active coordinator state: ${archive.identity}.`,
          );
        }
      }
    }

    if (await tableExists(database, "entry_overlays")) {
      const nonDerived = await database.queryOne(
        `SELECT entry_path
         FROM entry_overlays
         WHERE archive_key = ?
           AND entry_path NOT IN (?, ?)
         LIMIT 1`,
        [
          archiveKey,
          SEARCH_INDEX_DATABASE_ENTRY_PATH,
          LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH,
        ],
        (row) => getString(row, "entry_path"),
      );
      if (nonDerived !== undefined) {
        throw new Error(
          `Cannot upgrade archive with non-derived overlay state: ${archive.identity}.`,
        );
      }
    }
  } finally {
    await database.close();
  }
}

export async function clearArchiveUpgradeDerivedOverlays(
  archive: File,
): Promise<void> {
  const state = await getRelativeFile(
    getWikiGraphStorage().library,
    "tmp/wikg-coordinator.sqlite",
  );
  if (state === undefined || (await isEmpty(state))) return;

  const archiveKey = createArchiveKey(archive);
  const database = await Database.open(state);
  try {
    if (!(await tableExists(database, "entry_overlays"))) return;
    const overlays = await database.queryAll(
      `SELECT workspace_path
       FROM entry_overlays
       WHERE archive_key = ? AND entry_path IN (?, ?)`,
      [
        archiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
        LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH,
      ],
      (row) =>
        typeof row.workspace_path === "string" ? row.workspace_path : undefined,
    );
    await database.run(
      `DELETE FROM entry_overlays
       WHERE archive_key = ? AND entry_path IN (?, ?)`,
      [
        archiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
        LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH,
      ],
    );
    for (const workspacePath of overlays) {
      await removeWorkspaceSnapshot(workspacePath);
    }
  } finally {
    await database.close();
  }
}

function createArchiveKey(archive: File): string {
  return createPortableHash("sha256").update(archive.identity).digest("hex");
}

async function isEmpty(file: File): Promise<boolean> {
  return await isHostFileEmpty(file);
}

async function tableExists(database: Database, name: string): Promise<boolean> {
  return (
    (await database.queryOne(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
      () => true,
    )) === true
  );
}

import type { File } from "../../../runtime/platform/index.js";
import { createPortableHash } from "../../../utils/crypto.js";

import {
  createPlaceholders,
  mapEntryOverlay,
  withCoordinatorState,
} from "./state.js";
import type { CoordinatorOwner, EntryOverlay } from "./types.js";
import {
  removeWorkspaceSnapshot,
  resolveWorkspaceSnapshot,
} from "./workspace.js";

export async function readOverlay(
  archiveKey: string,
  entryPath: string,
): Promise<EntryOverlay | undefined> {
  return await withCoordinatorState(async (database) =>
    database.queryOne(
      "SELECT * FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
      [archiveKey, entryPath],
      mapEntryOverlay,
    ),
  );
}

export async function listOverlays(
  archiveKey: string,
): Promise<readonly EntryOverlay[]> {
  return await withCoordinatorState(async (database) =>
    database.queryAll(
      `
SELECT *
FROM entry_overlays
WHERE archive_key = ?
ORDER BY entry_path
`,
      [archiveKey],
      mapEntryOverlay,
    ),
  );
}

/**
 * Returns overlays this owner may commit after the caller has locked their
 * entries. A foreign live owner can still roll its operation back, so an
 * observer must leave that overlay for the publishing owner (or a reaper).
 */
export async function listSettleableOverlays(
  archiveKey: string,
  entryPaths: ReadonlySet<string>,
  ownerId: string,
): Promise<readonly EntryOverlay[]> {
  if (entryPaths.size === 0) return [];
  const paths = [...entryPaths];
  return await withCoordinatorState(async (database) =>
    database.queryAll(
      `
SELECT overlay.*
FROM entry_overlays AS overlay
LEFT JOIN archive_owners AS publishing_owner
  ON publishing_owner.archive_key = overlay.archive_key
 AND publishing_owner.owner_id = overlay.owner_id
WHERE overlay.archive_key = ?
  AND overlay.entry_path IN (${createPlaceholders(paths.length)})
  AND (
    overlay.owner_id = ?
    OR publishing_owner.owner_id IS NULL
  )
ORDER BY overlay.entry_path
`,
      [archiveKey, ...paths, ownerId],
      mapEntryOverlay,
    ),
  );
}

export async function listOrphanOverlayPaths(
  archiveKey: string,
): Promise<ReadonlySet<string>> {
  return await withCoordinatorState(async (database) => {
    const rows = await database.queryAll(
      `
SELECT overlay.*
FROM entry_overlays AS overlay
LEFT JOIN archive_owners AS owner
  ON owner.archive_key = overlay.archive_key
 AND owner.owner_id = overlay.owner_id
WHERE overlay.archive_key = ? AND owner.owner_id IS NULL
`,
      [archiveKey],
      mapEntryOverlay,
    );
    const paths = new Set<string>();
    for (const overlay of rows) {
      if (await isDirtyOverlay(overlay)) paths.add(overlay.entryPath);
    }
    return paths;
  });
}

export async function publishFileOverlay(input: {
  readonly archiveIdentity: string;
  readonly archiveKey: string;
  readonly baseDigest?: string;
  readonly entryPath: string;
  readonly owner: CoordinatorOwner;
  readonly workspacePath: string;
}): Promise<EntryOverlay | undefined> {
  return await withCoordinatorState(async (database) => {
    return await database.transaction(async () => {
      const previous = await database.queryOne(
        "SELECT * FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
        [input.archiveKey, input.entryPath],
        mapEntryOverlay,
      );
      await database.run(
        `
INSERT INTO entry_overlays (
  archive_key, archive_identity, entry_path, kind, workspace_identity,
  workspace_path, base_digest, owner_id, updated_at
) VALUES (?, ?, ?, 'file', NULL, ?, ?, ?, ?)
ON CONFLICT(archive_key, entry_path)
DO UPDATE SET archive_identity = excluded.archive_identity,
              kind = excluded.kind,
              workspace_identity = excluded.workspace_identity,
              workspace_path = excluded.workspace_path,
              base_digest = excluded.base_digest,
              owner_id = excluded.owner_id,
              updated_at = excluded.updated_at
`,
        [
          input.archiveKey,
          input.archiveIdentity,
          input.entryPath,
          input.workspacePath,
          input.baseDigest ?? null,
          input.owner.ownerId,
          Date.now(),
        ],
      );
      return previous;
    });
  });
}

export async function publishDeleteOverlay(input: {
  readonly archiveIdentity: string;
  readonly archiveKey: string;
  readonly entryPath: string;
  readonly owner: CoordinatorOwner;
}): Promise<EntryOverlay | undefined> {
  return await withCoordinatorState(async (database) => {
    return await database.transaction(async () => {
      const previous = await database.queryOne(
        "SELECT * FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
        [input.archiveKey, input.entryPath],
        mapEntryOverlay,
      );
      await database.run(
        `
INSERT INTO entry_overlays (
  archive_key, archive_identity, entry_path, kind, workspace_identity,
  workspace_path, base_digest, owner_id, updated_at
) VALUES (?, ?, ?, 'deleted', NULL, NULL, NULL, ?, ?)
ON CONFLICT(archive_key, entry_path)
DO UPDATE SET archive_identity = excluded.archive_identity,
              kind = excluded.kind,
              workspace_identity = NULL,
              workspace_path = NULL,
              base_digest = NULL,
              owner_id = excluded.owner_id,
              updated_at = excluded.updated_at
`,
        [
          input.archiveKey,
          input.archiveIdentity,
          input.entryPath,
          input.owner.ownerId,
          Date.now(),
        ],
      );
      return previous;
    });
  });
}

export async function restoreOverlay(
  current: EntryOverlay,
  previous: EntryOverlay | undefined,
): Promise<boolean> {
  const restored = await withCoordinatorState(async (database) => {
    return await database.transaction(async () => {
      const latest = await database.queryOne(
        "SELECT * FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
        [current.archiveKey, current.entryPath],
        mapEntryOverlay,
      );
      if (!sameOverlay(latest, current)) return false;
      const otherLeaseCount = await database.queryOne(
        `
SELECT COUNT(*) AS count
FROM entry_sqlite_leases
WHERE archive_key = ? AND entry_path = ? AND owner_id <> ?
`,
        [current.archiveKey, current.entryPath, current.ownerId],
        (row) => Number(row.count),
      );
      if ((otherLeaseCount ?? 0) > 0) return false;
      if (previous === undefined) {
        await database.run(
          "DELETE FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
          [current.archiveKey, current.entryPath],
        );
      } else {
        await database.run(
          `
UPDATE entry_overlays
SET archive_identity = ?, kind = ?, workspace_identity = ?,
    workspace_path = ?, base_digest = ?, owner_id = ?, updated_at = ?
WHERE archive_key = ? AND entry_path = ?
`,
          [
            previous.archiveIdentity,
            previous.kind,
            previous.workspaceIdentity ?? null,
            previous.workspacePath ?? null,
            previous.baseDigest ?? null,
            previous.ownerId,
            previous.updatedAt,
            previous.archiveKey,
            previous.entryPath,
          ],
        );
      }
      return true;
    });
  });
  if (restored && current.workspacePath !== previous?.workspacePath) {
    await removeWorkspaceSnapshot(current.workspacePath);
  }
  return restored;
}

export async function deleteCommittedOverlay(
  overlay: EntryOverlay,
): Promise<boolean> {
  const deleted = await withCoordinatorState(async (database) => {
    const current = await database.queryOne(
      "SELECT * FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
      [overlay.archiveKey, overlay.entryPath],
      mapEntryOverlay,
    );
    if (!sameOverlay(current, overlay)) return false;
    await database.run(
      "DELETE FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
      [overlay.archiveKey, overlay.entryPath],
    );
    return true;
  });
  if (deleted) await removeWorkspaceSnapshot(overlay.workspacePath);
  return deleted;
}

export async function deleteCleanOverlayIfUnused(
  overlay: EntryOverlay,
): Promise<boolean> {
  if (overlay.baseDigest === undefined || (await isDirtyOverlay(overlay))) {
    return false;
  }
  const deleted = await withCoordinatorState(async (database) => {
    return await database.transaction(async () => {
      const leaseCount = await database.queryOne(
        `
SELECT COUNT(*) AS count
FROM entry_sqlite_leases
WHERE archive_key = ? AND entry_path = ?
`,
        [overlay.archiveKey, overlay.entryPath],
        (row) => Number(row.count),
      );
      const current = await database.queryOne(
        "SELECT * FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
        [overlay.archiveKey, overlay.entryPath],
        mapEntryOverlay,
      );
      if ((leaseCount ?? 0) > 0 || !sameOverlay(current, overlay)) {
        return false;
      }
      await database.run(
        "DELETE FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
        [overlay.archiveKey, overlay.entryPath],
      );
      return true;
    });
  });
  if (deleted) await removeWorkspaceSnapshot(overlay.workspacePath);
  return deleted;
}

export async function resolveOverlayFile(overlay: EntryOverlay): Promise<File> {
  const file = await resolveWorkspaceSnapshot(
    overlay.workspaceIdentity,
    overlay.workspacePath,
  );
  if (file === undefined) {
    throw new Error(
      `Published workspace snapshot is unavailable: ${overlay.entryPath}.`,
    );
  }
  return file;
}

function sameOverlay(
  left: EntryOverlay | undefined,
  right: EntryOverlay,
): boolean {
  return (
    left?.archiveKey === right.archiveKey &&
    left.entryPath === right.entryPath &&
    left.kind === right.kind &&
    left.baseDigest === right.baseDigest &&
    left.workspaceIdentity === right.workspaceIdentity &&
    left.workspacePath === right.workspacePath &&
    left.ownerId === right.ownerId &&
    left.updatedAt === right.updatedAt
  );
}

export async function isDirtyOverlay(overlay: EntryOverlay): Promise<boolean> {
  if (overlay.kind === "deleted" || overlay.baseDigest === undefined) {
    return true;
  }
  const file = await resolveWorkspaceSnapshot(
    overlay.workspaceIdentity,
    overlay.workspacePath,
  );
  if (file === undefined) return false;
  return (await readFileDigest(file)) !== overlay.baseDigest;
}

export async function readFileDigest(file: File): Promise<string> {
  const reader = await file.openReader();
  const hash = createPortableHash("sha256");
  try {
    for (let offset = 0; offset < reader.size; ) {
      const content = await reader.read(
        offset,
        Math.min(64 * 1024, reader.size - offset),
      );
      hash.update(content);
      offset += content.byteLength;
    }
    return hash.digest("hex");
  } finally {
    await reader.close();
  }
}

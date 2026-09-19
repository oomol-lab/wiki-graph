import {
  ensureRelativeFile,
  getWikiGraphPlatform,
  getWikiGraphStorage,
} from "../../../runtime/platform/index.js";
import {
  Database,
  getNumber,
  getOptionalString,
  getString,
  type SqlRow,
} from "../../../document/database.js";
import { AsyncSemaphore } from "../../../utils/async-semaphore.js";

import { LOCK_STALE_TIMEOUT_MS } from "./constants.js";
import type { EntryLock, EntryLockMode, EntryOverlay } from "./types.js";

const STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS archive_owners (
  archive_key TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  host_instance_id TEXT NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, owner_id)
);

CREATE TABLE IF NOT EXISTS entry_overlays (
  archive_key TEXT NOT NULL,
  archive_identity TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_digest TEXT,
  workspace_identity TEXT,
  workspace_path TEXT,
  owner_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path)
);

CREATE TABLE IF NOT EXISTS entry_locks (
  lock_id TEXT PRIMARY KEY,
  archive_key TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_sqlite_leases (
  archive_key TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path, owner_id)
);

CREATE TABLE IF NOT EXISTS archive_commit_locks (
  archive_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

const STATE_DATABASE_SEMAPHORE = new AsyncSemaphore(1);

export async function withCoordinatorState<T>(
  operation: (database: Database) => Promise<T> | T,
): Promise<T> {
  return await STATE_DATABASE_SEMAPHORE.use(async () => {
    const file = await ensureRelativeFile(
      getWikiGraphStorage().library,
      "tmp/wikg-coordinator.sqlite",
    );
    const database = await Database.open(file, STATE_SCHEMA_SQL, {
      create: true,
      mode: "readwrite",
    });
    try {
      return await operation(database);
    } finally {
      await database.close();
    }
  });
}

export async function cleanupStaleState(
  database: Database,
  archiveKey?: string,
): Promise<ReadonlySet<string>> {
  const rows = await database.queryAll(
    `
SELECT archive_key, owner_id, host_instance_id, heartbeat_at
FROM archive_owners
${archiveKey === undefined ? "" : "WHERE archive_key = ?"}
`,
    archiveKey === undefined ? undefined : [archiveKey],
    (row) => ({
      archiveKey: getString(row, "archive_key"),
      heartbeatAt: getNumber(row, "heartbeat_at"),
      hostInstanceId: getString(row, "host_instance_id"),
      ownerId: getString(row, "owner_id"),
    }),
  );
  const staleOwnerIds = new Set<string>();
  const now = Date.now();
  for (const row of rows) {
    const alive = await getWikiGraphPlatform().lifecycle.isInstanceAlive(
      row.hostInstanceId,
    );
    if (
      alive === false ||
      (alive === undefined && now - row.heartbeatAt >= LOCK_STALE_TIMEOUT_MS)
    ) {
      staleOwnerIds.add(row.ownerId);
    }
  }
  if (staleOwnerIds.size === 0) return staleOwnerIds;

  const placeholders = createPlaceholders(staleOwnerIds.size);
  const values = [...staleOwnerIds];
  await database.run(
    `DELETE FROM entry_sqlite_leases WHERE owner_id IN (${placeholders})`,
    values,
  );
  await database.run(
    `DELETE FROM entry_locks WHERE owner_id IN (${placeholders})`,
    values,
  );
  await database.run(
    `DELETE FROM archive_commit_locks WHERE owner_id IN (${placeholders})`,
    values,
  );
  await database.run(
    `DELETE FROM archive_owners WHERE owner_id IN (${placeholders})`,
    values,
  );
  return staleOwnerIds;
}

export function mapEntryOverlay(row: SqlRow): EntryOverlay {
  const kind = getString(row, "kind");
  if (kind !== "deleted" && kind !== "file") {
    throw new Error(`Unsupported entry overlay kind: ${kind}.`);
  }
  const workspaceIdentity = getOptionalString(row, "workspace_identity");
  const workspacePath = getOptionalString(row, "workspace_path");
  const baseDigest = getOptionalString(row, "base_digest");
  return {
    archiveIdentity: getString(row, "archive_identity"),
    archiveKey: getString(row, "archive_key"),
    ...(baseDigest === undefined ? {} : { baseDigest }),
    entryPath: getString(row, "entry_path"),
    kind,
    ownerId: getString(row, "owner_id"),
    updatedAt: getNumber(row, "updated_at"),
    ...(workspaceIdentity === undefined ? {} : { workspaceIdentity }),
    ...(workspacePath === undefined ? {} : { workspacePath }),
  };
}

export function mapEntryLock(row: SqlRow): EntryLock {
  const mode = getString(row, "mode");
  if (mode !== "read" && mode !== "state" && mode !== "write") {
    throw new Error(`Unsupported entry lock mode: ${mode}.`);
  }
  return {
    entryPath: getString(row, "entry_path"),
    mode: mode as EntryLockMode,
    ownerId: getString(row, "owner_id"),
  };
}

export function createPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

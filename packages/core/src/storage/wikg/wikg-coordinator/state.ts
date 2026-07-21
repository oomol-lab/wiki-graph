import { join } from "path";

import { resolveWikiGraphStagingDirectoryPath } from "../../../runtime/common/wiki-graph/dir.js";
import { openSharedStateDatabase } from "../../../document/index.js";
import type { Database } from "../../../document/index.js";
import { AsyncSemaphore } from "../../../utils/async-semaphore.js";

import { LOCK_STALE_TIMEOUT_MS } from "./constants.js";
import type {
  ArchiveCommitLock,
  EntryLock,
  EntryLockMode,
  EntryOverlay,
} from "./types.js";

const STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entry_overlays (
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace_path TEXT,
  archive_signature TEXT,
  mutation_token TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path)
);

CREATE TABLE IF NOT EXISTS entry_locks (
  archive_key TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path, owner_id)
);

CREATE TABLE IF NOT EXISTS archive_owners (
  archive_key TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, owner_id)
);

CREATE TABLE IF NOT EXISTS entry_sqlite_leases (
  archive_key TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'read',
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path, owner_id)
);

CREATE TABLE IF NOT EXISTS archive_commit_locks (
  archive_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`;

const STATE_DATABASE_SEMAPHORE = new AsyncSemaphore(1);

export async function cleanupStaleState(state: Database): Promise<void> {
  const now = Date.now();
  const staleOwnerPids = new Set<number>();

  for (const tableName of [
    "archive_owners",
    "entry_locks",
    "entry_sqlite_leases",
    "archive_commit_locks",
  ]) {
    const rows = await state.queryAll(
      `
SELECT DISTINCT owner_pid
FROM ${tableName}
WHERE owner_pid IS NOT NULL
  AND heartbeat_at <= ?
`,
      [now - LOCK_STALE_TIMEOUT_MS],
      (row) => getNumber(row, "owner_pid"),
    );

    for (const ownerPid of rows) {
      if (!isProcessAlive(ownerPid)) {
        staleOwnerPids.add(ownerPid);
      }
    }
  }

  if (staleOwnerPids.size === 0) {
    return;
  }

  await state.run(
    `
DELETE FROM archive_owners
WHERE owner_pid IN (${createPlaceholders(staleOwnerPids.size)})
`,
    [...staleOwnerPids],
  );
  await state.run(
    `
DELETE FROM entry_locks
WHERE owner_pid IN (${createPlaceholders(staleOwnerPids.size)})
`,
    [...staleOwnerPids],
  );
  await state.run(
    `
DELETE FROM entry_sqlite_leases
WHERE owner_pid IN (${createPlaceholders(staleOwnerPids.size)})
`,
    [...staleOwnerPids],
  );
  await state.run(
    `
DELETE FROM archive_commit_locks
WHERE owner_pid IN (${createPlaceholders(staleOwnerPids.size)})
`,
    [...staleOwnerPids],
  );
}

export function createPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }

    return true;
  }
}

export async function withStateDatabase<T>(
  operation: (state: Database) => Promise<T> | T,
): Promise<T> {
  return await STATE_DATABASE_SEMAPHORE.use(async () => {
    const state = await openStateDatabase();

    try {
      return await operation(state);
    } finally {
      await state.close();
    }
  });
}

async function openStateDatabase(): Promise<Database> {
  const database = await openSharedStateDatabase(
    join(getCoordinatorStateDirectoryPath(), "staging.sqlite"),
    STATE_SCHEMA_SQL,
  );

  await migrateStateDatabase(database);
  return database;
}

async function migrateStateDatabase(database: Database): Promise<void> {
  const overlayColumns = await database.queryAll(
    "PRAGMA table_info(entry_overlays)",
    undefined,
    (row) => getString(row, "name"),
  );

  if (!overlayColumns.includes("archive_signature")) {
    await database.run(`
      ALTER TABLE entry_overlays
      ADD COLUMN archive_signature TEXT
    `);
  }

  if (!overlayColumns.includes("mutation_token")) {
    await database.run(`
      ALTER TABLE entry_overlays
      ADD COLUMN mutation_token TEXT
    `);
  }

  const sqliteLeaseColumns = await database.queryAll(
    "PRAGMA table_info(entry_sqlite_leases)",
    undefined,
    (row) => getString(row, "name"),
  );

  if (!sqliteLeaseColumns.includes("mode")) {
    await database.run(`
      ALTER TABLE entry_sqlite_leases
      ADD COLUMN mode TEXT NOT NULL DEFAULT 'read'
    `);
  }
}

export function getCoordinatorStateDirectoryPath(): string {
  return resolveWikiGraphStagingDirectoryPath();
}

export function mapEntryOverlay(row: Record<string, unknown>): EntryOverlay {
  const workspacePath = getOptionalString(row, "workspace_path");
  const archiveSignature = getOptionalString(row, "archive_signature");
  const mutationToken = getOptionalString(row, "mutation_token");

  return {
    archiveKey: getString(row, "archive_key"),
    archivePath: getString(row, "archive_path"),
    ...(archiveSignature === undefined ? {} : { archiveSignature }),
    entryPath: getString(row, "entry_path"),
    kind: getOverlayKind(row),
    ...(mutationToken === undefined ? {} : { mutationToken }),
    updatedAt: getNumber(row, "updated_at"),
    ...(workspacePath === undefined ? {} : { workspacePath }),
  };
}

export function mapEntryLock(row: Record<string, unknown>): EntryLock {
  return {
    entryPath: getString(row, "entry_path"),
    mode: getEntryLockMode(row),
    ownerId: getString(row, "owner_id"),
  };
}

export function mapArchiveCommitLock(
  row: Record<string, unknown>,
): ArchiveCommitLock {
  return {
    ownerId: getString(row, "owner_id"),
  };
}

function getEntryLockMode(row: Record<string, unknown>): EntryLockMode {
  const mode = getString(row, "mode");

  if (mode === "read" || mode === "state" || mode === "write") {
    return mode;
  }

  throw new Error(`Unsupported entry lock mode: ${mode}.`);
}

function getOverlayKind(row: Record<string, unknown>): "deleted" | "file" {
  const kind = getString(row, "kind");

  if (kind === "deleted" || kind === "file") {
    return kind;
  }

  throw new Error(`Unsupported entry overlay kind: ${kind}.`);
}

export function getString(row: Record<string, unknown>, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

export function getNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}

export function getOptionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

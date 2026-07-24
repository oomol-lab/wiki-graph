import { randomUUID } from "crypto";

import {
  getNumber,
  getString,
  type Database,
  type SqlRow,
} from "./document/database.js";
import { openSharedStateDatabase } from "./document/index.js";
import { isNodeError } from "./utils/node-error.js";

const STATE_LOCK_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS state_locks (
    scope TEXT NOT NULL,
    resource_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    owner_pid INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (scope, resource_key, owner_id)
  );

  CREATE INDEX IF NOT EXISTS idx_state_locks_resource
  ON state_locks(scope, resource_key);
`;
const DEFAULT_STATE_LOCK_POLL_MS = 100;
const DEFAULT_STATE_LOCK_STALE_MS = 5 * 60 * 1000;
const DEFAULT_STATE_LOCK_HEARTBEAT_MS = 15_000;

export type StateLockMode = "read" | "write";

export interface StateLockOptions {
  readonly databasePath: string;
  readonly heartbeatMs?: number;
  readonly mode: StateLockMode;
  readonly pollMs?: number;
  readonly resourceKey: string;
  readonly scope: string;
  readonly staleMs?: number;
  readonly wait?: boolean;
}

interface StateLockRow {
  readonly heartbeatAt: number;
  readonly mode: StateLockMode;
  readonly ownerId: string;
  readonly ownerPid: number;
}

export async function withStateLock<T>(
  options: StateLockOptions,
  operation: () => Promise<T> | T,
): Promise<T> {
  const release = await acquireStateLock({ ...options, wait: true });

  if (release === undefined) {
    throw new Error("State lock was not acquired.");
  }

  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function acquireStateLock(
  options: StateLockOptions,
): Promise<(() => Promise<void>) | undefined> {
  const ownerId = `${process.pid}-${randomUUID()}`;
  const pollMs = options.pollMs ?? DEFAULT_STATE_LOCK_POLL_MS;

  while (true) {
    const acquired = await tryInsertStateLock(options, ownerId);

    if (acquired) {
      return createStateLockRelease(options, ownerId);
    }

    if (options.wait === false) {
      return undefined;
    }

    await delay(pollMs);
  }
}

export async function isStateLocked(options: {
  readonly databasePath: string;
  readonly resourceKey: string;
  readonly scope: string;
  readonly staleMs?: number;
}): Promise<boolean> {
  const database = await openStateLockDatabase(options.databasePath);

  try {
    await cleanupStaleStateLocks(database, options);
    const active = await database.queryOne(
      `
        SELECT 1 AS active
        FROM state_locks
        WHERE scope = ? AND resource_key = ?
        LIMIT 1
      `,
      [options.scope, options.resourceKey],
      () => true,
    );

    return active === true;
  } finally {
    await database.close();
  }
}

async function tryInsertStateLock(
  options: StateLockOptions,
  ownerId: string,
): Promise<boolean> {
  const database = await openStateLockDatabase(options.databasePath);
  const now = Date.now();

  try {
    return await database.transaction(async () => {
      await cleanupStaleStateLocks(database, options);
      const existingLocks = await database.queryAll(
        `
          SELECT mode, owner_id, owner_pid, heartbeat_at
          FROM state_locks
          WHERE scope = ? AND resource_key = ?
        `,
        [options.scope, options.resourceKey],
        mapStateLockRow,
      );

      if (
        existingLocks.some(
          (lock) =>
            lock.ownerId !== ownerId && locksConflict(options.mode, lock.mode),
        )
      ) {
        return false;
      }

      await database.run(
        `
          INSERT INTO state_locks (
            scope, resource_key, mode, owner_id, owner_pid, heartbeat_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          options.scope,
          options.resourceKey,
          options.mode,
          ownerId,
          process.pid,
          now,
          now,
        ],
      );
      return true;
    });
  } finally {
    await database.close();
  }
}

function createStateLockRelease(
  options: StateLockOptions,
  ownerId: string,
): () => Promise<void> {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_STATE_LOCK_HEARTBEAT_MS;
  const heartbeat = setInterval(() => {
    void updateStateLockHeartbeat(options, ownerId).catch(() => undefined);
  }, heartbeatMs);
  heartbeat.unref?.();

  return async () => {
    clearInterval(heartbeat);
    const database = await openStateLockDatabase(options.databasePath);

    try {
      await database.run(
        `
          DELETE FROM state_locks
          WHERE scope = ? AND resource_key = ? AND owner_id = ?
        `,
        [options.scope, options.resourceKey, ownerId],
      );
    } finally {
      await database.close();
    }
  };
}

async function updateStateLockHeartbeat(
  options: StateLockOptions,
  ownerId: string,
): Promise<void> {
  const database = await openStateLockDatabase(options.databasePath);

  try {
    await database.run(
      `
        UPDATE state_locks
        SET heartbeat_at = ?, owner_pid = ?
        WHERE scope = ? AND resource_key = ? AND owner_id = ?
      `,
      [Date.now(), process.pid, options.scope, options.resourceKey, ownerId],
    );
  } finally {
    await database.close();
  }
}

async function cleanupStaleStateLocks(
  database: Database,
  options: {
    readonly resourceKey?: string;
    readonly scope?: string;
    readonly staleMs?: number;
  },
): Promise<void> {
  const clauses: string[] = [];
  const parameters: string[] = [];

  if (options.scope !== undefined) {
    clauses.push("scope = ?");
    parameters.push(options.scope);
  }
  if (options.resourceKey !== undefined) {
    clauses.push("resource_key = ?");
    parameters.push(options.resourceKey);
  }

  const rows = await database.queryAll(
    `
      SELECT scope, resource_key, mode, owner_id, owner_pid, heartbeat_at
      FROM state_locks
      ${clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`}
    `,
    parameters,
    (row) => ({
      lock: mapStateLockRow(row),
      resourceKey: getString(row, "resource_key"),
      scope: getString(row, "scope"),
    }),
  );

  for (const { lock, resourceKey, scope } of rows) {
    if (!isStateLockStale(lock, options.staleMs)) {
      continue;
    }

    await database.run(
      `
        DELETE FROM state_locks
        WHERE scope = ?
          AND resource_key = ?
          AND owner_id = ?
          AND heartbeat_at = ?
      `,
      [scope, resourceKey, lock.ownerId, lock.heartbeatAt],
    );
  }
}

async function openStateLockDatabase(databasePath: string): Promise<Database> {
  return await openSharedStateDatabase(databasePath, STATE_LOCK_SCHEMA_SQL);
}

function mapStateLockRow(row: SqlRow): StateLockRow {
  return {
    heartbeatAt: getNumber(row, "heartbeat_at"),
    mode: getStateLockMode(getString(row, "mode")),
    ownerId: getString(row, "owner_id"),
    ownerPid: getNumber(row, "owner_pid"),
  };
}

function getStateLockMode(value: string): StateLockMode {
  if (value === "read" || value === "write") {
    return value;
  }

  return "write";
}

function locksConflict(
  requested: StateLockMode,
  existing: StateLockMode,
): boolean {
  return requested === "write" || existing === "write";
}

function isStateLockStale(
  lock: Pick<StateLockRow, "heartbeatAt" | "ownerPid">,
  staleMs = DEFAULT_STATE_LOCK_STALE_MS,
): boolean {
  return (
    Date.now() - lock.heartbeatAt > staleMs || !isProcessAlive(lock.ownerPid)
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

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

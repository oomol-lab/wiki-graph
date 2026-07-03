import { createHash } from "crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { dirname, resolve } from "path";
import { setTimeout as sleep } from "timers/promises";

import { isNodeError } from "../utils/node-error.js";

import { Database } from "./database.js";

const INIT_LOCK_RETRY_MS = 50;
const INIT_LOCK_STALE_MS = 5 * 60 * 1000;
const INIT_LOCK_HEARTBEAT_MS = Math.floor(INIT_LOCK_STALE_MS / 2);

interface InitLockOwner {
  readonly at: number;
  readonly pid: number;
}

export async function openSharedStateDatabase(
  databasePath: string,
  schemaSql: string,
  options: { readonly readonly?: boolean } = {},
): Promise<Database> {
  await ensureSharedStateDatabaseInitialized(databasePath, schemaSql);

  return await Database.open(databasePath, "", options);
}

export async function ensureSharedStateDatabaseInitialized(
  databasePath: string,
  schemaSql: string,
): Promise<void> {
  const resolvedDatabasePath = resolve(databasePath);
  const markerPath = createInitMarkerPath(resolvedDatabasePath);
  const schemaHash = hashSchema(schemaSql);

  if (await hasInitMarker(markerPath, schemaHash)) {
    return;
  }

  await mkdir(dirname(resolvedDatabasePath), { recursive: true });
  await withInitLock(resolvedDatabasePath, async () => {
    if (await hasInitMarker(markerPath, schemaHash)) {
      await hardenSharedStateFile(markerPath);
      return;
    }

    await Database.initialize(resolvedDatabasePath, schemaSql);
    await hardenSharedStateFile(resolvedDatabasePath);
    await writeInitMarker(markerPath, schemaHash);
  });
  await hardenSharedStateFile(resolvedDatabasePath);
  await hardenSharedStateFile(markerPath);
}

async function writeInitMarker(
  markerPath: string,
  schemaHash: string,
): Promise<void> {
  const tempPath = `${markerPath}.${process.pid}.tmp`;

  await writeFile(tempPath, `${schemaHash}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tempPath, markerPath);
  await hardenSharedStateFile(markerPath);
}

async function withInitLock<T>(
  databasePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${databasePath}.init.lock`;

  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }

      await removeStaleInitLock(lockPath);
      await sleep(INIT_LOCK_RETRY_MS);
    }
  }

  try {
    await writeInitLockOwner(lockPath);
    const heartbeat = setInterval(() => {
      void writeInitLockOwner(lockPath).catch(() => undefined);
    }, INIT_LOCK_HEARTBEAT_MS);

    try {
      return await operation();
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

async function writeInitLockOwner(lockPath: string): Promise<void> {
  await writeFile(
    `${lockPath}/owner.json`,
    `${JSON.stringify(
      {
        at: Date.now(),
        pid: process.pid,
      },
      null,
      2,
    )}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

async function removeStaleInitLock(lockPath: string): Promise<void> {
  try {
    const owner = await readInitLockOwner(lockPath);

    if (owner !== undefined) {
      if (isProcessAlive(owner.pid)) {
        return;
      }

      if (Date.now() - owner.at < INIT_LOCK_STALE_MS) {
        return;
      }
    } else if (!(await isPathOlderThan(lockPath, INIT_LOCK_STALE_MS))) {
      return;
    }

    await rm(lockPath, { force: true, recursive: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

async function readInitLockOwner(
  lockPath: string,
): Promise<InitLockOwner | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(`${lockPath}/owner.json`, "utf8"),
    ) as unknown;

    if (isInitLockOwner(parsed)) {
      return parsed;
    }

    return undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    if (error instanceof SyntaxError) {
      return undefined;
    }

    throw error;
  }
}

function isInitLockOwner(value: unknown): value is InitLockOwner {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.pid === "number" &&
    Number.isInteger(record.pid) &&
    record.pid > 0 &&
    typeof record.at === "number"
  );
}

async function isPathOlderThan(path: string, ms: number): Promise<boolean> {
  const pathStat = await stat(path);

  return Date.now() - pathStat.mtimeMs >= ms;
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

async function hasInitMarker(
  markerPath: string,
  schemaHash: string,
): Promise<boolean> {
  try {
    return (await readFile(markerPath, "utf8")).trim() === schemaHash;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function createInitMarkerPath(databasePath: string): string {
  return `${databasePath}.initialized`;
}

async function hardenSharedStateFile(path: string): Promise<void> {
  try {
    await chmod(path, 0o600);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function hashSchema(schemaSql: string): string {
  return createHash("sha256").update(schemaSql).digest("hex");
}

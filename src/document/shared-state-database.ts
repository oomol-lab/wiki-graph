import { createHash } from "crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { setTimeout as sleep } from "timers/promises";

import { isNodeError } from "../utils/node-error.js";

import { Database } from "./database.js";

const INIT_LOCK_RETRY_MS = 50;
const INIT_LOCK_STALE_MS = 5 * 60 * 1000;

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
      return;
    }

    await Database.initialize(resolvedDatabasePath, schemaSql);
    await writeInitMarker(markerPath, schemaHash);
  });
}

async function writeInitMarker(
  markerPath: string,
  schemaHash: string,
): Promise<void> {
  const tempPath = `${markerPath}.${process.pid}.tmp`;

  await writeFile(tempPath, `${schemaHash}\n`, "utf8");
  await rename(tempPath, markerPath);
}

async function withInitLock<T>(
  databasePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${databasePath}.init.lock`;

  while (true) {
    try {
      await mkdir(lockPath);
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
      "utf8",
    );

    return await operation();
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

async function removeStaleInitLock(lockPath: string): Promise<void> {
  try {
    const lockStat = await stat(lockPath);

    if (Date.now() - lockStat.mtimeMs < INIT_LOCK_STALE_MS) {
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

function hashSchema(schemaSql: string): string {
  return createHash("sha256").update(schemaSql).digest("hex");
}

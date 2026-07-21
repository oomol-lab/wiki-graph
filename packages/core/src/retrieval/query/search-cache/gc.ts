import { stat } from "fs/promises";

import { getNumber, getString } from "../../../document/database.js";
import type { Database } from "../../../document/index.js";
import type { GcContext, GcJobResult } from "../../../runtime/gc/index.js";
import { isNodeError } from "../../../utils/node-error.js";

import {
  getSearchSessionDatabasePath,
  openSearchSessionDatabase,
} from "./database.js";
import { SEARCH_SESSION_MAX_COUNT } from "./schema.js";
import { deleteSearchSession, deleteUnusedPredicates } from "./store.js";

export async function deleteArchiveSearchSessions(
  archiveKey: string,
): Promise<void> {
  const database = await openSearchSessionDatabase();

  try {
    const sessionIds = await database.queryAll(
      `
        SELECT session_id
        FROM search_sessions
        WHERE archive_key = ?
      `,
      [archiveKey],
      (row) => getString(row, "session_id"),
    );

    await database.transaction(async () => {
      for (const sessionId of sessionIds) {
        await deleteSearchSession(database, sessionId);
      }
      await deleteUnusedPredicates(database);
    });
  } finally {
    await database.close();
  }
}

export async function runSearchCacheGc(
  context: GcContext,
): Promise<GcJobResult> {
  const databasePath = getSearchSessionDatabasePath();
  const beforeBytes = await readFileSize(databasePath);
  const database = await openSearchSessionDatabase();

  try {
    const scanned = await database.queryOne(
      "SELECT COUNT(*) AS count FROM search_sessions",
      undefined,
      (row) => getNumber(row, "count"),
    );
    const expiredSessionIds = context.force
      ? await listAllSearchSessionIds(database)
      : await listExpiredSearchSessionIds(database, context.now);
    const prunedSessionIds = context.force
      ? []
      : await listPrunedSearchSessionIds(database);
    const sessionIds = [
      ...new Set([...expiredSessionIds, ...prunedSessionIds]),
    ].sort();

    if (!context.dryRun && sessionIds.length > 0) {
      await database.transaction(async () => {
        for (const sessionId of sessionIds) {
          await deleteSearchSession(database, sessionId);
        }
        await deleteUnusedPredicates(database);
      });
      await database.run("VACUUM");
    }

    const afterBytes = await readFileSize(databasePath);

    return {
      freedBytes: Math.max(0, beforeBytes - afterBytes),
      removed: sessionIds.length,
      scanned: scanned ?? 0,
    };
  } finally {
    await database.close();
  }
}

async function listExpiredSearchSessionIds(
  database: Database,
  now: number,
): Promise<string[]> {
  return await database.queryAll(
    `
      SELECT session_id
      FROM search_sessions
      WHERE expires_at < ?
    `,
    [now],
    (row) => getString(row, "session_id"),
  );
}

async function listAllSearchSessionIds(database: Database): Promise<string[]> {
  return await database.queryAll(
    "SELECT session_id FROM search_sessions",
    undefined,
    (row) => getString(row, "session_id"),
  );
}

async function listPrunedSearchSessionIds(
  database: Database,
): Promise<string[]> {
  return await database.queryAll(
    `
      SELECT session_id
      FROM search_sessions
      ORDER BY accessed_at DESC, created_at DESC, session_id
      LIMIT -1 OFFSET ?
    `,
    [SEARCH_SESSION_MAX_COUNT],
    (row) => getString(row, "session_id"),
  );
}

async function readFileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }

    throw error;
  }
}

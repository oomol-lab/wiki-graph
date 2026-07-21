import { getNumber, getString } from "../../../document/database.js";
import type { Database } from "../../../document/index.js";

import { openSearchSessionDatabase } from "./database.js";
import { parseSessionOptions, parseStringArray } from "./parsing.js";
import { SEARCH_SESSION_TTL_MS } from "./schema.js";

export async function hasSearchSession(
  sessionId: string,
  archiveKey: string,
): Promise<boolean> {
  const database = await openSearchSessionDatabase();

  try {
    const row = await database.queryOne(
      `
        SELECT session_id
        FROM search_sessions
        WHERE session_id = ? AND archive_key = ?
          AND expires_at >= ?
      `,
      [sessionId, archiveKey, Date.now()],
      () => true,
    );

    return row === true;
  } finally {
    await database.close();
  }
}

export async function readSearchSessionMetadata(
  database: Database,
  sessionId: string,
  expectedArchiveKey: string | undefined,
  expectedCreatedAt?: number,
): Promise<{
  readonly createdAt: number;
  readonly lens: string;
  readonly match: string;
  readonly options: {
    readonly chapters: readonly number[] | null;
    readonly types: readonly string[] | null;
  };
  readonly query: string;
  readonly sessionId: string;
  readonly terms: readonly string[];
  readonly expiresAt: number;
  readonly objectCachesPopulated: boolean;
}> {
  const session = await database.queryOne(
    `
      SELECT
        session_id,
        query,
        options_json,
        terms_json,
        lens,
        match,
        object_caches_populated,
        created_at,
        expires_at
      FROM search_sessions
      WHERE session_id = ?
        ${expectedArchiveKey === undefined ? "" : "AND archive_key = ?"}
        ${expectedCreatedAt === undefined ? "" : "AND created_at = ?"}
    `,
    [
      sessionId,
      ...(expectedArchiveKey === undefined ? [] : [expectedArchiveKey]),
      ...(expectedCreatedAt === undefined ? [] : [expectedCreatedAt]),
    ],
    (row) => ({
      createdAt: getNumber(row, "created_at"),
      expiresAt: getNumber(row, "expires_at"),
      lens: getString(row, "lens"),
      match: getString(row, "match"),
      objectCachesPopulated: getNumber(row, "object_caches_populated") !== 0,
      options: parseSessionOptions(getString(row, "options_json")),
      query: getString(row, "query"),
      sessionId: getString(row, "session_id"),
      terms: parseStringArray(getString(row, "terms_json")),
    }),
  );

  if (session === undefined || session.expiresAt < Date.now()) {
    throw new Error("Search cursor expired. Run the search again.");
  }

  return session;
}

export async function touchSearchSession(
  database: Database,
  sessionId: string,
): Promise<void> {
  await database.run(
    `
      UPDATE search_sessions
      SET accessed_at = ?, expires_at = ?
      WHERE session_id = ?
    `,
    [Date.now(), Date.now() + SEARCH_SESSION_TTL_MS, sessionId],
  );
}

export async function deleteSearchSession(
  database: Database,
  sessionId: string,
): Promise<void> {
  await database.run("DELETE FROM search_results WHERE session_id = ?", [
    sessionId,
  ]);
  await database.run(
    "DELETE FROM search_evidence_hit_events WHERE session_id = ?",
    [sessionId],
  );
  await database.run("DELETE FROM search_entity_hits WHERE session_id = ?", [
    sessionId,
  ]);
  await database.run("DELETE FROM search_triple_hits WHERE session_id = ?", [
    sessionId,
  ]);
  await database.run("DELETE FROM search_chunk_hits WHERE session_id = ?", [
    sessionId,
  ]);
  await database.run("DELETE FROM search_sessions WHERE session_id = ?", [
    sessionId,
  ]);
}

export async function deleteUnusedPredicates(database: Database): Promise<void> {
  await database.run(`
    DELETE FROM predicate_dictionary
    WHERE NOT EXISTS (
      SELECT 1
      FROM search_triple_hits
      WHERE search_triple_hits.predicate_id = predicate_dictionary.id
    )
  `);
}

import { mkdir } from "fs/promises";
import { createHash } from "crypto";
import { join, resolve } from "path";

import { resolveWikiGraphStateDirectoryPath } from "../common/wiki-graph-dir.js";
import { getNumber, getString } from "../document/database.js";
import { Database } from "../document/index.js";

import type { ArchiveFindHit } from "./archive-view.js";

export interface SearchSessionInput {
  readonly archiveKey: string;
  readonly chapters: readonly number[] | null;
  readonly items: readonly ArchiveFindHit[];
  readonly lens: string;
  readonly match: string;
  readonly query: string;
  readonly terms: readonly string[];
  readonly types: readonly string[] | null;
}

export interface SearchSessionPage {
  readonly chapters: readonly number[] | null;
  readonly items: readonly ArchiveFindHit[];
  readonly lens: string;
  readonly match: string;
  readonly nextCursor: string | null;
  readonly query: string;
  readonly sessionId: string;
  readonly terms: readonly string[];
  readonly types: readonly string[] | null;
}

const SEARCH_SESSION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS search_sessions (
  session_id TEXT PRIMARY KEY,
  archive_key TEXT NOT NULL,
  query TEXT NOT NULL,
  options_json TEXT NOT NULL,
  terms_json TEXT NOT NULL,
  lens TEXT NOT NULL,
  match TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_results (
  session_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  item_json TEXT NOT NULL,
  PRIMARY KEY (session_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_search_sessions_expires
ON search_sessions(expires_at);
`;

const SEARCH_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export async function createSearchSession(
  input: SearchSessionInput,
): Promise<string> {
  const database = await openSearchSessionDatabase();

  try {
    await cleanExpiredSearchSessions(database);
    const now = Date.now();
    const sessionId = createSearchSessionId(input, now);
    const optionsJSON = JSON.stringify({
      chapters: input.chapters,
      types: input.types,
    });

    await database.transaction(async () => {
      await database.run(
        `
          INSERT INTO search_sessions (
            session_id, archive_key, query, options_json, terms_json, lens,
            match, created_at, expires_at, accessed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          sessionId,
          input.archiveKey,
          input.query,
          optionsJSON,
          JSON.stringify(input.terms),
          input.lens,
          input.match,
          now,
          now + SEARCH_SESSION_TTL_MS,
          now,
        ],
      );

      for (const [index, item] of input.items.entries()) {
        await database.run(
          `
            INSERT INTO search_results (session_id, rank, item_json)
            VALUES (?, ?, ?)
          `,
          [sessionId, index, JSON.stringify(item)],
        );
      }
    });

    return sessionId;
  } finally {
    await database.close();
  }
}

export async function readSearchSessionPage(
  sessionId: string,
  offset: number,
  limit: number,
  expectedArchiveKey?: string,
): Promise<SearchSessionPage> {
  const database = await openSearchSessionDatabase();

  try {
    await cleanExpiredSearchSessions(database);
    const session = await database.queryOne(
      `
        SELECT
          session_id,
          query,
          options_json,
          terms_json,
          lens,
          match
        FROM search_sessions
        WHERE session_id = ?
          ${expectedArchiveKey === undefined ? "" : "AND archive_key = ?"}
      `,
      expectedArchiveKey === undefined
        ? [sessionId]
        : [sessionId, expectedArchiveKey],
      (row) => ({
        lens: getString(row, "lens"),
        match: getString(row, "match"),
        options: parseSessionOptions(getString(row, "options_json")),
        query: getString(row, "query"),
        sessionId: getString(row, "session_id"),
        terms: parseStringArray(getString(row, "terms_json")),
      }),
    );

    if (session === undefined) {
      throw new Error("Search cursor expired. Run the search again.");
    }

    await database.run(
      `
        UPDATE search_sessions
        SET accessed_at = ?, expires_at = ?
        WHERE session_id = ?
      `,
      [Date.now(), Date.now() + SEARCH_SESSION_TTL_MS, sessionId],
    );

    const rows = await database.queryAll(
      `
        SELECT rank, item_json
        FROM search_results
        WHERE session_id = ? AND rank >= ?
        ORDER BY rank
        LIMIT ?
      `,
      [sessionId, offset, limit + 1],
      (row) => ({
        item: parseSearchResultItem(getString(row, "item_json")),
        rank: getNumber(row, "rank"),
      }),
    );
    const items = rows.slice(0, limit).map((row) => row.item);
    const last = rows.at(limit - 1);

    return {
      chapters: session.options.chapters,
      items,
      lens: session.lens,
      match: session.match,
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeSearchSessionCursor(sessionId, last.rank + 1)
          : null,
      query: session.query,
      sessionId,
      terms: session.terms,
      types: session.options.types,
    };
  } finally {
    await database.close();
  }
}

export function encodeSearchSessionCursor(
  sessionId: string,
  offset: number,
): string {
  return Buffer.from(JSON.stringify({ offset, sessionId, v: 2 })).toString(
    "base64url",
  );
}

export function decodeSearchSessionCursor(cursor: string): {
  readonly offset: number;
  readonly sessionId: string;
} {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "offset" in parsed &&
      "sessionId" in parsed &&
      "v" in parsed &&
      parsed.v === 2 &&
      typeof parsed.sessionId === "string" &&
      parsed.sessionId !== "" &&
      typeof parsed.offset === "number" &&
      Number.isInteger(parsed.offset) &&
      parsed.offset >= 0
    ) {
      return { offset: parsed.offset, sessionId: parsed.sessionId };
    }
  } catch {
    throw new Error("Invalid search cursor.");
  }

  throw new Error("Invalid search cursor.");
}

async function openSearchSessionDatabase(): Promise<Database> {
  const stateDirectoryPath = getSearchSessionStateDirectoryPath();

  await mkdir(stateDirectoryPath, { recursive: true });
  return await Database.open(
    join(stateDirectoryPath, "search-sessions.sqlite"),
    SEARCH_SESSION_SCHEMA_SQL,
  );
}

function getSearchSessionStateDirectoryPath(): string {
  const stateDirectoryPath = process.env.SPINEDIGEST_STATE_DIR;

  if (stateDirectoryPath !== undefined && stateDirectoryPath.trim() !== "") {
    return resolve(stateDirectoryPath);
  }

  return resolveWikiGraphStateDirectoryPath();
}

async function cleanExpiredSearchSessions(database: Database): Promise<void> {
  const now = Date.now();
  const expiredSessionIds = await database.queryAll(
    `
      SELECT session_id
      FROM search_sessions
      WHERE expires_at < ?
    `,
    [now],
    (row) => getString(row, "session_id"),
  );

  if (expiredSessionIds.length === 0) {
    return;
  }

  await database.transaction(async () => {
    for (const sessionId of expiredSessionIds) {
      await database.run("DELETE FROM search_results WHERE session_id = ?", [
        sessionId,
      ]);
      await database.run("DELETE FROM search_sessions WHERE session_id = ?", [
        sessionId,
      ]);
    }
  });
}

function createSearchSessionId(input: SearchSessionInput, now: number): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        archiveKey: input.archiveKey,
        now,
        query: input.query,
      }),
    )
    .digest("hex");
}

function parseSearchResultItem(value: string): ArchiveFindHit {
  const parsed: unknown = JSON.parse(value);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid cached search result.");
  }

  return parsed as ArchiveFindHit;
}

function parseSessionOptions(value: string): {
  readonly chapters: readonly number[] | null;
  readonly types: readonly string[] | null;
} {
  const parsed: unknown = JSON.parse(value);

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "chapters" in parsed &&
    "types" in parsed &&
    (parsed.chapters === null ||
      (Array.isArray(parsed.chapters) &&
        parsed.chapters.every((chapter) => typeof chapter === "number"))) &&
    (parsed.types === null ||
      (Array.isArray(parsed.types) &&
        parsed.types.every((type) => typeof type === "string")))
  ) {
    return {
      chapters: parsed.chapters,
      types: parsed.types,
    };
  }

  throw new Error("Invalid cached search session.");
}

function parseStringArray(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);

  if (
    Array.isArray(parsed) &&
    parsed.every((item) => typeof item === "string")
  ) {
    return parsed;
  }

  throw new Error("Invalid cached search session.");
}

import { createHash } from "crypto";
import { join, resolve } from "path";

import { resolveWikiGraphStateDirectoryPath } from "../common/wiki-graph-dir.js";
import {
  getNumber,
  getOptionalString,
  getString,
} from "../document/database.js";
import type { SqlBindValue } from "../document/database.js";
import { openSharedStateDatabase } from "../document/index.js";
import type { Database } from "../document/index.js";

import type { ArchiveFindHit } from "./archive-view.js";

export interface SearchSessionInput {
  readonly archiveKey: string;
  readonly chapters: readonly number[] | null;
  readonly items: readonly ArchiveFindHit[];
  readonly lens: string;
  readonly match: string;
  readonly order: string;
  readonly query: string;
  readonly records: readonly ArchiveFindHit[];
  readonly terms: readonly string[];
  readonly types: readonly string[] | null;
}

export interface EntitySearchMentionHit {
  readonly chapterId: number;
  readonly confidence?: number;
  readonly fragmentId: number;
  readonly matchCount: number;
  readonly matchedTerms: readonly string[];
  readonly mentionId: string;
  readonly missingTerms: readonly string[];
  readonly note?: string;
  readonly qid: string;
  readonly rangeEnd: number;
  readonly rangeStart: number;
  readonly resultScore: number;
  readonly score: number;
  readonly sentenceIndex?: number;
  readonly surface: string;
}

export interface EntitySearchSessionInput {
  readonly archiveKey: string;
  readonly chapters: readonly number[] | null;
  readonly hits: readonly EntitySearchMentionHit[];
  readonly lens: string;
  readonly match: string;
  readonly order: string;
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

export interface EntitySearchSessionPage {
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

export interface SearchSessionDescriptor {
  readonly chapters: readonly number[] | null;
  readonly lens: string;
  readonly match: string;
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

CREATE TABLE IF NOT EXISTS search_record_hits (
  session_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  item_json TEXT NOT NULL,
  PRIMARY KEY (session_id, rank)
);

CREATE TABLE IF NOT EXISTS search_mention_hits (
  session_id TEXT NOT NULL,
  mention_id TEXT NOT NULL,
  qid TEXT NOT NULL,
  chapter_id INTEGER NOT NULL,
  fragment_id INTEGER NOT NULL,
  sentence_index INTEGER,
  range_start INTEGER NOT NULL,
  range_end INTEGER NOT NULL,
  surface TEXT NOT NULL,
  note TEXT,
  confidence REAL,
  score REAL NOT NULL,
  result_score REAL NOT NULL DEFAULT 0,
  match_count INTEGER NOT NULL,
  matched_terms_json TEXT NOT NULL,
  missing_terms_json TEXT NOT NULL,
  PRIMARY KEY (session_id, mention_id)
);

CREATE INDEX IF NOT EXISTS idx_search_mention_hits_entity_rank
ON search_mention_hits(session_id, qid, score DESC, chapter_id, fragment_id, sentence_index, range_start);

CREATE INDEX IF NOT EXISTS idx_search_mention_hits_session_rank
ON search_mention_hits(session_id, score DESC, chapter_id, fragment_id, sentence_index, range_start);

CREATE INDEX IF NOT EXISTS idx_search_sessions_expires
ON search_sessions(expires_at);
`;

const SEARCH_SESSION_MIGRATION_SQL = `
ALTER TABLE search_mention_hits
ADD COLUMN result_score REAL NOT NULL DEFAULT 0;
`;

const SEARCH_RANKING_VERSION = 2;
const SEARCH_SESSION_MAX_COUNT = 500;
const SEARCH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type SearchSessionCacheInput = Omit<SearchSessionInput, "items" | "records">;
type EntitySearchSessionCacheInput = Omit<EntitySearchSessionInput, "hits">;

export async function readCachedSearchSessionPage(
  input: SearchSessionCacheInput,
  offset: number,
  limit: number,
): Promise<SearchSessionPage | undefined> {
  const sessionId = createSearchSessionId(input);

  if (!(await hasSearchSession(sessionId, input.archiveKey))) {
    return undefined;
  }

  return await readSearchSessionPage(sessionId, offset, limit, input.archiveKey);
}

export async function readCachedEntitySearchSessionPage(
  input: EntitySearchSessionCacheInput,
  offset: number,
  limit: number,
): Promise<EntitySearchSessionPage | undefined> {
  const sessionId = createEntitySearchSessionId(input);

  if (!(await hasSearchSession(sessionId, input.archiveKey))) {
    return undefined;
  }

  return await readEntitySearchSessionPage(
    sessionId,
    offset,
    limit,
    input.archiveKey,
  );
}

export async function createSearchSession(
  input: SearchSessionInput,
): Promise<string> {
  const database = await openSearchSessionDatabase();

  try {
    await cleanExpiredSearchSessions(database);
    const now = Date.now();
    const sessionId = createSearchSessionId(input);
    const optionsJSON = JSON.stringify({
      chapters: input.chapters,
      order: input.order,
      types: input.types,
    });

    await database.transaction(async () => {
      await deleteSearchSession(database, sessionId);
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
      for (const [index, record] of input.records.entries()) {
        await database.run(
          `
            INSERT INTO search_record_hits (session_id, rank, item_json)
            VALUES (?, ?, ?)
          `,
          [sessionId, index, JSON.stringify(record)],
        );
      }
      await pruneSearchSessions(database);
    });

    return sessionId;
  } finally {
    await database.close();
  }
}

export async function createEntitySearchSession(
  input: EntitySearchSessionInput,
): Promise<string> {
  const database = await openSearchSessionDatabase();

  try {
    await cleanExpiredSearchSessions(database);
    const now = Date.now();
    const sessionId = createEntitySearchSessionId(input);
    const optionsJSON = JSON.stringify({
      chapters: input.chapters,
      order: input.order,
      types: input.types,
    });

    await database.transaction(async () => {
      await deleteSearchSession(database, sessionId);
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

      for (const hit of input.hits) {
        await database.run(
          `
            INSERT INTO search_mention_hits (
              session_id, mention_id, qid, chapter_id, fragment_id,
              sentence_index, range_start, range_end, surface, note,
              confidence, score, result_score, match_count, matched_terms_json,
              missing_terms_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            sessionId,
            hit.mentionId,
            hit.qid,
            hit.chapterId,
            hit.fragmentId,
            hit.sentenceIndex ?? null,
            hit.rangeStart,
            hit.rangeEnd,
            hit.surface,
            hit.note ?? null,
            hit.confidence ?? null,
            hit.score,
            hit.resultScore,
            hit.matchCount,
            JSON.stringify(hit.matchedTerms),
            JSON.stringify(hit.missingTerms),
          ],
        );
      }
      await pruneSearchSessions(database);
    });

    return sessionId;
  } finally {
    await database.close();
  }
}

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
    });
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
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
    );

    await touchSearchSession(database, sessionId);

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

export async function readEntitySearchSessionPage(
  sessionId: string,
  offset: number,
  limit: number,
  expectedArchiveKey?: string,
): Promise<EntitySearchSessionPage> {
  const database = await openSearchSessionDatabase();

  try {
    await cleanExpiredSearchSessions(database);
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
    );

    await touchSearchSession(database, sessionId);

    const rows = await database.queryAll(
      `
        SELECT
          qid,
          surface,
          note,
          score,
          result_score,
          match_count,
          matched_terms_json,
          missing_terms_json,
          chapter_id,
          fragment_id,
          evidence_count
        FROM (
          SELECT
            qid,
            surface,
            note,
            score,
            result_score,
            match_count,
            matched_terms_json,
            missing_terms_json,
            chapter_id,
            fragment_id,
            COUNT(*) OVER (PARTITION BY qid) AS evidence_count,
            ROW_NUMBER() OVER (
              PARTITION BY qid
              ORDER BY score DESC, chapter_id, fragment_id,
                COALESCE(sentence_index, 2147483647), range_start, mention_id
            ) AS entity_row_number
          FROM search_mention_hits
          WHERE session_id = ?
        )
        WHERE entity_row_number = 1
        ORDER BY result_score DESC, score DESC, match_count DESC, chapter_id, fragment_id, qid
        LIMIT ? OFFSET ?
      `,
      [sessionId, limit + 1, offset],
      mapEntitySearchObjectRow,
    );
    const items = rows.slice(0, limit);
    const nextOffset = offset + items.length;

    return {
      chapters: session.options.chapters,
      items,
      lens: session.lens,
      match: session.match,
      nextCursor:
        rows.length > limit
          ? encodeSearchSessionCursor(sessionId, nextOffset)
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

export async function readSearchSessionDescriptor(
  sessionId: string,
  expectedArchiveKey?: string,
): Promise<SearchSessionDescriptor> {
  const database = await openSearchSessionDatabase();

  try {
    await cleanExpiredSearchSessions(database);
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
    );

    await touchSearchSession(database, sessionId);

    return {
      chapters: session.options.chapters,
      lens: session.lens,
      match: session.match,
      query: session.query,
      sessionId,
      terms: session.terms,
      types: session.options.types,
    };
  } finally {
    await database.close();
  }
}

export async function readEntitySearchEvidenceMentions(
  sessionId: string,
  qid: string,
  limit: number,
): Promise<readonly EntitySearchMentionHit[]> {
  const database = await openSearchSessionDatabase();

  try {
    return await database.queryAll(
      `
        SELECT
          mention_id,
          qid,
          chapter_id,
          fragment_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          note,
          confidence,
          score,
          result_score,
          match_count,
          matched_terms_json,
          missing_terms_json
        FROM search_mention_hits
        WHERE session_id = ? AND qid = ?
        ORDER BY score DESC, chapter_id, fragment_id,
          COALESCE(sentence_index, 2147483647), range_start, mention_id
        LIMIT ?
      `,
      [sessionId, qid, limit],
      mapEntitySearchMentionHitRow,
    );
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
  const database = await openSharedStateDatabase(
    join(getSearchSessionStateDirectoryPath(), "search-sessions.sqlite"),
    SEARCH_SESSION_SCHEMA_SQL,
  );

  await runSearchSessionMigrations(database);

  return database;
}

async function runSearchSessionMigrations(database: Database): Promise<void> {
  try {
    await database.run(SEARCH_SESSION_MIGRATION_SQL);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("duplicate column name")
    ) {
      return;
    }

    throw error;
  }
}

function getSearchSessionStateDirectoryPath(): string {
  const stateDirectoryPath = process.env.WIKIGRAPH_STATE_DIR;

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
      await deleteSearchSession(database, sessionId);
    }
  });
}

async function hasSearchSession(
  sessionId: string,
  archiveKey: string,
): Promise<boolean> {
  const database = await openSearchSessionDatabase();

  try {
    await cleanExpiredSearchSessions(database);
    const row = await database.queryOne(
      `
        SELECT session_id
        FROM search_sessions
        WHERE session_id = ? AND archive_key = ?
      `,
      [sessionId, archiveKey],
      () => true,
    );

    return row === true;
  } finally {
    await database.close();
  }
}

async function deleteSearchSession(
  database: Database,
  sessionId: string,
): Promise<void> {
  await database.run("DELETE FROM search_results WHERE session_id = ?", [
    sessionId,
  ]);
  await database.run("DELETE FROM search_record_hits WHERE session_id = ?", [
    sessionId,
  ]);
  await database.run("DELETE FROM search_mention_hits WHERE session_id = ?", [
    sessionId,
  ]);
  await database.run("DELETE FROM search_sessions WHERE session_id = ?", [
    sessionId,
  ]);
}

async function pruneSearchSessions(database: Database): Promise<void> {
  const prunedSessionIds = await database.queryAll(
    `
      SELECT session_id
      FROM search_sessions
      ORDER BY accessed_at DESC, created_at DESC, session_id
      LIMIT -1 OFFSET ?
    `,
    [SEARCH_SESSION_MAX_COUNT],
    (row) => getString(row, "session_id"),
  );

  for (const sessionId of prunedSessionIds) {
    await deleteSearchSession(database, sessionId);
  }
}

async function readSearchSessionMetadata(
  database: Database,
  sessionId: string,
  expectedArchiveKey: string | undefined,
): Promise<{
  readonly lens: string;
  readonly match: string;
  readonly options: {
    readonly chapters: readonly number[] | null;
    readonly types: readonly string[] | null;
  };
  readonly query: string;
  readonly sessionId: string;
  readonly terms: readonly string[];
}> {
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

  return session;
}

async function touchSearchSession(
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

function createEntitySearchSessionId(input: EntitySearchSessionCacheInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        archiveKey: input.archiveKey,
        entity: true,
        lens: input.lens,
        match: input.match,
        order: input.order,
        rankingVersion: SEARCH_RANKING_VERSION,
        scope: normalizeSearchSessionScope(input.chapters),
        terms: input.terms,
        types: normalizeSearchSessionTypes(input.types),
      }),
    )
    .digest("hex");
}

function mapEntitySearchObjectRow(
  row: Record<string, SqlBindValue>,
): ArchiveFindHit {
  const qid = getString(row, "qid");
  const chapterId = getNumber(row, "chapter_id");
  const fragmentId = getNumber(row, "fragment_id");
  const matchedTerms = parseStringArray(getString(row, "matched_terms_json"));
  const missingTerms = parseStringArray(getString(row, "missing_terms_json"));

  return {
    chapter: chapterId,
    evidence: {
      nextCursor: null,
      shown: 0,
      sources: [],
      total: getNumber(row, "evidence_count"),
    },
    field: "title",
    id: `wikigraph://entity/${qid}`,
    matchCount: getNumber(row, "match_count"),
    matchedTerms,
    missingTerms,
    position: {
      chapter: chapterId,
      fragment: fragmentId,
    },
    score: getNumber(row, "result_score"),
    snippet: getOptionalString(row, "note") ?? getString(row, "surface"),
    title: getString(row, "surface"),
    type: "entity",
  };
}

function mapEntitySearchMentionHitRow(
  row: Record<string, SqlBindValue>,
): EntitySearchMentionHit {
  const sentenceIndex =
    row.sentence_index === null ? undefined : getNumber(row, "sentence_index");
  const confidence =
    row.confidence === null ? undefined : getNumber(row, "confidence");
  const note = getOptionalString(row, "note");

  return {
    chapterId: getNumber(row, "chapter_id"),
    ...(confidence === undefined ? {} : { confidence }),
    fragmentId: getNumber(row, "fragment_id"),
    matchCount: getNumber(row, "match_count"),
    matchedTerms: parseStringArray(getString(row, "matched_terms_json")),
    mentionId: getString(row, "mention_id"),
    missingTerms: parseStringArray(getString(row, "missing_terms_json")),
    ...(note === undefined ? {} : { note }),
    qid: getString(row, "qid"),
    rangeEnd: getNumber(row, "range_end"),
    rangeStart: getNumber(row, "range_start"),
    resultScore: getNumber(row, "result_score"),
    score: getNumber(row, "score"),
    ...(sentenceIndex === undefined ? {} : { sentenceIndex }),
    surface: getString(row, "surface"),
  };
}

function createSearchSessionId(input: SearchSessionCacheInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        archiveKey: input.archiveKey,
        entity: false,
        lens: input.lens,
        match: input.match,
        order: input.order,
        rankingVersion: SEARCH_RANKING_VERSION,
        scope: normalizeSearchSessionScope(input.chapters),
        terms: input.terms,
        types: normalizeSearchSessionTypes(input.types),
      }),
    )
    .digest("hex");
}

function normalizeSearchSessionScope(
  chapters: readonly number[] | null,
): readonly number[] | null {
  return chapters === null ? null : [...new Set(chapters)].sort(compareNumbers);
}

function normalizeSearchSessionTypes(
  types: readonly string[] | null,
): readonly string[] | null {
  return types === null ? null : [...new Set(types)].sort();
}

function compareNumbers(left: number, right: number): number {
  return left - right;
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

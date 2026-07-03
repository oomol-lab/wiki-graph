import { createHash } from "crypto";
import { stat } from "fs/promises";
import { join, resolve } from "path";

import { resolveWikiGraphStateDirectoryPath } from "../../common/wiki-graph-dir.js";
import { getNumber, getString } from "../../document/database.js";
import type { SqlBindValue } from "../../document/database.js";
import { openSharedStateDatabase } from "../../document/index.js";
import type { Database } from "../../document/index.js";
import type { GcContext, GcJobResult } from "../../gc/index.js";
import { isNodeError } from "../../utils/node-error.js";

import type { ArchiveFindHit } from "./archive-view.js";

export interface SearchSessionInput {
  readonly archiveKey: string;
  readonly chapters: readonly number[] | null;
  readonly chunkHits?: readonly SearchChunkHitInput[];
  readonly entityHits?: readonly SearchEntityHitInput[];
  readonly evidenceEvents?: readonly SearchEvidenceHitEventInput[];
  readonly items: readonly ArchiveFindHit[];
  readonly lens: string;
  readonly match: string;
  readonly order: string;
  readonly query: string;
  readonly revisionScope: string;
  readonly terms: readonly string[];
  readonly tripleHits?: readonly SearchTripleHitInput[];
  readonly types: readonly string[] | null;
}

export const SEARCH_EVIDENCE_KIND = {
  mention: 1,
  mentionLink: 2,
  chunk: 3,
} as const;

export type SearchEvidenceKind =
  (typeof SEARCH_EVIDENCE_KIND)[keyof typeof SEARCH_EVIDENCE_KIND];

export interface SearchEvidenceHitEventInput {
  readonly chapterId: number;
  readonly evidenceId: string;
  readonly evidenceKind: SearchEvidenceKind;
  readonly score: number;
  readonly sentenceIndex: number;
}

export interface SearchEntityHitInput {
  readonly evidenceTopScores?: readonly number[];
  readonly propertyTopScores?: readonly number[];
  readonly qid: string;
}

export interface SearchTripleHitInput {
  readonly evidenceTopScores: readonly number[];
  readonly objectQid: string;
  readonly predicate: string;
  readonly subjectQid: string;
}

export interface SearchChunkHitInput {
  readonly chunkId: number;
  readonly evidenceTopScores?: readonly number[];
  readonly propertyTopScores?: readonly number[];
}

export interface EntitySearchSessionInput {
  readonly archiveKey: string;
  readonly chapters: readonly number[] | null;
  readonly chunkHits?: readonly SearchChunkHitInput[];
  readonly entityHits?: readonly SearchEntityHitInput[];
  readonly evidenceEvents?: readonly SearchEvidenceHitEventInput[];
  readonly lens: string;
  readonly match: string;
  readonly order: string;
  readonly query: string;
  readonly revisionScope: string;
  readonly terms: readonly string[];
  readonly tripleHits?: readonly SearchTripleHitInput[];
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
  readonly createdAt: number;
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

CREATE TABLE IF NOT EXISTS predicate_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS search_evidence_hit_events (
  session_id TEXT NOT NULL,
  evidence_kind INTEGER NOT NULL,
  evidence_id TEXT NOT NULL,
  chapter_id INTEGER NOT NULL,
  sentence_index INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (
    session_id,
    evidence_kind,
    evidence_id,
    chapter_id,
    sentence_index
  )
);

CREATE INDEX IF NOT EXISTS idx_search_evidence_hit_events_evidence_rank
ON search_evidence_hit_events(session_id, evidence_kind, evidence_id, score DESC, chapter_id, sentence_index);

CREATE INDEX IF NOT EXISTS idx_search_evidence_hit_events_sentence
ON search_evidence_hit_events(session_id, chapter_id, sentence_index, evidence_kind, evidence_id);

CREATE TABLE IF NOT EXISTS search_entity_hits (
  session_id TEXT NOT NULL,
  qid TEXT NOT NULL,
  property_top_scores_json TEXT NOT NULL DEFAULT '[]',
  evidence_top_scores_json TEXT NOT NULL DEFAULT '[]',
  property_score REAL NOT NULL DEFAULT 0,
  evidence_score REAL NOT NULL DEFAULT 0,
  result_score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, qid)
);

CREATE INDEX IF NOT EXISTS idx_search_entity_hits_rank
ON search_entity_hits(session_id, result_score DESC, qid);

CREATE TABLE IF NOT EXISTS search_triple_hits (
  session_id TEXT NOT NULL,
  subject_qid TEXT NOT NULL,
  predicate_id INTEGER NOT NULL,
  object_qid TEXT NOT NULL,
  evidence_top_scores_json TEXT NOT NULL DEFAULT '[]',
  result_score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, subject_qid, predicate_id, object_qid),
  FOREIGN KEY (predicate_id) REFERENCES predicate_dictionary(id)
);

CREATE INDEX IF NOT EXISTS idx_search_triple_hits_rank
ON search_triple_hits(session_id, result_score DESC, subject_qid, predicate_id, object_qid);

CREATE TABLE IF NOT EXISTS search_chunk_hits (
  session_id TEXT NOT NULL,
  chunk_id INTEGER NOT NULL,
  property_top_scores_json TEXT NOT NULL DEFAULT '[]',
  evidence_top_scores_json TEXT NOT NULL DEFAULT '[]',
  property_score REAL NOT NULL DEFAULT 0,
  evidence_score REAL NOT NULL DEFAULT 0,
  result_score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_search_chunk_hits_rank
ON search_chunk_hits(session_id, result_score DESC, chunk_id);

CREATE INDEX IF NOT EXISTS idx_search_sessions_archive
ON search_sessions(archive_key, session_id);

CREATE INDEX IF NOT EXISTS idx_search_sessions_expires
ON search_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_search_sessions_prune
ON search_sessions(accessed_at DESC, created_at DESC, session_id);
`;

const SEARCH_RANKING_VERSION = 5;
const SEARCH_SESSION_MAX_COUNT = 500;
const SEARCH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_TOP_SCORE_COUNT = 10;

type SearchSessionCacheInput = Omit<SearchSessionInput, "items">;
type EntitySearchSessionCacheInput = EntitySearchSessionInput;

export async function readCachedSearchSessionPage(
  input: SearchSessionCacheInput,
  offset: number,
  limit: number,
): Promise<SearchSessionPage | undefined> {
  const sessionId = createSearchSessionId(input);

  if (!(await hasSearchSession(sessionId, input.archiveKey))) {
    return undefined;
  }

  return await readSearchSessionPage(
    sessionId,
    offset,
    limit,
    input.archiveKey,
  );
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
      for (const event of input.evidenceEvents ?? []) {
        await insertSearchEvidenceHitEvent(database, sessionId, event);
      }
      for (const hit of input.entityHits ?? []) {
        await upsertSearchEntityHit(database, sessionId, hit);
      }
      for (const hit of input.tripleHits ?? []) {
        await upsertSearchTripleHit(database, sessionId, hit);
      }
      for (const hit of input.chunkHits ?? []) {
        await upsertSearchChunkHit(database, sessionId, hit);
      }
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

      for (const event of input.evidenceEvents ?? []) {
        await insertSearchEvidenceHitEvent(database, sessionId, event);
      }
      for (const hit of input.entityHits ?? []) {
        await upsertSearchEntityHit(database, sessionId, hit);
      }
      for (const hit of input.tripleHits ?? []) {
        await upsertSearchTripleHit(database, sessionId, hit);
      }
      for (const hit of input.chunkHits ?? []) {
        await upsertSearchChunkHit(database, sessionId, hit);
      }
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

export async function readSearchSessionPage(
  sessionId: string,
  offset: number,
  limit: number,
  expectedArchiveKey?: string,
  expectedCreatedAt?: number,
): Promise<SearchSessionPage> {
  const database = await openSearchSessionDatabase();

  try {
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
      expectedCreatedAt,
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
          ? encodeSearchSessionCursor(
              sessionId,
              last.rank + 1,
              session.createdAt,
            )
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
  expectedCreatedAt?: number,
): Promise<EntitySearchSessionPage> {
  const database = await openSearchSessionDatabase();

  try {
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
      expectedCreatedAt,
    );

    await touchSearchSession(database, sessionId);

    const rows = await database.queryAll(
      `
        SELECT
          qid,
          result_score
        FROM search_entity_hits
        WHERE session_id = ?
        ORDER BY result_score DESC, qid
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
          ? encodeSearchSessionCursor(sessionId, nextOffset, session.createdAt)
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
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
    );

    await touchSearchSession(database, sessionId);

    return {
      chapters: session.options.chapters,
      createdAt: session.createdAt,
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
  mentionIds: readonly string[],
  limit: number,
): Promise<readonly { readonly mentionId: string; readonly score: number }[]> {
  if (mentionIds.length === 0) {
    return [];
  }

  const database = await openSearchSessionDatabase();

  try {
    const placeholders = mentionIds.map(() => "?").join(", ");

    return await database.queryAll(
      `
        SELECT
          event.evidence_id AS mention_id,
          event.score AS score
        FROM search_evidence_hit_events AS event
        WHERE event.session_id = ?
          AND event.evidence_kind = ?
          AND event.evidence_id IN (${placeholders})
        ORDER BY event.score DESC, event.chapter_id, event.sentence_index,
          event.evidence_id
        LIMIT ?
      `,
      [sessionId, SEARCH_EVIDENCE_KIND.mention, ...mentionIds, limit],
      (row) => ({
        mentionId: getString(row, "mention_id"),
        score: getNumber(row, "score"),
      }),
    );
  } finally {
    await database.close();
  }
}

export function encodeSearchSessionCursor(
  sessionId: string,
  offset: number,
  createdAt: number,
): string {
  return Buffer.from(
    JSON.stringify({ createdAt, offset, sessionId, v: 3 }),
  ).toString("base64url");
}

export function decodeSearchSessionCursor(cursor: string): {
  readonly createdAt?: number;
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
      "createdAt" in parsed &&
      "v" in parsed &&
      parsed.v === 3 &&
      typeof parsed.sessionId === "string" &&
      parsed.sessionId !== "" &&
      typeof parsed.createdAt === "number" &&
      Number.isInteger(parsed.createdAt) &&
      parsed.createdAt >= 0 &&
      typeof parsed.offset === "number" &&
      Number.isInteger(parsed.offset) &&
      parsed.offset >= 0
    ) {
      return {
        createdAt: parsed.createdAt,
        offset: parsed.offset,
        sessionId: parsed.sessionId,
      };
    }
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
  return await openSharedStateDatabase(
    getSearchSessionDatabasePath(),
    SEARCH_SESSION_SCHEMA_SQL,
  );
}

function getSearchSessionDatabasePath(): string {
  return join(getSearchSessionStateDirectoryPath(), "search-sessions.sqlite");
}

function getSearchSessionStateDirectoryPath(): string {
  const stateDirectoryPath = process.env.WIKIGRAPH_STATE_DIR;

  if (stateDirectoryPath !== undefined && stateDirectoryPath.trim() !== "") {
    return resolve(stateDirectoryPath);
  }

  return resolveWikiGraphStateDirectoryPath();
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

async function hasSearchSession(
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

async function deleteSearchSession(
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

async function deleteUnusedPredicates(database: Database): Promise<void> {
  await database.run(`
    DELETE FROM predicate_dictionary
    WHERE NOT EXISTS (
      SELECT 1
      FROM search_triple_hits
      WHERE search_triple_hits.predicate_id = predicate_dictionary.id
    )
  `);
}

async function insertSearchEvidenceHitEvent(
  database: Database,
  sessionId: string,
  event: SearchEvidenceHitEventInput,
): Promise<void> {
  await database.run(
    `
      INSERT OR REPLACE INTO search_evidence_hit_events (
        session_id,
        evidence_kind,
        evidence_id,
        chapter_id,
        sentence_index,
        score
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      sessionId,
      event.evidenceKind,
      event.evidenceId,
      event.chapterId,
      event.sentenceIndex,
      event.score,
    ],
  );
}

async function upsertSearchEntityHit(
  database: Database,
  sessionId: string,
  hit: SearchEntityHitInput,
): Promise<void> {
  const current = await database.queryOne(
    `
      SELECT property_top_scores_json, evidence_top_scores_json
      FROM search_entity_hits
      WHERE session_id = ? AND qid = ?
    `,
    [sessionId, hit.qid],
    (row) => ({
      evidenceTopScores: parseNumberArray(
        getString(row, "evidence_top_scores_json"),
      ),
      propertyTopScores: parseNumberArray(
        getString(row, "property_top_scores_json"),
      ),
    }),
  );
  const propertyTopScores = mergeTopScores(
    current?.propertyTopScores ?? [],
    hit.propertyTopScores ?? [],
  );
  const evidenceTopScores = mergeTopScores(
    current?.evidenceTopScores ?? [],
    hit.evidenceTopScores ?? [],
  );
  const propertyScore = aggregateCachedScores(propertyTopScores);
  const evidenceScore = aggregateCachedScores(evidenceTopScores);
  const resultScore = propertyScore + evidenceScore;

  await database.run(
    `
      INSERT INTO search_entity_hits (
        session_id,
        qid,
        property_top_scores_json,
        evidence_top_scores_json,
        property_score,
        evidence_score,
        result_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, qid) DO UPDATE SET
        property_top_scores_json = excluded.property_top_scores_json,
        evidence_top_scores_json = excluded.evidence_top_scores_json,
        property_score = excluded.property_score,
        evidence_score = excluded.evidence_score,
        result_score = excluded.result_score
    `,
    [
      sessionId,
      hit.qid,
      JSON.stringify(propertyTopScores),
      JSON.stringify(evidenceTopScores),
      propertyScore,
      evidenceScore,
      resultScore,
    ],
  );
}

async function upsertSearchTripleHit(
  database: Database,
  sessionId: string,
  hit: SearchTripleHitInput,
): Promise<void> {
  const predicateId = await getOrCreatePredicateId(database, hit.predicate);
  const current = await database.queryOne(
    `
      SELECT evidence_top_scores_json
      FROM search_triple_hits
      WHERE session_id = ?
        AND subject_qid = ?
        AND predicate_id = ?
        AND object_qid = ?
    `,
    [sessionId, hit.subjectQid, predicateId, hit.objectQid],
    (row) => ({
      evidenceTopScores: parseNumberArray(
        getString(row, "evidence_top_scores_json"),
      ),
    }),
  );
  const evidenceTopScores = mergeTopScores(
    current?.evidenceTopScores ?? [],
    hit.evidenceTopScores,
  );
  const resultScore = aggregateCachedScores(evidenceTopScores);

  await database.run(
    `
      INSERT INTO search_triple_hits (
        session_id,
        subject_qid,
        predicate_id,
        object_qid,
        evidence_top_scores_json,
        result_score
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, subject_qid, predicate_id, object_qid)
      DO UPDATE SET
        evidence_top_scores_json = excluded.evidence_top_scores_json,
        result_score = excluded.result_score
    `,
    [
      sessionId,
      hit.subjectQid,
      predicateId,
      hit.objectQid,
      JSON.stringify(evidenceTopScores),
      resultScore,
    ],
  );
}

async function upsertSearchChunkHit(
  database: Database,
  sessionId: string,
  hit: SearchChunkHitInput,
): Promise<void> {
  const current = await database.queryOne(
    `
      SELECT property_top_scores_json, evidence_top_scores_json
      FROM search_chunk_hits
      WHERE session_id = ? AND chunk_id = ?
    `,
    [sessionId, hit.chunkId],
    (row) => ({
      evidenceTopScores: parseNumberArray(
        getString(row, "evidence_top_scores_json"),
      ),
      propertyTopScores: parseNumberArray(
        getString(row, "property_top_scores_json"),
      ),
    }),
  );
  const propertyTopScores = mergeTopScores(
    current?.propertyTopScores ?? [],
    hit.propertyTopScores ?? [],
  );
  const evidenceTopScores = mergeTopScores(
    current?.evidenceTopScores ?? [],
    hit.evidenceTopScores ?? [],
  );
  const propertyScore = aggregateCachedScores(propertyTopScores);
  const evidenceScore = aggregateCachedScores(evidenceTopScores);
  const resultScore = propertyScore + evidenceScore;

  await database.run(
    `
      INSERT INTO search_chunk_hits (
        session_id,
        chunk_id,
        property_top_scores_json,
        evidence_top_scores_json,
        property_score,
        evidence_score,
        result_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, chunk_id) DO UPDATE SET
        property_top_scores_json = excluded.property_top_scores_json,
        evidence_top_scores_json = excluded.evidence_top_scores_json,
        property_score = excluded.property_score,
        evidence_score = excluded.evidence_score,
        result_score = excluded.result_score
    `,
    [
      sessionId,
      hit.chunkId,
      JSON.stringify(propertyTopScores),
      JSON.stringify(evidenceTopScores),
      propertyScore,
      evidenceScore,
      resultScore,
    ],
  );
}

async function getOrCreatePredicateId(
  database: Database,
  predicate: string,
): Promise<number> {
  await database.run(
    `
      INSERT OR IGNORE INTO predicate_dictionary(value)
      VALUES (?)
    `,
    [predicate],
  );
  const id = await database.queryOne(
    `
      SELECT id
      FROM predicate_dictionary
      WHERE value = ?
    `,
    [predicate],
    (row) => getNumber(row, "id"),
  );

  if (id === undefined) {
    throw new Error("Failed to create predicate dictionary entry.");
  }

  return id;
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

async function readSearchSessionMetadata(
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

function createEntitySearchSessionId(
  input: EntitySearchSessionCacheInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        archiveKey: input.archiveKey,
        entity: true,
        lens: input.lens,
        match: input.match,
        order: input.order,
        rankingVersion: SEARCH_RANKING_VERSION,
        revisionScope: input.revisionScope,
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

  return {
    evidence: {
      nextCursor: null,
      shown: 0,
      sources: [],
      total: 0,
    },
    field: "title",
    id: `wikg://entity/${qid}`,
    score: getNumber(row, "result_score"),
    snippet: qid,
    title: qid,
    type: "entity",
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
        revisionScope: input.revisionScope,
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

function parseNumberArray(value: string): readonly number[] {
  const parsed: unknown = JSON.parse(value);

  if (
    Array.isArray(parsed) &&
    parsed.every((item) => typeof item === "number" && Number.isFinite(item))
  ) {
    return parsed.map((item) => Number(item));
  }

  return [];
}

function mergeTopScores(
  current: readonly number[],
  incoming: readonly number[],
): readonly number[] {
  return [...current, ...incoming]
    .filter((score) => Number.isFinite(score))
    .sort((left, right) => right - left)
    .slice(0, SEARCH_TOP_SCORE_COUNT);
}

function aggregateCachedScores(scores: readonly number[]): number {
  return scores
    .slice(0, SEARCH_TOP_SCORE_COUNT)
    .reduce((total, score, index) => total + score / Math.log2(index + 2), 0);
}

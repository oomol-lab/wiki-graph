import { getNumber } from "../../../document/database.js";
import { openWikiGraphStateDatabase } from "../../../document/index.js";
import type { Database } from "../../../document/index.js";

import { normalizeSearchHitScore } from "./score-normalization.js";
import type {
  SearchIndexObjectHit,
  SearchIndexTextHit,
  TextSentenceKind,
} from "./types.js";

const QUERY_CACHE_SCHEMA_VERSION = "3";
const SCORE_BATCH_SIZE = 512;
const NO_CHAPTER = -1;
const QUERY_CACHE_INSTANCE_STARTED_AT = Date.now();

const QUERY_CACHE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS query_cache_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO query_cache_metadata(key, value)
VALUES ('schema_version', '${QUERY_CACHE_SCHEMA_VERSION}');

CREATE TABLE IF NOT EXISTS query_runs (
  query_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS query_object_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  archive_id INTEGER NOT NULL,
  owner_kind INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  property_kind INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL DEFAULT ${NO_CHAPTER},
  match_tier INTEGER NOT NULL,
  raw_score REAL NOT NULL,
  score REAL,
  UNIQUE (
    query_id, archive_id, owner_kind, owner_id, property_kind, chapter_id
  )
);

CREATE INDEX IF NOT EXISTS idx_query_object_hits_score
ON query_object_hits(query_id, score DESC, archive_id, owner_kind, owner_id, property_kind);

CREATE TABLE IF NOT EXISTS query_text_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  archive_id INTEGER NOT NULL,
  kind INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  sentence_index INTEGER NOT NULL,
  words_count INTEGER NOT NULL DEFAULT 0,
  match_tier INTEGER,
  raw_score REAL,
  fts_score REAL,
  embedding_score REAL,
  score REAL,
  rank INTEGER,
  UNIQUE (query_id, archive_id, kind, chapter_id, sentence_index)
);

CREATE INDEX IF NOT EXISTS idx_query_text_hits_rank
ON query_text_hits(query_id, rank, archive_id, chapter_id, sentence_index, kind);

CREATE TABLE IF NOT EXISTS query_dense_segment_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  archive_id INTEGER NOT NULL,
  kind INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  start_sentence_index INTEGER NOT NULL,
  end_sentence_index INTEGER NOT NULL,
  raw_score REAL NOT NULL,
  score REAL,
  UNIQUE (
    query_id, archive_id, kind, chapter_id,
    start_sentence_index, end_sentence_index
  )
);

CREATE INDEX IF NOT EXISTS idx_query_dense_segment_hits_score
ON query_dense_segment_hits(query_id, raw_score DESC, archive_id, chapter_id, start_sentence_index, kind);
`;

let cacheSchemaInitialization: Promise<void> | undefined;
let nextQueryId = 0;

export interface CachedDenseSegmentHit {
  readonly archiveId: number;
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly kind: TextSentenceKind;
  readonly score: number;
  readonly startSentenceIndex: number;
}

export function createTransientQueryId(): string {
  nextQueryId += 1;
  return `query-${Date.now()}-${nextQueryId}`;
}

export async function openSearchQueryCacheDatabase(): Promise<Database> {
  const database = await openWikiGraphStateDatabase(
    "cache/search-index-query-hits.sqlite",
    QUERY_CACHE_SCHEMA_SQL,
  );

  cacheSchemaInitialization ??= initializeQueryCacheSchema(database).catch(
    (error: unknown) => {
      cacheSchemaInitialization = undefined;
      throw error;
    },
  );
  await cacheSchemaInitialization;
  return database;
}

async function initializeQueryCacheSchema(database: Database): Promise<void> {
  const version = await database.queryOne(
    `SELECT value FROM query_cache_metadata WHERE key = 'schema_version'`,
    undefined,
    (row) => String(row.value),
  );
  if (version !== QUERY_CACHE_SCHEMA_VERSION) {
    await database.execute(`
      DROP TABLE IF EXISTS query_dense_segment_hits;
      DROP TABLE IF EXISTS query_text_hits;
      DROP TABLE IF EXISTS query_object_hits;
      DROP TABLE IF EXISTS query_runs;
      DROP TABLE IF EXISTS query_cache_metadata;
      ${QUERY_CACHE_SCHEMA_SQL}
    `);
  }
}

export async function deleteCachedQueries(
  queryIds: readonly string[],
): Promise<void> {
  if (queryIds.length === 0) return;

  const database = await openSearchQueryCacheDatabase();
  try {
    await database.transaction(async () => {
      for (const queryId of queryIds) {
        await clearCachedQueryHits(database, queryId);
      }
    });
  } finally {
    await database.close();
  }
}

export async function clearCachedQueryHits(
  database: Database,
  queryId: string,
): Promise<void> {
  await clearCachedQueryHitRows(database, queryId);
  await database.run("DELETE FROM query_runs WHERE query_id = ?", [queryId]);
}

async function clearCachedQueryHitRows(
  database: Database,
  queryId: string,
): Promise<void> {
  await database.run(
    "DELETE FROM query_dense_segment_hits WHERE query_id = ?",
    [queryId],
  );
  await database.run("DELETE FROM query_text_hits WHERE query_id = ?", [
    queryId,
  ]);
  await database.run("DELETE FROM query_object_hits WHERE query_id = ?", [
    queryId,
  ]);
}

export async function beginCachedQuery(
  database: Database,
  queryId: string,
): Promise<void> {
  await clearCachedQueryHits(database, queryId);
  await database.run(
    "INSERT INTO query_runs(query_id, owner_id, complete, created_at) VALUES (?, ?, 0, ?)",
    [queryId, queryId, Date.now()],
  );
}

export async function claimCachedQuery(
  database: Database,
  queryId: string,
  ownerId: string,
): Promise<"claimed" | "complete" | "pending"> {
  return await database.transaction(async () => {
    await database.run(
      `
        INSERT OR IGNORE INTO query_runs(
          query_id, owner_id, complete, created_at
        )
        VALUES (?, ?, 0, ?)
      `,
      [queryId, ownerId, Date.now()],
    );
    const run = await database.queryOne(
      `
        SELECT owner_id, complete, created_at
        FROM query_runs
        WHERE query_id = ?
      `,
      [queryId],
      (row) => ({
        complete: getNumber(row, "complete") === 1,
        createdAt: getNumber(row, "created_at"),
        ownerId: String(row.owner_id),
      }),
    );

    if (run?.complete === true) return "complete";
    if (run !== undefined && run.createdAt < QUERY_CACHE_INSTANCE_STARTED_AT) {
      await clearCachedQueryHitRows(database, queryId);
      await database.run(
        `
          UPDATE query_runs
          SET owner_id = ?, created_at = ?
          WHERE query_id = ?
        `,
        [ownerId, Date.now(), queryId],
      );
      return "claimed";
    }
    return run?.ownerId === ownerId ? "claimed" : "pending";
  });
}

export async function completeCachedQuery(
  database: Database,
  queryId: string,
): Promise<void> {
  await database.run("UPDATE query_runs SET complete = 1 WHERE query_id = ?", [
    queryId,
  ]);
}

export async function insertCachedObjectHit(
  database: Database,
  queryId: string,
  matchTier: number,
  hit: Omit<SearchIndexObjectHit, "score"> & { readonly rawScore: number },
): Promise<void> {
  await database.run(
    `
      INSERT OR IGNORE INTO query_object_hits (
        query_id, archive_id, owner_kind, owner_id, property_kind,
        chapter_id, match_tier, raw_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      queryId,
      hit.archiveId,
      hit.ownerKind,
      hit.ownerId,
      hit.propertyKind,
      hit.chapterId ?? NO_CHAPTER,
      matchTier,
      hit.rawScore,
    ],
  );
}

export async function insertCachedFtsTextHit(
  database: Database,
  queryId: string,
  matchTier: number,
  hit: Omit<SearchIndexTextHit, "rank" | "score"> & {
    readonly rawScore: number;
  },
): Promise<void> {
  await database.run(
    `
      INSERT OR IGNORE INTO query_text_hits (
        query_id, archive_id, kind, chapter_id, sentence_index,
        words_count, match_tier, raw_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      queryId,
      hit.archiveId,
      hit.kind,
      hit.chapterId,
      hit.sentenceIndex,
      hit.wordsCount,
      matchTier,
      hit.rawScore,
    ],
  );
}

export async function pruneCachedFtsHits(
  database: Database,
  queryId: string,
  limit: number,
): Promise<void> {
  for (const table of ["query_object_hits", "query_text_hits"] as const) {
    await database.run(
      `
        DELETE FROM ${table}
        WHERE query_id = ?
          AND id NOT IN (
            SELECT id
            FROM ${table}
            WHERE query_id = ?
            ORDER BY match_tier, raw_score, id
            LIMIT ?
          )
      `,
      [queryId, queryId, limit],
    );
  }
}

export async function countCachedFtsHits(
  database: Database,
  queryId: string,
): Promise<{ readonly objectHits: number; readonly textHits: number }> {
  return (
    (await database.queryOne(
      `
        SELECT
          (SELECT COUNT(*) FROM query_object_hits WHERE query_id = ?) AS object_hits,
          (SELECT COUNT(*) FROM query_text_hits WHERE query_id = ?) AS text_hits
      `,
      [queryId, queryId],
      (row) => ({
        objectHits: getNumber(row, "object_hits"),
        textHits: getNumber(row, "text_hits"),
      }),
    )) ?? { objectHits: 0, textHits: 0 }
  );
}

export async function normalizeCachedFtsHits(
  database: Database,
  queryId: string,
): Promise<void> {
  const top = await database.queryOne(
    `
      SELECT hit_type, hit_id, raw_score
      FROM (
        SELECT 0 AS hit_type, id AS hit_id, match_tier, raw_score
        FROM query_object_hits
        WHERE query_id = ?
        UNION ALL
        SELECT 1 AS hit_type, id AS hit_id, match_tier, raw_score
        FROM query_text_hits
        WHERE query_id = ? AND raw_score IS NOT NULL
      )
      ORDER BY match_tier, raw_score, hit_type, hit_id
      LIMIT 1
    `,
    [queryId, queryId],
    (row) => ({ rawScore: getNumber(row, "raw_score") }),
  );
  if (top === undefined) return;

  let offset = 0;
  while (true) {
    const rows = await database.queryAll(
      `
        SELECT hit_type, hit_id, raw_score
        FROM (
          SELECT 0 AS hit_type, id AS hit_id, match_tier, raw_score
          FROM query_object_hits
          WHERE query_id = ?
          UNION ALL
          SELECT 1 AS hit_type, id AS hit_id, match_tier, raw_score
          FROM query_text_hits
          WHERE query_id = ? AND raw_score IS NOT NULL
        )
        ORDER BY match_tier, raw_score, hit_type, hit_id
        LIMIT ? OFFSET ?
      `,
      [queryId, queryId, SCORE_BATCH_SIZE, offset],
      (row) => ({
        hitId: getNumber(row, "hit_id"),
        hitType: getNumber(row, "hit_type"),
        rawScore: getNumber(row, "raw_score"),
      }),
    );
    if (rows.length === 0) break;

    await database.transaction(async () => {
      for (const [index, row] of rows.entries()) {
        const score = normalizeSearchHitScore(
          row.rawScore,
          offset + index + 1,
          top.rawScore,
          "ascending",
        );
        await database.run(
          row.hitType === 0
            ? "UPDATE query_object_hits SET score = ? WHERE id = ?"
            : "UPDATE query_text_hits SET fts_score = ? WHERE id = ?",
          [score, row.hitId],
        );
      }
    });
    offset += rows.length;
  }
}

export async function insertCachedDenseSegmentHit(
  database: Database,
  queryId: string,
  hit: Omit<CachedDenseSegmentHit, "score"> & { readonly rawScore: number },
): Promise<void> {
  await database.run(
    `
      INSERT INTO query_dense_segment_hits (
        query_id, archive_id, kind, chapter_id, start_sentence_index,
        end_sentence_index, raw_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (
        query_id, archive_id, kind, chapter_id,
        start_sentence_index, end_sentence_index
      ) DO UPDATE SET raw_score = MAX(raw_score, excluded.raw_score)
    `,
    [
      queryId,
      hit.archiveId,
      hit.kind,
      hit.chapterId,
      hit.startSentenceIndex,
      hit.endSentenceIndex,
      hit.rawScore,
    ],
  );
}

export async function pruneAndNormalizeCachedDenseSegmentHits(
  database: Database,
  queryId: string,
  limit: number,
): Promise<void> {
  await database.run(
    `
      DELETE FROM query_dense_segment_hits
      WHERE query_id = ?
        AND id NOT IN (
          SELECT id
          FROM query_dense_segment_hits
          WHERE query_id = ?
          ORDER BY raw_score DESC, archive_id, chapter_id,
                   start_sentence_index, kind
          LIMIT ?
        )
    `,
    [queryId, queryId, limit],
  );
  const rows = await database.queryAll(
    `
      SELECT id, raw_score
      FROM query_dense_segment_hits
      WHERE query_id = ?
      ORDER BY raw_score DESC, archive_id, chapter_id,
               start_sentence_index, kind
    `,
    [queryId],
    (row) => ({
      id: getNumber(row, "id"),
      rawScore: getNumber(row, "raw_score"),
    }),
  );
  const topRawScore = rows[0]?.rawScore;
  if (topRawScore === undefined) return;

  await database.transaction(async () => {
    for (const [index, row] of rows.entries()) {
      await database.run(
        "UPDATE query_dense_segment_hits SET score = ? WHERE id = ?",
        [
          normalizeSearchHitScore(
            row.rawScore,
            index + 1,
            topRawScore,
            "descending",
          ),
          row.id,
        ],
      );
    }
  });
}

export async function listCachedDenseSegmentHits(
  database: Database,
  queryId: string,
): Promise<readonly CachedDenseSegmentHit[]> {
  return await database.queryAll(
    `
      SELECT archive_id, kind, chapter_id, start_sentence_index,
             end_sentence_index, score
      FROM query_dense_segment_hits
      WHERE query_id = ?
      ORDER BY score DESC, archive_id, chapter_id, start_sentence_index, kind
    `,
    [queryId],
    (row) => ({
      archiveId: getNumber(row, "archive_id"),
      chapterId: getNumber(row, "chapter_id"),
      endSentenceIndex: getNumber(row, "end_sentence_index"),
      kind: getNumber(row, "kind") as TextSentenceKind,
      score: getNumber(row, "score"),
      startSentenceIndex: getNumber(row, "start_sentence_index"),
    }),
  );
}

export async function upsertCachedEmbeddingTextHit(
  database: Database,
  queryId: string,
  hit: Omit<SearchIndexTextHit, "rank">,
): Promise<void> {
  await database.run(
    `
      INSERT INTO query_text_hits (
        query_id, archive_id, kind, chapter_id, sentence_index,
        words_count, embedding_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (query_id, archive_id, kind, chapter_id, sentence_index)
      DO UPDATE SET
        words_count = MAX(words_count, excluded.words_count),
        embedding_score = CASE
          WHEN embedding_score IS NULL THEN excluded.embedding_score
          ELSE MAX(embedding_score, excluded.embedding_score)
        END
    `,
    [
      queryId,
      hit.archiveId,
      hit.kind,
      hit.chapterId,
      hit.sentenceIndex,
      hit.wordsCount,
      hit.score,
    ],
  );
}

export async function finalizeCachedTextHitScores(
  database: Database,
  queryId: string,
): Promise<void> {
  await database.run(
    `
      UPDATE query_text_hits
      SET score = CASE
        WHEN fts_score IS NULL THEN embedding_score
        WHEN embedding_score IS NULL THEN fts_score
        ELSE (fts_score + embedding_score) / 2.0
      END
      WHERE query_id = ?
    `,
    [queryId],
  );
  await database.run(
    `
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            ORDER BY score DESC, archive_id, chapter_id, sentence_index, kind
          ) AS next_rank
        FROM query_text_hits
        WHERE query_id = ? AND score IS NOT NULL
      )
      UPDATE query_text_hits
      SET rank = (SELECT next_rank FROM ranked WHERE ranked.id = query_text_hits.id)
      WHERE query_id = ?
    `,
    [queryId, queryId],
  );
}

export async function fillUnmatchedCachedTextScores(
  indexDatabase: Database,
  cache: Database,
  queryId: string,
  channels: {
    readonly embedding: boolean;
    readonly fts: boolean;
  },
): Promise<void> {
  if (!channels.fts && !channels.embedding) return;

  const scopes = await cache.queryAll(
    `
      SELECT DISTINCT archive_id, kind, chapter_id
      FROM query_text_hits
      WHERE query_id = ?
        AND (
          (? = 1 AND fts_score IS NULL)
          OR (? = 1 AND embedding_score IS NULL)
        )
    `,
    [queryId, channels.fts ? 1 : 0, channels.embedding ? 1 : 0],
    (row) => ({
      archiveId: getNumber(row, "archive_id"),
      chapterId: getNumber(row, "chapter_id"),
      kind: getNumber(row, "kind"),
    }),
  );

  if (scopes.length === 0) return;

  const coveredFtsScopes = channels.fts
    ? await readCoveredTextScopes(indexDatabase, scopes, "fts")
    : new Set<string>();
  const coveredEmbeddingScopes = channels.embedding
    ? await readCoveredTextScopes(indexDatabase, scopes, "embedding")
    : new Set<string>();

  await cache.transaction(async () => {
    await updateMissingTextChannelScores(
      cache,
      queryId,
      "fts_score",
      coveredFtsScopes,
    );
    await updateMissingTextChannelScores(
      cache,
      queryId,
      "embedding_score",
      coveredEmbeddingScopes,
    );
  });
}

async function readCoveredTextScopes(
  database: Database,
  scopes: readonly TextScope[],
  channel: "embedding" | "fts",
): Promise<Set<string>> {
  const covered = new Set<string>();

  for (const batch of chunk(scopes, 200)) {
    const predicates = batch
      .map(() => "(archive_id = ? AND kind = ? AND chapter_id = ?)")
      .join(" OR ");
    const rows = await database.queryAll(
      channel === "fts"
        ? `
            SELECT DISTINCT records.archive_id, records.kind, records.chapter_id
            FROM text_sentence_records AS records
            JOIN text_sentence_fts AS fts ON fts.rowid = records.id
            WHERE ${predicates}
          `
        : `
            SELECT DISTINCT archive_id, kind, chapter_id
            FROM text_embedding_segments
            WHERE ${predicates}
          `,
      batch.flatMap((scope) => [scope.archiveId, scope.kind, scope.chapterId]),
      (row) =>
        createTextScopeKey(
          getNumber(row, "archive_id"),
          getNumber(row, "kind"),
          getNumber(row, "chapter_id"),
        ),
    );
    for (const row of rows) covered.add(row);
  }

  return covered;
}

async function updateMissingTextChannelScores(
  database: Database,
  queryId: string,
  column: "embedding_score" | "fts_score",
  coveredScopes: ReadonlySet<string>,
): Promise<void> {
  const scopes = [...coveredScopes].map(parseTextScopeKey);

  for (const batch of chunk(scopes, 200)) {
    if (batch.length === 0) continue;
    const predicates = batch
      .map(() => "(archive_id = ? AND kind = ? AND chapter_id = ?)")
      .join(" OR ");
    await database.run(
      `
        UPDATE query_text_hits
        SET ${column} = 0
        WHERE query_id = ?
          AND ${column} IS NULL
          AND (${predicates})
      `,
      [
        queryId,
        ...batch.flatMap((scope) => [
          scope.archiveId,
          scope.kind,
          scope.chapterId,
        ]),
      ],
    );
  }
}

interface TextScope {
  readonly archiveId: number;
  readonly chapterId: number;
  readonly kind: number;
}

function createTextScopeKey(
  archiveId: number,
  kind: number,
  chapterId: number,
): string {
  return `${archiveId}:${kind}:${chapterId}`;
}

function parseTextScopeKey(value: string): TextScope {
  const parts = value.split(":").map(Number);
  const archiveId = parts[0];
  const kind = parts[1];
  const chapterId = parts[2];
  if (
    archiveId === undefined ||
    kind === undefined ||
    chapterId === undefined
  ) {
    throw new Error(`Invalid text scope key: ${value}`);
  }
  return { archiveId, chapterId, kind };
}

function chunk<T>(values: readonly T[], size: number): readonly T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push([...values.slice(index, index + size)]);
  }
  return chunks;
}

export function decodeCachedChapterId(chapterId: number): number | undefined {
  return chapterId === NO_CHAPTER ? undefined : chapterId;
}

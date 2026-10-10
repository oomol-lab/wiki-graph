import { describe, expect, it } from "vitest";

import {
  beginCachedQuery,
  claimCachedQuery,
  clearCachedQueryHits,
  finalizeCachedTextHitScores,
  fillUnmatchedCachedTextScores,
  insertCachedFtsTextHit,
  normalizeCachedFtsHits,
  openSearchQueryCacheDatabase,
  upsertCachedEmbeddingTextHit,
} from "./query-cache.js";
import { TEXT_SENTENCE_KIND } from "./types.js";

describe("search query cache", () => {
  it("rebuilds an unfinished query from an earlier Core instance on demand", async () => {
    const database = await openSearchQueryCacheDatabase();
    const queryId = `stale-query-${Date.now()}-${Math.random()}`;

    try {
      await beginCachedQuery(database, queryId);
      await insertCachedFtsTextHit(database, queryId, 0, {
        archiveId: 0,
        chapterId: 1,
        kind: TEXT_SENTENCE_KIND.source,
        rawScore: -1,
        sentenceIndex: 0,
        wordsCount: 8,
      });
      await database.run(
        "UPDATE query_runs SET created_at = 0 WHERE query_id = ?",
        [queryId],
      );

      await expect(
        claimCachedQuery(database, queryId, "next-instance"),
      ).resolves.toBe("claimed");
      await expect(
        database.queryOne(
          "SELECT COUNT(*) AS count FROM query_text_hits WHERE query_id = ?",
          [queryId],
          (row) => Number(row.count),
        ),
      ).resolves.toBe(0);
    } finally {
      await clearCachedQueryHits(database, queryId);
      await database.close();
    }
  });

  it("keeps missing score channels null and fuses only available channels", async () => {
    const database = await openSearchQueryCacheDatabase();
    const queryId = `score-channels-${Date.now()}-${Math.random()}`;
    const createHit = (sentenceIndex: number) => ({
      archiveId: 0,
      chapterId: 1,
      kind: TEXT_SENTENCE_KIND.source,
      rawScore: -10 + sentenceIndex,
      sentenceIndex,
      wordsCount: 8,
    });

    try {
      await beginCachedQuery(database, queryId);
      await insertCachedFtsTextHit(database, queryId, 0, createHit(0));
      await insertCachedFtsTextHit(database, queryId, 0, createHit(1));
      await normalizeCachedFtsHits(database, queryId);
      await upsertCachedEmbeddingTextHit(database, queryId, {
        ...createHit(1),
        score: 0.6,
      });
      await upsertCachedEmbeddingTextHit(database, queryId, {
        ...createHit(2),
        score: 0.7,
      });
      await finalizeCachedTextHitScores(database, queryId);

      const rows = await database.queryAll(
        `
          SELECT sentence_index, fts_score, embedding_score, score
          FROM query_text_hits
          WHERE query_id = ?
          ORDER BY sentence_index
        `,
        [queryId],
        (row) => ({
          embeddingScore:
            row.embedding_score === null ? null : Number(row.embedding_score),
          ftsScore: row.fts_score === null ? null : Number(row.fts_score),
          score: Number(row.score),
          sentenceIndex: Number(row.sentence_index),
        }),
      );

      expect(rows[0]).toMatchObject({
        embeddingScore: null,
        ftsScore: expect.any(Number),
      });
      expect(rows[0]?.score).toBe(rows[0]?.ftsScore);
      expect(rows[1]).toMatchObject({
        embeddingScore: 0.6,
        ftsScore: expect.any(Number),
      });
      expect(rows[1]?.score).toBeCloseTo(
        (rows[1]!.ftsScore! + rows[1]!.embeddingScore!) / 2,
        12,
      );
      expect(rows[2]).toStrictEqual({
        embeddingScore: 0.7,
        ftsScore: null,
        score: 0.7,
        sentenceIndex: 2,
      });
    } finally {
      await clearCachedQueryHits(database, queryId);
      await database.close();
    }
  });

  it("keeps the strongest embedding score when dense segments overlap", async () => {
    const database = await openSearchQueryCacheDatabase();
    const queryId = `dense-overlap-${Date.now()}-${Math.random()}`;

    try {
      await beginCachedQuery(database, queryId);
      const hit = {
        archiveId: 0,
        chapterId: 1,
        kind: TEXT_SENTENCE_KIND.source,
        score: 0.9,
        sentenceIndex: 3,
        wordsCount: 8,
      };
      await upsertCachedEmbeddingTextHit(database, queryId, hit);
      await upsertCachedEmbeddingTextHit(database, queryId, {
        ...hit,
        score: 0.4,
      });
      await finalizeCachedTextHitScores(database, queryId);

      await expect(
        database.queryOne(
          `
            SELECT embedding_score, score
            FROM query_text_hits
            WHERE query_id = ?
          `,
          [queryId],
          (row) => ({
            embeddingScore: Number(row.embedding_score),
            score: Number(row.score),
          }),
        ),
      ).resolves.toStrictEqual({ embeddingScore: 0.9, score: 0.9 });
    } finally {
      await clearCachedQueryHits(database, queryId);
      await database.close();
    }
  });

  it("fills missing channel scores only for covered text scopes", async () => {
    const database = await openSearchQueryCacheDatabase();
    const queryId = `channel-coverage-${Date.now()}-${Math.random()}`;

    try {
      await database.execute(`
        DROP TABLE IF EXISTS text_embedding_segments;
        DROP TABLE IF EXISTS text_sentence_fts;
        DROP TABLE IF EXISTS text_sentence_records;
        CREATE TABLE text_sentence_records (
          id INTEGER PRIMARY KEY,
          archive_id INTEGER NOT NULL,
          kind INTEGER NOT NULL,
          chapter_id INTEGER NOT NULL,
          sentence_index INTEGER NOT NULL
        );
        CREATE TABLE text_sentence_fts (rowid INTEGER PRIMARY KEY);
        CREATE TABLE text_embedding_segments (
          archive_id INTEGER NOT NULL,
          kind INTEGER NOT NULL,
          chapter_id INTEGER NOT NULL,
          start_sentence_index INTEGER NOT NULL,
          end_sentence_index INTEGER NOT NULL
        );
      `);
      await database.run(
        `
          INSERT INTO text_sentence_records
            (id, archive_id, kind, chapter_id, sentence_index)
          VALUES (1, 0, ?, 1, 0), (2, 0, ?, 1, 1), (3, 0, ?, 2, 0)
        `,
        [
          TEXT_SENTENCE_KIND.source,
          TEXT_SENTENCE_KIND.source,
          TEXT_SENTENCE_KIND.summary,
        ],
      );
      await database.run(
        "INSERT INTO text_sentence_fts(rowid) VALUES (1), (2), (3)",
      );
      await database.run(
        `
          INSERT INTO text_embedding_segments
            (archive_id, kind, chapter_id, start_sentence_index, end_sentence_index)
          VALUES (0, ?, 1, 0, 1)
        `,
        [TEXT_SENTENCE_KIND.source],
      );

      await beginCachedQuery(database, queryId);
      await database.run(
        `
          INSERT INTO query_text_hits
            (query_id, archive_id, kind, chapter_id, sentence_index, words_count)
          VALUES
            (?, 0, ?, 1, 0, 8),
            (?, 0, ?, 1, 1, 8),
            (?, 0, ?, 2, 0, 8)
        `,
        [
          queryId,
          TEXT_SENTENCE_KIND.source,
          queryId,
          TEXT_SENTENCE_KIND.source,
          queryId,
          TEXT_SENTENCE_KIND.summary,
        ],
      );

      await fillUnmatchedCachedTextScores(database, database, queryId, {
        embedding: true,
        fts: true,
      });

      await expect(
        database.queryAll(
          `
            SELECT kind, chapter_id, sentence_index, fts_score, embedding_score
            FROM query_text_hits
            WHERE query_id = ?
            ORDER BY chapter_id, sentence_index
          `,
          [queryId],
          (row) => ({
            chapterId: Number(row.chapter_id),
            embeddingScore:
              row.embedding_score === null ? null : Number(row.embedding_score),
            ftsScore: row.fts_score === null ? null : Number(row.fts_score),
            kind: Number(row.kind),
            sentenceIndex: Number(row.sentence_index),
          }),
        ),
      ).resolves.toStrictEqual([
        {
          chapterId: 1,
          embeddingScore: 0,
          ftsScore: 0,
          kind: TEXT_SENTENCE_KIND.source,
          sentenceIndex: 0,
        },
        {
          chapterId: 1,
          embeddingScore: 0,
          ftsScore: 0,
          kind: TEXT_SENTENCE_KIND.source,
          sentenceIndex: 1,
        },
        {
          chapterId: 2,
          embeddingScore: null,
          ftsScore: 0,
          kind: TEXT_SENTENCE_KIND.summary,
          sentenceIndex: 0,
        },
      ]);
    } finally {
      await clearCachedQueryHits(database, queryId);
      await database.execute(`
        DROP TABLE IF EXISTS text_embedding_segments;
        DROP TABLE IF EXISTS text_sentence_fts;
        DROP TABLE IF EXISTS text_sentence_records;
      `);
      await database.close();
    }
  });
});

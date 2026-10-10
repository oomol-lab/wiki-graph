import { describe, expect, it } from "vitest";

import {
  beginCachedQuery,
  claimCachedQuery,
  clearCachedQueryHits,
  finalizeCachedTextHitScores,
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
});

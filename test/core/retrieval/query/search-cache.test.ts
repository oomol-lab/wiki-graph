import { join } from "path";
import { rm } from "fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { Database } from "../../../../packages/core/src/document/index.js";
import {
  createSearchSession,
  deleteArchiveSearchSessions,
  readEntitySearchSessionPage,
  readSearchSessionObjectBucketPage,
} from "../../../../packages/core/src/retrieval/query/search-cache/index.js";
import { getObjectBucketCursorId } from "../../../../packages/core/src/retrieval/query/archive-view/search/bucket-order.js";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../../packages/core/src/runtime/common/wiki-graph/dir.js";
import { withTempDir } from "../../../helpers/temp.js";

const originalStateDir = getWikiGraphStateDirectoryPathForTesting();

describe("archive/query/search-cache", () => {
  afterEach(() => {
    setWikiGraphStateDirectoryPathForTesting(originalStateDir);
  });

  it("creates indexes for search session lookup and ranking", async () => {
    await withTempDir("wikigraph-search-cache-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(path);

      await createSearchSession({
        archiveKey: "archive-key",
        chapters: null,
        items: [],
        lens: "broad",
        match: "any",
        order: "rank",
        query: "query",
        revisionScope: JSON.stringify({ chaptersRevision: 0, scope: "all" }),
        terms: ["query"],
        types: null,
      });

      const database = await Database.open(
        join(path, "cache", "search-sessions.sqlite"),
        "",
        { readonly: true },
      );

      try {
        await expect(listIndexNames(database)).resolves.toEqual(
          expect.arrayContaining([
            "idx_search_chunk_hits_rank",
            "idx_search_entity_hits_rank",
            "idx_search_evidence_hit_events_evidence_rank",
            "idx_search_evidence_hit_events_sentence",
            "idx_search_sessions_archive",
            "idx_search_sessions_expires",
            "idx_search_sessions_prune",
            "idx_search_triple_hits_rank",
          ]),
        );
        await expect(listTableNames(database)).resolves.toEqual(
          expect.arrayContaining([
            "predicate_dictionary",
            "search_chunk_hits",
            "search_entity_hits",
            "search_evidence_hit_events",
            "search_triple_hits",
          ]),
        );
        await expect(listTableNames(database)).resolves.not.toContain(
          "search_mention_hits",
        );
      } finally {
        await database.close();
      }
    });
  });

  it("removes predicate dictionary entries after their triple hits are deleted", async () => {
    await withTempDir("wikigraph-search-cache-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(path);

      await createSearchSession({
        archiveKey: "archive-a",
        chapters: null,
        items: [],
        lens: "broad",
        match: "any",
        order: "rank",
        query: "query-a",
        revisionScope: JSON.stringify({ chaptersRevision: 0, scope: "all" }),
        terms: ["query-a"],
        tripleHits: [
          {
            evidenceTopScores: [1],
            objectQid: "Q2",
            predicate: "mentions",
            subjectQid: "Q1",
          },
          {
            evidenceTopScores: [1],
            objectQid: "Q3",
            predicate: "supports",
            subjectQid: "Q1",
          },
        ],
        types: null,
      });
      await createSearchSession({
        archiveKey: "archive-b",
        chapters: null,
        items: [],
        lens: "broad",
        match: "any",
        order: "rank",
        query: "query-b",
        revisionScope: JSON.stringify({ chaptersRevision: 0, scope: "all" }),
        terms: ["query-b"],
        tripleHits: [
          {
            evidenceTopScores: [1],
            objectQid: "Q4",
            predicate: "mentions",
            subjectQid: "Q1",
          },
        ],
        types: null,
      });

      await expect(listPredicates(path)).resolves.toStrictEqual([
        "mentions",
        "supports",
      ]);

      await deleteArchiveSearchSessions("archive-a");

      await expect(listPredicates(path)).resolves.toStrictEqual(["mentions"]);
    });
  });

  it("keeps same-qid entity hits isolated by archive id", async () => {
    await withTempDir("wikigraph-search-cache-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(path);

      const sessionId = await createSearchSession({
        archiveKey: "library-key",
        chapters: null,
        entityHits: [
          { archiveId: 1, propertyTopScores: [1], qid: "Q1" },
          { archiveId: 2, propertyTopScores: [1], qid: "Q1" },
        ],
        items: [],
        lens: "broad",
        match: "any",
        order: "rank",
        query: "query",
        revisionScope: JSON.stringify({ libraryRevision: 1, scope: "all" }),
        terms: ["query"],
        types: ["entity"],
      });

      const page = await readEntitySearchSessionPage(
        sessionId,
        0,
        10,
        "library-key",
      );

      expect(page.items.map((item) => [item.id, item.archiveId])).toStrictEqual(
        [
          ["wikg://entity/Q1", 1],
          ["wikg://entity/Q1", 2],
        ],
      );
    });
  });

  it("reads triple bucket rows after a cursor", async () => {
    await withTempDir("wikigraph-search-cache-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(path);

      const sessionId = await createSearchSession({
        archiveKey: "archive-key",
        chapters: null,
        items: [],
        lens: "broad",
        match: "any",
        order: "rank",
        query: "query",
        revisionScope: JSON.stringify({ chaptersRevision: 0, scope: "all" }),
        terms: ["query"],
        tripleHits: [
          {
            evidenceTopScores: [3],
            objectQid: "Q2",
            predicate: "mentions",
            subjectQid: "Q1",
          },
          {
            evidenceTopScores: [2],
            objectQid: "Q3",
            predicate: "mentions",
            subjectQid: "Q1",
          },
        ],
        types: null,
      });
      const firstPage = await readSearchSessionObjectBucketPage(
        sessionId,
        1,
        undefined,
        1,
      );
      const first = firstPage[0];

      if (first === undefined) {
        throw new Error("Expected a first triple bucket hit.");
      }
      const secondPage = await readSearchSessionObjectBucketPage(
        sessionId,
        1,
        {
          archiveId: first.archiveId ?? 0,
          id: getObjectBucketCursorId(first),
          kind: "triple",
          score: first.score ?? 0,
        },
        1,
      );

      expect(secondPage.map((item) => item.id)).toStrictEqual([
        "wikg://triple/Q1/mentions/Q3",
      ]);
    });
  });

  it("recreates the search session database when only the init marker remains", async () => {
    await withTempDir("wikigraph-search-cache-marker-", async (path) => {
      setWikiGraphStateDirectoryPathForTesting(path);

      await createEmptySession("archive-a", "query-a");
      await rm(join(path, "cache", "search-sessions.sqlite"));

      await createEmptySession("archive-b", "query-b");

      await expect(listTableNamesAt(path)).resolves.toEqual(
        expect.arrayContaining(["search_sessions", "search_results"]),
      );
    });
  });
});

async function createEmptySession(
  archiveKey: string,
  query: string,
): Promise<void> {
  await createSearchSession({
    archiveKey,
    chapters: null,
    items: [],
    lens: "broad",
    match: "any",
    order: "rank",
    query,
    revisionScope: JSON.stringify({ chaptersRevision: 0, scope: "all" }),
    terms: [query],
    types: null,
  });
}

async function listIndexNames(database: Database): Promise<string[]> {
  return await database.queryAll(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `,
    undefined,
    (row) => String(row.name),
  );
}

async function listTableNames(database: Database): Promise<string[]> {
  return await database.queryAll(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `,
    undefined,
    (row) => String(row.name),
  );
}

async function listTableNamesAt(path: string): Promise<string[]> {
  const database = await Database.open(
    join(path, "cache", "search-sessions.sqlite"),
    "",
    { readonly: true },
  );

  try {
    return await listTableNames(database);
  } finally {
    await database.close();
  }
}

async function listPredicates(path: string): Promise<string[]> {
  const database = await Database.open(
    join(path, "cache", "search-sessions.sqlite"),
    "",
    { readonly: true },
  );

  try {
    return await database.queryAll(
      `
        SELECT value
        FROM predicate_dictionary
        ORDER BY value
      `,
      undefined,
      (row) => String(row.value),
    );
  } finally {
    await database.close();
  }
}

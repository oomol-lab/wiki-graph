import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { Database } from "../../../../packages/core/src/document/index.js";
import {
  createSearchSession,
  deleteArchiveSearchSessions,
} from "../../../../packages/core/src/retrieval/query/search-cache/index.js";
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
});

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

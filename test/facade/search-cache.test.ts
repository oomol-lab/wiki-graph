import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { Database } from "../../src/document/index.js";
import { createSearchSession } from "../../src/facade/search-cache.js";
import { withTempDir } from "../helpers/temp.js";

const originalStateDir = process.env.WIKIGRAPH_STATE_DIR;

describe("facade/search-cache", () => {
  afterEach(() => {
    restoreEnv("WIKIGRAPH_STATE_DIR", originalStateDir);
  });

  it("creates indexes for search session lookup and ranking", async () => {
    await withTempDir("spinedigest-search-cache-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = path;

      await createSearchSession({
        archiveKey: "archive-key",
        chapters: null,
        items: [],
        lens: "broad",
        match: "any",
        order: "rank",
        query: "query",
        records: [],
        terms: ["query"],
        types: null,
      });

      const database = await Database.open(
        join(path, "search-sessions.sqlite"),
        "",
        { readonly: true },
      );

      try {
        await expect(listIndexNames(database)).resolves.toEqual(
          expect.arrayContaining([
            "idx_search_mention_hits_entity_rank",
            "idx_search_mention_hits_result_rank",
            "idx_search_mention_hits_session_rank",
            "idx_search_sessions_archive",
            "idx_search_sessions_expires",
            "idx_search_sessions_prune",
          ]),
        );
      } finally {
        await database.close();
      }
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

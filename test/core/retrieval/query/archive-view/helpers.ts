import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  Database,
  DirectoryDocument,
} from "../../../../../packages/core/src/document/index.js";
import {
  findArchiveObjects,
  grepArchiveObjects,
  isArchiveSearchIndexCurrent,
  listArchiveCollection,
  listArchiveEvidence,
  listArchiveObjects,
  packArchiveContext,
  listRelatedArchiveObjects,
  readArchiveText,
  readArchivePage,
  rebuildArchiveSearchIndex,
} from "../../../../../packages/core/src/retrieval/query/view.js";
import {
  isSearchIndexCurrent,
  querySearchIndex,
  readArchiveIndexSettings,
  SEARCH_INDEX_FTS_HIT_LIMIT,
} from "../../../../../packages/core/src/retrieval/search-index/index.js";
import { deleteArchiveSearchSessions } from "../../../../../packages/core/src/retrieval/query/search-cache/index.js";
import { withTempDir } from "../../../../helpers/temp.js";

const originalStateDir = process.env.WIKIGRAPH_STATE_DIR;
let testStateDir: string | undefined;

export async function setupArchiveViewTestState(): Promise<void> {
  testStateDir = await mkdtemp(join(tmpdir(), "wikigraph-state-"));
  process.env.WIKIGRAPH_STATE_DIR = testStateDir;
}

export async function teardownArchiveViewTestState(): Promise<void> {
  restoreEnv("WIKIGRAPH_STATE_DIR", originalStateDir);
  if (testStateDir !== undefined) {
    await rm(testStateDir, { force: true, recursive: true });
    testStateDir = undefined;
  }
}

export {
  Database,
  DirectoryDocument,
  deleteArchiveSearchSessions,
  findArchiveObjects,
  grepArchiveObjects,
  isArchiveSearchIndexCurrent,
  isSearchIndexCurrent,
  listArchiveCollection,
  listArchiveEvidence,
  listArchiveObjects,
  listRelatedArchiveObjects,
  packArchiveContext,
  querySearchIndex,
  readArchiveIndexSettings,
  readArchivePage,
  readArchiveText,
  rebuildArchiveSearchIndex,
  SEARCH_INDEX_FTS_HIT_LIMIT,
  withTempDir,
};

export async function seedSourcedDocument(
  document: DirectoryDocument,
  options: { readonly withSnake?: boolean } = {},
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.createSerial();
    const draft = await openedDocument.getSerialFragments(1).createDraft();

    draft.addSentence(
      "An LLM Wiki exposes pages, links, and source fragments to agents.",
      10,
    );
    draft.addSentence("朱元璋知道了这个消息，随后亲自来到洪都。", 18);
    draft.addSentence("Source-only archives should be searchable.", 6);
    await draft.commit();
    await openedDocument.chunks.save({
      content: "Pages and links make archive navigation explicit.",
      generation: 0,
      id: 100,
      label: "Wiki pages",
      sentenceId: [1, 0],
      sentenceIds: [[1, 0]],
      wordsCount: 7,
      weight: 1,
    });
    await openedDocument.chunks.save({
      content: "Source search remains available before graph summaries.",
      generation: 0,
      id: 101,
      label: "Source search",
      sentenceId: [1, 2],
      sentenceIds: [[1, 2]],
      wordsCount: 7,
      weight: 1,
    });
    if (options.withSnake !== false) {
      const snakeId = await openedDocument.snakes.create({
        firstLabel: "Wiki pages",
        groupId: 0,
        lastLabel: "Source search",
        localSnakeId: 0,
        serialId: 1,
        size: 2,
        wordsCount: 14,
        weight: 2,
      });
      await openedDocument.snakeChunks.save({
        chunkId: 100,
        position: 0,
        snakeId,
      });
      await openedDocument.snakeChunks.save({
        chunkId: 101,
        position: 1,
        snakeId,
      });
    }
    await openedDocument.writeSummary(1, `Summary ${"detail ".repeat(400)}`);
    await openedDocument.writeBookMeta({
      authors: [],
      description: null,
      identifier: null,
      language: "en",
      publishedAt: null,
      publisher: null,
      sourceFormat: "markdown",
      title: "Archive Wiki Fixture",
      version: 1,
    });
    await openedDocument.writeToc({
      items: [
        {
          children: [],
          serialId: 1,
          title: "Introduction",
        },
      ],
      version: 1,
    });
  });
  await rebuildArchiveSearchIndex(document);
}

export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

export async function listDocumentTableNames(
  document: DirectoryDocument,
): Promise<string[]> {
  return await document.readDatabase(
    async (database) =>
      await database.queryAll(
        `
          SELECT name
          FROM sqlite_master
          WHERE type IN ('table', 'virtual table')
          ORDER BY name
        `,
        undefined,
        (row) => String(row.name),
      ),
  );
}

export async function listSearchIndexTableNames(
  document: DirectoryDocument,
): Promise<string[]> {
  return await document.readSearchIndexDatabase(
    async (database) =>
      await database.queryAll(
        `
          SELECT name
          FROM sqlite_master
          WHERE type IN ('table', 'virtual table')
          ORDER BY name
        `,
        undefined,
        (row) => String(row.name),
      ),
  );
}

export async function countSearchIndexRows(
  document: DirectoryDocument,
): Promise<number> {
  return await document.readSearchIndexDatabase(async (database) => {
    const row = await database.queryOne(
      `
        SELECT
          (SELECT COUNT(*) FROM text_sentence_records) +
          (SELECT COUNT(*) FROM search_object_properties_records) AS count
      `,
      undefined,
      (value) => Number(value.count),
    );

    return row ?? 0;
  });
}

export async function countStructuredCacheRowsForQuery(
  statePath: string,
  query: string,
  types: readonly string[],
): Promise<number> {
  const database = await Database.open(
    join(statePath, "cache", "search-sessions.sqlite"),
    "",
    { readonly: true },
  );

  try {
    const optionsJSON = JSON.stringify({
      chapters: null,
      order: "doc-asc",
      types,
    });
    const row = await database.queryOne(
      `
        WITH matching_sessions AS (
          SELECT session_id
          FROM search_sessions
          WHERE query = ?
            AND options_json = ?
        )
        SELECT
          (SELECT COUNT(*)
           FROM search_evidence_hit_events
           WHERE session_id IN (SELECT session_id FROM matching_sessions)) +
          (SELECT COUNT(*)
           FROM search_entity_hits
           WHERE session_id IN (SELECT session_id FROM matching_sessions)) +
          (SELECT COUNT(*)
           FROM search_triple_hits
           WHERE session_id IN (SELECT session_id FROM matching_sessions)) +
          (SELECT COUNT(*)
           FROM search_chunk_hits
           WHERE session_id IN (SELECT session_id FROM matching_sessions)) AS count
      `,
      [query, optionsJSON],
      (value) => Number(value.count),
    );

    return row ?? 0;
  } finally {
    await database.close();
  }
}

export async function countSearchSessionsForQuery(
  statePath: string,
  query: string,
  types: readonly string[],
): Promise<number> {
  const database = await Database.open(
    join(statePath, "cache", "search-sessions.sqlite"),
    "",
    { readonly: true },
  );

  try {
    const optionsJSON = JSON.stringify({
      chapters: null,
      order: "doc-asc",
      types,
    });
    const row = await database.queryOne(
      `
        SELECT COUNT(*) AS count
        FROM search_sessions
        WHERE query = ?
          AND options_json = ?
      `,
      [query, optionsJSON],
      (value) => Number(value.count),
    );

    return row ?? 0;
  } finally {
    await database.close();
  }
}

export function createEntityWikipageMockFetch(): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);

    if (url.hostname === "www.wikidata.org") {
      const language = url.searchParams.get("languages")?.split("|")[0];

      return Promise.resolve(
        new Response(
          JSON.stringify({
            entities: {
              Q1: {
                descriptions: {
                  [language ?? "en"]: {
                    value:
                      language === "zh"
                        ? "明朝军事将领"
                        : "Ming dynasty general",
                  },
                },
                labels: {
                  [language ?? "en"]: {
                    value: language === "zh" ? "徐达" : "Xu Da",
                  },
                },
                sitelinks: {
                  enwiki: { title: "Xu Da" },
                  zhwiki: { title: "徐达" },
                },
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    }

    const titles = url.searchParams.get("titles")?.split("|") ?? [];

    return Promise.resolve(
      new Response(
        JSON.stringify({
          query: {
            pages: titles.map((title, index) => ({
              pageid: index + 1,
              pageprops: {
                wikibase_item: "Q1",
              },
              title,
            })),
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;
}

import { openWikiGraphStateDatabase } from "../../../document/index.js";
import type { Database } from "../../../document/index.js";

import { SEARCH_SESSION_SCHEMA_SQL } from "./schema.js";

let searchSessionSchemaChecked = false;

export async function openSearchSessionDatabase(): Promise<Database> {
  const database = await openWikiGraphStateDatabase(
    "cache/search-sessions.sqlite",
    SEARCH_SESSION_SCHEMA_SQL,
  );

  if (searchSessionSchemaChecked) {
    return database;
  }

  if (await isSearchSessionSchemaCurrent(database)) {
    searchSessionSchemaChecked = true;
    return database;
  }

  await resetSearchSessionSchema(database);
  searchSessionSchemaChecked = true;
  return database;
}

async function resetSearchSessionSchema(database: Database): Promise<void> {
  await database.execute(`
    DROP TABLE IF EXISTS search_evidence_hit_events;
    DROP TABLE IF EXISTS search_triple_hits;
    DROP TABLE IF EXISTS search_entity_hits;
    DROP TABLE IF EXISTS search_chunk_hits;
    DROP TABLE IF EXISTS search_results;
    DROP TABLE IF EXISTS search_sessions;
    ${SEARCH_SESSION_SCHEMA_SQL}
  `);
}

async function isSearchSessionSchemaCurrent(
  database: Database,
): Promise<boolean> {
  return (
    (await hasColumn(database, "search_sessions", "ranking_version")) &&
    (await hasColumn(database, "search_entity_hits", "archive_id")) &&
    (await hasColumn(database, "search_chunk_hits", "archive_id")) &&
    (await hasColumn(database, "search_triple_hits", "archive_id")) &&
    (await hasColumn(database, "search_evidence_hit_events", "archive_id"))
  );
}

async function hasColumn(
  database: Database,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await database.queryAll(
    `PRAGMA table_info(${table})`,
    undefined,
    (row) => String(row.name),
  );

  return rows.includes(column);
}

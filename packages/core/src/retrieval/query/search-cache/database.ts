import { join } from "path";
import { rm } from "fs/promises";

import { resolveWikiGraphCacheDirectoryPath } from "../../../runtime/common/wiki-graph/dir.js";
import { openSharedStateDatabase } from "../../../document/index.js";
import type { Database } from "../../../document/index.js";

import { SEARCH_SESSION_SCHEMA_SQL } from "./schema.js";

let currentSearchSessionSchemaPath: string | undefined;

export async function openSearchSessionDatabase(): Promise<Database> {
  const path = getSearchSessionDatabasePath();
  const database = await openSharedStateDatabase(
    path,
    SEARCH_SESSION_SCHEMA_SQL,
  );

  if (currentSearchSessionSchemaPath === path) {
    return database;
  }

  if (await isSearchSessionSchemaCurrent(database)) {
    currentSearchSessionSchemaPath = path;
    return database;
  }

  await database.close();
  await rm(path, { force: true });
  await rm(`${path}.initialized`, { force: true });

  currentSearchSessionSchemaPath = path;
  return await openSharedStateDatabase(path, SEARCH_SESSION_SCHEMA_SQL);
}

export function getSearchSessionDatabasePath(): string {
  return join(getSearchSessionStateDirectoryPath(), "search-sessions.sqlite");
}

function getSearchSessionStateDirectoryPath(): string {
  return resolveWikiGraphCacheDirectoryPath();
}

async function isSearchSessionSchemaCurrent(
  database: Database,
): Promise<boolean> {
  return (
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

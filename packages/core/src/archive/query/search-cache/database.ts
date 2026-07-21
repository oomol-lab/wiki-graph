import { join } from "path";

import { resolveWikiGraphCacheDirectoryPath } from "../../../common/wiki-graph-dir.js";
import { openSharedStateDatabase } from "../../../document/index.js";
import type { Database } from "../../../document/index.js";

import { SEARCH_SESSION_SCHEMA_SQL } from "./schema.js";

export async function openSearchSessionDatabase(): Promise<Database> {
  return await openSharedStateDatabase(
    getSearchSessionDatabasePath(),
    SEARCH_SESSION_SCHEMA_SQL,
  );
}

export function getSearchSessionDatabasePath(): string {
  return join(getSearchSessionStateDirectoryPath(), "search-sessions.sqlite");
}

function getSearchSessionStateDirectoryPath(): string {
  return resolveWikiGraphCacheDirectoryPath();
}


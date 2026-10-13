import { openWikiGraphStateDatabase } from "../../../document/index.js";
import type { Database } from "../../../document/index.js";

import { SEARCH_SESSION_SCHEMA_SQL } from "./schema.js";

/** Legacy session cache invalidation belongs to explicit Home maintenance. */
export async function openSearchSessionDatabase(): Promise<Database> {
  return await openWikiGraphStateDatabase(
    "cache/search-sessions.sqlite",
    SEARCH_SESSION_SCHEMA_SQL,
  );
}

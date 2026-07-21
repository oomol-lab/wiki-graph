export const DATABASE_ENTRY_PATH = "database.db";
export const SEARCH_INDEX_DATABASE_ENTRY_PATH = "fts.db";
export const LOCK_POLL_INTERVAL_MS = 100;
export const LOCK_STALE_TIMEOUT_MS = 60_000;
export const OWNER_HEARTBEAT_INTERVAL_MS = 20_000;
export const SQLITE_CACHE_TTL_MS = 60 * 60 * 1000;
export const ARCHIVE_SESSION_CONSTRUCTOR_TOKEN = Symbol(
  "WikgArchiveSession constructor token",
);

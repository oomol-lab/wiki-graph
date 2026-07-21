import { randomBytes } from "crypto";
import { join } from "path";

import { resolveWikiGraphCacheDirectoryPath } from "../../../runtime/common/wiki-graph/dir.js";
import { getOptionalString } from "../../../document/database.js";
import { openSharedStateDatabase } from "../../../document/index.js";
import type { Database } from "../../../document/index.js";

const CONTINUATION_CURSOR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS continuation_cursors (
  cursor_id TEXT PRIMARY KEY,
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  format TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_continuation_cursors_expires
ON continuation_cursors(expires_at);
`;

export const CURSOR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export async function createUniqueCursorId(
  database: Database,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const cursorId = `c_${randomBytes(6).toString("base64url")}`;
    const existing = await database.queryOne(
      "SELECT cursor_id FROM continuation_cursors WHERE cursor_id = ?",
      [cursorId],
      (row) => getOptionalString(row, "cursor_id"),
    );

    if (existing === undefined) {
      return cursorId;
    }
  }

  throw new Error("Failed to create a unique continuation cursor.");
}

export async function cleanExpiredContinuationCursors(
  database: Database,
): Promise<void> {
  await database.run("DELETE FROM continuation_cursors WHERE expires_at < ?", [
    Date.now(),
  ]);
}

export async function openContinuationCursorDatabase(): Promise<Database> {
  return await openSharedStateDatabase(
    join(getContinuationStateDirectoryPath(), "continuation-cursors.sqlite"),
    CONTINUATION_CURSOR_SCHEMA_SQL,
  );
}

function getContinuationStateDirectoryPath(): string {
  return resolveWikiGraphCacheDirectoryPath();
}

export function parseCursorFormat(value: string): "json" | "jsonl" | "text" {
  if (value === "json" || value === "jsonl" || value === "text") {
    return value;
  }

  throw new Error(`Invalid continuation cursor format: ${value}.`);
}

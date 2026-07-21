import { getString } from "../../../document/database.js";
import {
  cleanExpiredContinuationCursors,
  createUniqueCursorId,
  CURSOR_TTL_MS,
  openContinuationCursorDatabase,
  parseCursorFormat,
} from "./store.js";
import {
  createCursorPayload,
  parseContinuationCursorRecord,
} from "./payload.js";
import type { ContinuationCursor } from "./types.js";

export async function createContinuationCursor(
  input: ContinuationCursor,
): Promise<string> {
  const database = await openContinuationCursorDatabase();

  try {
    await cleanExpiredContinuationCursors(database);

    const now = Date.now();
    const cursorId = await createUniqueCursorId(database);

    await database.run(
      `
        INSERT INTO continuation_cursors (
          cursor_id, archive_key, archive_path, kind, payload_json, format,
          limit_value, created_at, expires_at, accessed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cursorId,
        input.archiveKey,
        input.archivePath,
        input.kind,
        JSON.stringify(createCursorPayload(input)),
        input.format,
        1,
        now,
        now + CURSOR_TTL_MS,
        now,
      ],
    );

    return cursorId;
  } finally {
    await database.close();
  }
}

export async function readContinuationCursor(
  cursorId: string,
): Promise<ContinuationCursor> {
  const database = await openContinuationCursorDatabase();

  try {
    await cleanExpiredContinuationCursors(database);

    const record = await database.queryOne(
      `
        SELECT archive_key, archive_path, kind, payload_json, format
        FROM continuation_cursors
        WHERE cursor_id = ?
      `,
      [cursorId],
      (row) => ({
        archiveKey: getString(row, "archive_key"),
        archivePath: getString(row, "archive_path"),
        format: parseCursorFormat(getString(row, "format")),
        kind: getString(row, "kind"),
        payloadJSON: getString(row, "payload_json"),
      }),
    );

    if (record === undefined) {
      throw new Error(
        `Continuation cursor ${cursorId} was not found or has expired.`,
      );
    }

    await database.run(
      "UPDATE continuation_cursors SET accessed_at = ? WHERE cursor_id = ?",
      [Date.now(), cursorId],
    );

    return parseContinuationCursorRecord(record);
  } finally {
    await database.close();
  }
}

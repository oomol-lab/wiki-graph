import { createHash } from "crypto";
import type { Database } from "../../../document/database.js";
import type { SearchIndexInput } from "./types.js";

export function createSearchIndexFingerprint(input: SearchIndexInput): string {
  const hash = createHash("sha256");

  for (const record of input.textSentences) {
    hash.update("text");
    hash.update("\0");
    hash.update(String(record.kind));
    hash.update("\0");
    hash.update(String(record.chapterId));
    hash.update("\0");
    hash.update(String(record.sentenceIndex));
    hash.update("\0");
    hash.update(record.text);
    hash.update("\0");
  }

  for (const record of input.objectProperties) {
    hash.update("object-property");
    hash.update("\0");
    hash.update(String(record.ownerKind));
    hash.update("\0");
    hash.update(record.ownerId);
    hash.update("\0");
    hash.update(String(record.propertyKind));
    hash.update("\0");
    hash.update(String(record.chapterId ?? ""));
    hash.update("\0");
    hash.update(record.text);
    hash.update("\0");
  }

  return hash.digest("hex");
}

export async function readSearchIndexFingerprintFromDatabase(
  database: Database,
): Promise<string | undefined> {
  return await database.queryOne(
    `
      SELECT value
      FROM search_index_state
      WHERE key = 'fingerprint'
    `,
    undefined,
    (row) => String(row.value),
  );
}

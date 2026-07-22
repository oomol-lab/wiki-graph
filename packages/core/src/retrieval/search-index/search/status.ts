import { getNumber, type Database } from "../../../document/database.js";
import type { ReadonlyDocument } from "../../../document/index.js";
import { isMissingSearchIndexError } from "./errors.js";
import {
  createSearchIndexFingerprint,
  readSearchIndexFingerprintFromDatabase,
} from "./fingerprint.js";
import type { SearchIndexInput, SearchIndexStatus } from "./types.js";

export async function isSearchIndexCurrent(
  document: ReadonlyDocument,
  input?: SearchIndexInput,
): Promise<boolean> {
  return (await readSearchIndexStatus(document, input)) === "current";
}

export async function readSearchIndexStatus(
  document: ReadonlyDocument,
  input?: SearchIndexInput,
): Promise<SearchIndexStatus> {
  const fingerprint =
    input === undefined ? undefined : createSearchIndexFingerprint(input);

  try {
    return await document.readSearchIndexDatabase(async (database) => {
      if (await hasDirtySearchIndexChapters(database)) {
        return "dirty";
      }

      const indexedFingerprint =
        await readSearchIndexFingerprintFromDatabase(database);

      if (indexedFingerprint === undefined) {
        return "dirty";
      }

      return fingerprint === undefined || indexedFingerprint === fingerprint
        ? "current"
        : "dirty";
    });
  } catch (error) {
    if (isMissingSearchIndexError(error)) {
      return "missing";
    }

    throw error;
  }
}

export async function hasDirtySearchIndexChapters(
  database: Database,
): Promise<boolean> {
  if (!(await hasTable(database, "index_dirty_chapters"))) {
    return false;
  }

  const count = await database.queryOne(
    `
      SELECT COUNT(*) AS count
      FROM index_dirty_chapters
    `,
    undefined,
    (row) => getNumber(row, "count"),
  );

  return (count ?? 0) > 0;
}

async function hasTable(database: Database, table: string): Promise<boolean> {
  const row = await database.queryOne(
    `
      SELECT 1 AS found
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `,
    [table],
    (value) => getNumber(value, "found"),
  );

  return row === 1;
}

export async function assertSearchIndexNotDirty(
  database: Database,
): Promise<void> {
  if (await hasDirtySearchIndexChapters(database)) {
    throw new Error(
      "Archive search index is dirty; rebuild the index before querying.",
    );
  }
}

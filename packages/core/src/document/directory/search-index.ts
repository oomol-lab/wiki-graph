import { stat } from "fs/promises";
import { join } from "path";

import { isNodeError } from "../../utils/node-error.js";
import { Database } from "../database.js";
import { SEARCH_INDEX_SCHEMA_SQL } from "../schema.js";
import type { DocumentFileStore } from "./types.js";

export async function openSearchIndexDatabase<T>(input: {
  readonly documentPath: string;
  readonly fileStore: DocumentFileStore;
  readonly operation: (database: Database) => Promise<T> | T;
  readonly readonly: boolean;
}): Promise<T> {
  const databasePath =
    input.fileStore.resolveSearchIndexDatabasePath === undefined
      ? join(input.documentPath, "fts.db")
      : await input.fileStore.resolveSearchIndexDatabasePath(
          input.documentPath,
        );
  const shouldInitialize =
    !input.readonly && (await isMissingOrEmptyFile(databasePath));
  const database = await Database.open(
    databasePath,
    shouldInitialize ? SEARCH_INDEX_SCHEMA_SQL : "",
    {
      onWrite: () => {
        input.fileStore.markSearchIndexDatabaseDirty?.();
      },
      readonly: input.readonly,
    },
  );

  if (!input.readonly) {
    await migrateSearchIndexSchema(database);
  }

  try {
    return await input.operation(database);
  } finally {
    await database.close();
  }
}

async function isMissingOrEmptyFile(path: string): Promise<boolean> {
  const stats = await stat(path).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  return stats === undefined || stats.size === 0;
}

async function migrateSearchIndexSchema(database: Database): Promise<void> {
  await ensureColumn(
    database,
    "text_sentence_records",
    "archive_id",
    "INTEGER NOT NULL DEFAULT 0",
  );
  if (
    !(await hasUniqueIndex(database, "text_sentence_records", [
      "archive_id",
      "kind",
      "chapter_id",
      "sentence_index",
    ]))
  ) {
    await rebuildTextSentenceRecordsTable(database);
  }
  await ensureColumn(
    database,
    "search_object_properties_records",
    "archive_id",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await database.run(`
    CREATE TABLE IF NOT EXISTS index_dirty_chapters (
      archive_id INTEGER NOT NULL,
      chapter_id INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (archive_id, chapter_id)
    )
  `);
}

async function rebuildTextSentenceRecordsTable(
  database: Database,
): Promise<void> {
  await database.transaction(async () => {
    await database.run(`
      CREATE TABLE text_sentence_records_next (
        id INTEGER PRIMARY KEY,
        archive_id INTEGER NOT NULL,
        kind INTEGER NOT NULL,
        chapter_id INTEGER NOT NULL,
        sentence_index INTEGER NOT NULL,
        words_count INTEGER NOT NULL DEFAULT 0,
        byte_offset INTEGER NOT NULL DEFAULT 0,
        byte_length INTEGER NOT NULL DEFAULT 0,
        UNIQUE(archive_id, kind, chapter_id, sentence_index)
      )
    `);
    await database.run(`
      INSERT INTO text_sentence_records_next (
        id,
        archive_id,
        kind,
        chapter_id,
        sentence_index,
        words_count,
        byte_offset,
        byte_length
      )
      SELECT
        id,
        archive_id,
        kind,
        chapter_id,
        sentence_index,
        words_count,
        byte_offset,
        byte_length
      FROM text_sentence_records
    `);
    await database.run("DROP TABLE text_sentence_records");
    await database.run(`
      ALTER TABLE text_sentence_records_next
      RENAME TO text_sentence_records
    `);
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_text_sentence_records_chapter
      ON text_sentence_records(archive_id, kind, chapter_id, sentence_index)
    `);
  });
}

async function hasUniqueIndex(
  database: Database,
  table: string,
  columns: readonly string[],
): Promise<boolean> {
  const indexes = await database.queryAll(
    `PRAGMA index_list(${table})`,
    undefined,
    (row) => ({
      name: String(row.name),
      unique: Number(row.unique) === 1,
    }),
  );

  for (const index of indexes) {
    if (!index.unique) {
      continue;
    }

    const indexColumns = await database.queryAll(
      `PRAGMA index_info(${index.name})`,
      undefined,
      (row) => ({
        name: String(row.name),
        seqno: Number(row.seqno),
      }),
    );
    const orderedColumns = indexColumns
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name);

    if (
      orderedColumns.length === columns.length &&
      orderedColumns.every((column, index) => column === columns[index])
    ) {
      return true;
    }
  }

  return false;
}

async function ensureColumn(
  database: Database,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const columns = await database.queryAll(
    `PRAGMA table_info(${table})`,
    undefined,
    (row) => String(row.name),
  );

  if (columns.includes(column)) {
    return;
  }

  await database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

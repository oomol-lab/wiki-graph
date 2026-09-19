import { isHostFileEmpty, type File } from "../../runtime/platform/index.js";
import { Database } from "../database.js";
import {
  SEARCH_INDEX_SCHEMA_SQL,
  SEARCH_INDEX_TEXT_SENTENCE_RECORDS_COLUMNS_SQL,
} from "../schema.js";
import type { DocumentFileStore } from "./types.js";
import { SEARCH_INDEX_VERSION } from "../../retrieval/search-index/search/types.js";

const searchIndexLifecycleLocks = new Map<object | string, Promise<void>>();

export async function openSearchIndexDatabase<T>(input: {
  readonly documentPath: string;
  readonly fileStore: DocumentFileStore;
  readonly operation: (database: Database) => Promise<T> | T;
  readonly readonly: boolean;
}): Promise<T> {
  return await withSearchIndexLifecycleLock(
    input.fileStore.searchIndexLockKey?.() ?? input.fileStore,
    () => openSearchIndexDatabaseLocked(input),
  );
}

async function openSearchIndexDatabaseLocked<T>(input: {
  readonly documentPath: string;
  readonly fileStore: DocumentFileStore;
  readonly operation: (database: Database) => Promise<T> | T;
  readonly readonly: boolean;
}): Promise<T> {
  if (input.fileStore.resolveSearchIndexDatabasePath === undefined) {
    throw new Error("Document store does not provide a search index database");
  }
  let databasePath = await input.fileStore.resolveSearchIndexDatabasePath(
    input.documentPath,
  );
  let shouldInitialize =
    !input.readonly && (await isMissingOrEmptyFile(databasePath));

  if (
    !shouldInitialize &&
    !(await isSearchIndexDatabaseCompatible(databasePath))
  ) {
    if (input.readonly) {
      throw new Error("Search index cache is missing: index.db");
    }
    await deleteSearchIndexDatabaseFile(input.fileStore, input.documentPath);
    databasePath = await input.fileStore.resolveSearchIndexDatabasePath(
      input.documentPath,
    );
    shouldInitialize = true;
  }

  const database = await Database.open(
    databasePath,
    shouldInitialize ? SEARCH_INDEX_SCHEMA_SQL : "",
    {
      ...(input.readonly
        ? { mode: "readonly" as const }
        : { create: shouldInitialize, mode: "readwrite" as const }),
      onWrite: () => {
        input.fileStore.markSearchIndexDatabaseDirty?.();
      },
    },
  );

  try {
    if (!input.readonly) {
      await migrateSearchIndexSchema(database);
    }
    return await input.operation(database);
  } finally {
    await database.close();
  }
}

async function withSearchIndexLifecycleLock<T>(
  key: object | string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = searchIndexLifecycleLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const lock = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  const current = previous.then(() => lock);
  searchIndexLifecycleLocks.set(key, current);

  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (searchIndexLifecycleLocks.get(key) === current) {
      searchIndexLifecycleLocks.delete(key);
    }
  }
}

async function isMissingOrEmptyFile(file: File): Promise<boolean> {
  return await isHostFileEmpty(file);
}

async function isSearchIndexDatabaseCompatible(
  databasePath: File,
): Promise<boolean> {
  const database = await Database.open(databasePath, "", {
    mode: "readonly",
  }).catch(() => undefined);

  if (database === undefined) {
    return false;
  }

  try {
    const version = await database
      .queryOne(
        `
          SELECT value
          FROM search_index_state
          WHERE key = 'version'
        `,
        undefined,
        (row) => String(row.value),
      )
      .catch(() => undefined);

    return version === SEARCH_INDEX_VERSION;
  } finally {
    await database.close();
  }
}

async function deleteSearchIndexDatabaseFile(
  fileStore: DocumentFileStore,
  documentPath: string,
): Promise<void> {
  try {
    await fileStore.deleteFile(
      documentPath === "" ? "index.db" : `${documentPath}/index.db`,
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }

    throw error;
  }
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
  await database.run(`
    CREATE TABLE IF NOT EXISTS text_embedding_segments (
      id INTEGER PRIMARY KEY,
      archive_id INTEGER NOT NULL,
      kind INTEGER NOT NULL,
      chapter_id INTEGER NOT NULL,
      start_sentence_index INTEGER NOT NULL,
      end_sentence_index INTEGER NOT NULL,
      words_count INTEGER NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL
    )
  `);
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_text_embedding_segments_scope
    ON text_embedding_segments(archive_id, kind, chapter_id, start_sentence_index, end_sentence_index)
  `);
}

async function rebuildTextSentenceRecordsTable(
  database: Database,
): Promise<void> {
  await database.transaction(async () => {
    await database.run(`
      CREATE TABLE text_sentence_records_next (
${SEARCH_INDEX_TEXT_SENTENCE_RECORDS_COLUMNS_SQL}
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

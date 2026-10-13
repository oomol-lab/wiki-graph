import { isHostFileEmpty, type File } from "../../runtime/platform/index.js";
import { Database } from "../database.js";
import { SEARCH_INDEX_SCHEMA_SQL } from "../schema.js";
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
  const missing = await isMissingOrEmptyFile(databasePath);
  if (input.readonly && missing)
    throw new Error("Search index cache is missing: index.db");
  let shouldInitialize = !input.readonly && missing;

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

  const onWrite = () => {
    input.fileStore.markSearchIndexDatabaseDirty?.();
  };
  const database = input.readonly
    ? await Database.open(databasePath, "", { mode: "readonly", onWrite })
    : await Database.open(
        databasePath,
        shouldInitialize ? SEARCH_INDEX_SCHEMA_SQL : "",
        {
          create: shouldInitialize,
          mode: "readwrite",
          onWrite,
        },
      );

  try {
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
  });

  try {
    const version = await database.queryOne(
      `
          SELECT value
          FROM search_index_state
          WHERE key = 'version'
        `,
      undefined,
      (row) => String(row.value),
    );

    if (version === undefined || version === "")
      throw new Error(
        "Search index cache version marker is missing or invalid.",
      );
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

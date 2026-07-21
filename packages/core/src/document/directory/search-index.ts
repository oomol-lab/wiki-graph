import { join } from "path";

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
  const database = await Database.open(
    databasePath,
    input.readonly ? "" : SEARCH_INDEX_SCHEMA_SQL,
    {
      onWrite: () => {
        input.fileStore.markSearchIndexDatabaseDirty?.();
      },
      readonly: input.readonly,
    },
  );

  try {
    return await input.operation(database);
  } finally {
    await database.close();
  }
}

import {
  type DirectoryDocument,
  type ReadonlyDocument,
  type WikiGraphArchiveWriteOptions,
} from "wiki-graph-sdk";

import { getWikiGraphSDK } from "../../../runtime/context.js";

export async function readArchiveDocument<T>(
  path: string,
  operation: (document: ReadonlyDocument) => Promise<T> | T,
): Promise<T> {
  return await (
    await getWikiGraphSDK().archives.open(path)
  ).readDocument(operation);
}

export async function writeArchiveDocument<T>(
  path: string,
  operation: (document: DirectoryDocument) => Promise<T> | T,
  options: WikiGraphArchiveWriteOptions = {},
): Promise<T> {
  return await (
    await getWikiGraphSDK().archives.open(path)
  ).writeDocument(operation, {
    ...options,
    onIndexSyncError: reportLibraryIndexSyncFailure,
  });
}

function reportLibraryIndexSyncFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  try {
    process.stderr.write(
      `Warning: failed to sync library index cache after archive write: ${message}\n`,
    );
  } catch {
    // The archive write already succeeded; diagnostics must not turn it into a
    // reported failure.
  }
}

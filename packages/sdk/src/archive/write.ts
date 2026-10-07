import {
  WikiGraphArchiveFile,
  writeWikiGraphLibraryArchive,
  type DirectoryDocument,
  type File,
} from "wiki-graph-core";

import type { WikiGraphArchiveLocation } from "./target.js";

export interface WriteWikiGraphArchiveLocationOptions {
  readonly invalidateContinuationCursors?: boolean;
  readonly onIndexSyncError?: (error: unknown) => void;
  readonly refreshLibraryIndex?: boolean;
  readonly searchIndexWritebackPolicy?: "archive" | "cache";
}

export async function writeWikiGraphArchiveLocation<T>(
  location: WikiGraphArchiveLocation,
  operation: (document: DirectoryDocument) => Promise<T> | T,
  options: WriteWikiGraphArchiveLocationOptions = {},
): Promise<T> {
  const cacheOnly = options.searchIndexWritebackPolicy === "cache";
  const write = async (archiveFile: File = location.archiveFile) =>
    await new WikiGraphArchiveFile(archiveFile).write(operation, {
      ...(cacheOnly
        ? {}
        : { derivedStateKeys: [location.archiveKey, location.archivePath] }),
      ...(options.invalidateContinuationCursors === undefined
        ? {}
        : {
            invalidateContinuationCursors:
              options.invalidateContinuationCursors,
          }),
      ...(options.searchIndexWritebackPolicy === undefined
        ? {}
        : { searchIndexWritebackPolicy: options.searchIndexWritebackPolicy }),
    });

  if (
    location.libraryArchiveTarget === undefined ||
    cacheOnly ||
    options.refreshLibraryIndex === false
  ) {
    return await write();
  }
  return await writeWikiGraphLibraryArchive({
    additionalDerivedStateKeys: [location.archiveKey, location.archivePath],
    ...(options.invalidateContinuationCursors === undefined
      ? {}
      : {
          invalidateContinuationCursors: options.invalidateContinuationCursors,
        }),
    ...(options.onIndexSyncError === undefined
      ? {}
      : { onIndexSyncError: options.onIndexSyncError }),
    operation: async (archiveFile) => await write(archiveFile),
    target: location.libraryArchiveTarget,
  });
}

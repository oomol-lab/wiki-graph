import {
  finalizeWikiGraphLibraryArchiveWrite,
  readWikiGraphLibraryIndexState,
  rebuildWikiGraphLibraryIndex,
  WikiGraphArchiveFile,
  type DirectoryDocument,
  type ReadonlyDocument,
} from "wiki-graph-sdk";

import { resolveArchiveRuntimeLocation } from "./uri.js";

export async function readArchiveDocument<T>(
  path: string,
  operation: (document: ReadonlyDocument) => Promise<T> | T,
): Promise<T> {
  const location = await resolveArchiveRuntimeLocation(path);
  return await new WikiGraphArchiveFile(location.archiveFile).readDocument(
    operation,
  );
}

export async function writeArchiveDocument<T>(
  path: string,
  operation: (document: DirectoryDocument) => Promise<T> | T,
  options: Parameters<WikiGraphArchiveFile["write"]>[1] = {},
): Promise<T> {
  const location = await resolveArchiveRuntimeLocation(path);
  const result = await new WikiGraphArchiveFile(location.archiveFile).write(
    operation,
    options,
  );

  if (location.libraryDirtyTarget !== undefined) {
    if (location.libraryArchiveTarget !== undefined) {
      await finalizeWikiGraphLibraryArchiveWrite({
        target: location.libraryArchiveTarget,
      });
    }

    try {
      const state = await readWikiGraphLibraryIndexState(
        location.libraryDirtyTarget,
      );
      if (state.status !== "missing") {
        await rebuildWikiGraphLibraryIndex(location.libraryDirtyTarget);
      }
    } catch (error) {
      reportLibraryIndexSyncFailure(error);
    }
  }

  return result;
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

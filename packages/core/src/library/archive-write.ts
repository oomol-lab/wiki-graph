import type { File } from "../runtime/platform/index.js";
import {
  deleteArchiveContinuationCursors,
  deleteArchiveSearchSessions,
} from "../retrieval/query/index.js";

import {
  finalizeWikiGraphLibraryArchiveWriteWithinLock,
  getWikiGraphLibraryArchive,
} from "./membership.js";
import { withWikiGraphLibraryLock } from "./lock.js";
import {
  markWikiGraphLibraryIndexDirty,
  readWikiGraphLibraryIndexState,
  rebuildWikiGraphLibraryIndexWithinLock,
} from "./search-index.js";
import {
  resolveWikiGraphLibrary,
  type ParsedWikiGraphLibraryUri,
} from "./registry.js";

export interface WikiGraphLibraryArchiveWriteOptions<T> {
  readonly additionalDerivedStateKeys?: readonly string[];
  readonly invalidateContinuationCursors?: boolean;
  readonly onIndexSyncError?: (error: unknown) => void;
  readonly operation: (archive: File) => Promise<T>;
  readonly target: ParsedWikiGraphLibraryUri;
}

/**
 * Runs a managed archive mutation and all of its external-state finalization
 * while library readers are excluded.
 */
export async function writeWikiGraphLibraryArchive<T>(
  input: WikiGraphLibraryArchiveWriteOptions<T>,
): Promise<T> {
  if (input.target.kind !== "archive") {
    throw new Error("Expected a Wiki Graph library archive URI.");
  }
  const library = await resolveWikiGraphLibrary(input.target);
  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    const archive = await getWikiGraphLibraryArchive(input.target);
    if (archive.file === undefined) {
      throw new Error(`Wiki Graph library archive is missing: ${archive.uri}`);
    }
    const indexState = await readWikiGraphLibraryIndexState(input.target);
    const result = await input.operation(archive.file);

    // Once the WIKG commit succeeds, make the aggregate index observably stale
    // before any other fallible cross-database finalization is attempted.
    await markWikiGraphLibraryIndexDirty(library);
    await finalizeWikiGraphLibraryArchiveWriteWithinLock(input.target, library);
    await invalidateDerivedState(
      [
        archive.file.identity,
        archive.uri,
        library.uri,
        library.isDefault ? "library:default" : `library:${library.publicId}`,
        ...(input.additionalDerivedStateKeys ?? []),
      ],
      input.invalidateContinuationCursors ?? false,
    );

    if (indexState.status !== "missing") {
      try {
        await rebuildWikiGraphLibraryIndexWithinLock(input.target, library);
      } catch (error) {
        input.onIndexSyncError?.(error);
      }
    }
    return result;
  });
}

async function invalidateDerivedState(
  keys: readonly string[],
  invalidateContinuationCursors: boolean,
): Promise<void> {
  for (const key of new Set(keys)) {
    await deleteArchiveSearchSessions(key);
    if (invalidateContinuationCursors) {
      await deleteArchiveContinuationCursors(key);
    }
  }
}

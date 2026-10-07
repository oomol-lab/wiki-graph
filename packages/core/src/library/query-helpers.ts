import {
  readWikgArchiveMutationToken,
  WikiGraphArchiveFile,
} from "../storage/wikg/index.js";
import type { ReadonlyDocument } from "../document/index.js";
import type { ArchiveLibrarySource } from "../retrieval/query/archive-view/types.js";
import {
  getWikiGraphLibraryArchiveById,
  type WikiGraphLibraryArchiveRecord,
} from "./membership.js";
import {
  resolveWikiGraphLibrary,
  type ParsedWikiGraphLibraryUri,
} from "./registry.js";

export function createSortedArchiveIds(result: {
  readonly objectHits: readonly { readonly archiveId: number }[];
  readonly textHits: readonly { readonly archiveId: number }[];
}): readonly number[] {
  return [
    ...new Set([
      ...result.objectHits.map((hit) => hit.archiveId),
      ...result.textHits.map((hit) => hit.archiveId),
    ]),
  ].sort((left, right) => left - right);
}

export async function resolveReadableIndexedArchive(
  target: ParsedWikiGraphLibraryUri,
  archiveId: number,
  options: { readonly operation: string },
): Promise<WikiGraphLibraryArchiveRecord> {
  const library = await resolveWikiGraphLibrary(target);
  const archive = await getWikiGraphLibraryArchiveById(library, archiveId);
  if (!isReadableLibraryArchive(archive)) {
    throw new Error(
      `Wiki Graph library archive ${archiveId} is not readable while ${options.operation}.`,
    );
  }
  return archive;
}

export async function readLibraryArchiveDocument<T>(
  archive: WikiGraphLibraryArchiveRecord,
  operation: (document: ReadonlyDocument) => Promise<T>,
): Promise<T> {
  if (archive.file === undefined) {
    throw new Error(`Wiki Graph library archive is missing: ${archive.uri}`);
  }
  return await new WikiGraphArchiveFile(archive.file).readDocument(
    async (document) => {
      const currentToken = await readWikgArchiveMutationToken(archive.file!);
      if (
        archive.lastSeenMutationToken !== undefined &&
        currentToken !== archive.lastSeenMutationToken
      ) {
        throw new Error(
          `Wiki Graph library archive changed while reading: ${archive.uri}. Retry after syncing the library index.`,
        );
      }
      return await operation(document);
    },
  );
}

export function createLibrarySource(
  archive: WikiGraphLibraryArchiveRecord,
): ArchiveLibrarySource {
  return {
    archiveId: archive.id,
    libraryArchiveUri: archive.uri,
  };
}

export function isReadableLibraryArchive(
  archive: WikiGraphLibraryArchiveRecord,
): boolean {
  return (
    archive.file !== undefined && archive.exists && archive.status === "present"
  );
}

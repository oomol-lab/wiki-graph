import { WikiGraphArchiveFile } from "../storage/wikg/index.js";
import type { ReadonlyDocument } from "../document/index.js";
import {
  listArchiveEvidence,
  listRelatedArchiveObjects,
  packArchiveContext,
  readArchivePage,
} from "../retrieval/query/archive-view/index.js";
import {
  createCollectionResult,
  createFindResult,
} from "../retrieval/query/archive-view/helper/results.js";
import { hydrateSearchIndexHits } from "../retrieval/query/archive-view/search/hydration.js";
import type {
  ArchiveCollectionOptions,
  ArchiveCollectionResult,
  ArchiveEvidence,
  ArchiveEvidenceItem,
  ArchiveEvidenceOptions,
  ArchiveFindHit,
  ArchiveFindOptions,
  ArchiveFindResult,
  ArchiveLibrarySource,
  ArchiveListItem,
  ArchivePack,
  ArchivePage,
  ArchiveRelatedOptions,
  ArchiveRelatedResult,
} from "../retrieval/query/archive-view/types.js";
import {
  getWikiGraphLibraryArchiveById,
  listWikiGraphLibraryArchives,
  type WikiGraphLibraryArchiveRecord,
} from "./membership.js";
import {
  parseWikiGraphLibraryUri,
  resolveWikiGraphLibrary,
  resolveWikiGraphLibraryById,
  type ParsedWikiGraphLibraryUri,
} from "./registry.js";
import {
  assertWikiGraphLibraryIndexReady,
  listWikiGraphLibraryIndexArchiveIdsForObject,
  listWikiGraphLibrarySearchIndex,
  queryWikiGraphLibrarySearchIndex,
} from "./search-index.js";

const DEFAULT_LIBRARY_PAGE_LIMIT = 20;

export async function findWikiGraphLibraryObjects(
  target: ParsedWikiGraphLibraryUri,
  query: string,
  options: ArchiveFindOptions = {},
): Promise<ArchiveFindResult> {
  const result = await queryWikiGraphLibrarySearchIndex(target, query);

  if (result === undefined) {
    return createFindResult(query, [], options);
  }

  const hits: ArchiveFindHit[] = [];
  for (const archive of await listReadyLibraryArchives(target)) {
    const source = createLibrarySource(archive);
    const hydrated = await readLibraryArchiveDocument(
      archive,
      async (document) =>
        await hydrateSearchIndexHits(document, {
          objectHits: result.objectHits.filter(
            (hit) => hit.archiveId === archive.id,
          ),
          terms: result.terms,
          textHits: result.textHits.filter(
            (hit) => hit.archiveId === archive.id,
          ),
        }),
    );

    hits.push(...hydrated.map((hit) => ({ ...hit, ...source })));
  }

  return createFindResult(query, hits, options, result.terms);
}

export async function listWikiGraphLibraryObjects(
  target: ParsedWikiGraphLibraryUri,
  options: ArchiveCollectionOptions = {},
): Promise<ArchiveCollectionResult> {
  const hits: ArchiveFindHit[] = [];
  const result = await listWikiGraphLibrarySearchIndex(target, {
    includeText: shouldListTextStreams(options),
  });
  const archiveIds = createSortedArchiveIds(result);
  for (const archiveId of archiveIds) {
    const archive = await resolveReadableIndexedArchive(target, archiveId);
    const source = createLibrarySource(archive);
    const hydrated = await readLibraryArchiveDocument(
      archive,
      async (document) =>
        await hydrateSearchIndexHits(document, {
          objectHits: result.objectHits.filter(
            (hit) => hit.archiveId === archive.id,
          ),
          terms: result.terms,
          textHits: result.textHits.filter(
            (hit) => hit.archiveId === archive.id,
          ),
        }),
    );

    hits.push(...hydrated.map((hit) => ({ ...hit, ...source })));
  }

  return createCollectionResult(hits, options);
}

export async function readWikiGraphLibraryPage(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  options: Parameters<typeof readArchivePage>[2] = {},
): Promise<ArchivePage> {
  const pages = await readIndexedArchiveResults(
    target,
    objectUri,
    async (document, archive) => ({
      ...(await readArchivePage(document, objectUri, options)),
      ...createLibrarySource(archive),
    }),
  );

  const page = createMultiArchivePage(pages);
  if ((page.type === "entity" || page.type === "triple") && pages.length > 1) {
    const evidence = await listWikiGraphLibraryEvidence(target, objectUri, {
      ...createPageEvidenceOptions(options),
      limit: Number.MAX_SAFE_INTEGER,
    });

    return {
      ...page,
      evidence: createEvidencePreview(evidence, options.evidenceLimit ?? 3),
    };
  }

  return page;
}

export async function listWikiGraphLibraryEvidence(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  options: ArchiveEvidenceOptions = {},
): Promise<ArchiveEvidence> {
  const results = await readIndexedArchiveResults(
    target,
    objectUri,
    async (document, archive) => {
      const { cursor: _cursor, ...archiveOptions } = options;
      const result = await listArchiveEvidence(document, objectUri, {
        ...archiveOptions,
        limit: Number.MAX_SAFE_INTEGER,
      });
      const source = createLibrarySource(archive);

      return {
        ...result,
        items: result.items.map(
          (item): ArchiveEvidenceItem => ({
            ...item,
            ...source,
          }),
        ),
      };
    },
  );

  return createEvidenceResult(
    results.flatMap((result) => result.items),
    options,
  );
}

export async function listRelatedWikiGraphLibraryObjects(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  options: ArchiveRelatedOptions = {},
): Promise<ArchiveRelatedResult> {
  const results = await readIndexedArchiveResults(
    target,
    objectUri,
    async (document, archive) => {
      const { cursor: _cursor, ...archiveOptions } = options;
      const result = await listRelatedArchiveObjects(document, objectUri, {
        ...archiveOptions,
        limit: Number.MAX_SAFE_INTEGER,
      });
      const source = createLibrarySource(archive);

      return {
        ...result,
        items: result.items.map(
          (item): ArchiveListItem => ({
            ...item,
            ...source,
          }),
        ),
      };
    },
  );

  return createRelatedResult(
    results.flatMap((result) => result.items),
    options,
  );
}

export async function packWikiGraphLibraryContext(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  budget: number,
): Promise<ArchivePack> {
  const packs = await readIndexedArchiveResults(
    target,
    objectUri,
    async (document, archive) => {
      const pack = await packArchiveContext(document, objectUri, budget);
      const source = createLibrarySource(archive);

      return {
        ...pack,
        anchor: { ...pack.anchor, ...source },
        related: pack.related.map((item) => ({ ...item, ...source })),
      };
    },
  );
  const [first] = packs;

  if (first === undefined) {
    throw new Error(`Wiki Graph library object was not found: ${objectUri}`);
  }

  return {
    anchor: createMultiArchivePage(packs.map((pack) => pack.anchor)),
    budget,
    related: packs.flatMap((pack) => pack.related),
  };
}

export async function resolveWikiGraphLibraryQueryTargetById(
  libraryId: number,
): Promise<ParsedWikiGraphLibraryUri> {
  const library = await resolveWikiGraphLibraryById(libraryId);
  return (
    parseWikiGraphLibraryUri(library.uri) ?? {
      isDefault: library.isDefault,
      kind: "scope",
      publicId: library.publicId,
    }
  );
}

async function readIndexedArchiveResults<T>(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  operation: (
    document: ReadonlyDocument,
    archive: WikiGraphLibraryArchiveRecord,
  ) => Promise<T>,
): Promise<T[]> {
  const library = await resolveWikiGraphLibrary(target);
  const archiveIds = await listWikiGraphLibraryIndexArchiveIdsForObject(
    target,
    objectUri,
  );

  if (archiveIds.length === 0) {
    return await readUnindexedArchiveResults(target, objectUri, operation);
  }

  const results: T[] = [];

  for (const archiveId of archiveIds) {
    const archive = await getWikiGraphLibraryArchiveById(library, archiveId);
    if (!isReadableLibraryArchive(archive)) {
      throw new Error(
        `Wiki Graph library archive ${archiveId} is not readable while reading ${objectUri}.`,
      );
    }

    try {
      results.push(
        await readLibraryArchiveDocument(
          archive,
          async (document) => await operation(document, archive),
        ),
      );
    } catch (error) {
      throw new Error(
        `Failed to read Wiki Graph library archive ${archiveId} (${archive.uri}) for ${objectUri}: ${formatErrorMessage(error)}`,
        { cause: error },
      );
    }
  }

  if (results.length === 0) {
    throw new Error(`Wiki Graph library object was not found: ${objectUri}`);
  }
  return results;
}

async function readUnindexedArchiveResults<T>(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  operation: (
    document: ReadonlyDocument,
    archive: WikiGraphLibraryArchiveRecord,
  ) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];

  for (const archive of await listReadyLibraryArchives(target)) {
    try {
      results.push(
        await readLibraryArchiveDocument(
          archive,
          async (document) => await operation(document, archive),
        ),
      );
    } catch (error) {
      if (isArchiveObjectNotFoundError(error)) {
        continue;
      }
      throw new Error(
        `Failed to read Wiki Graph library archive ${archive.id} (${archive.uri}) for ${objectUri}: ${formatErrorMessage(error)}`,
        { cause: error },
      );
    }
  }

  if (results.length === 0) {
    throw new Error(`Wiki Graph library object was not found: ${objectUri}`);
  }
  return results;
}

function createMultiArchivePage(pages: readonly ArchivePage[]): ArchivePage {
  const [first] = pages;
  if (first === undefined) {
    throw new Error(
      "Internal error: cannot merge an empty library page result.",
    );
  }

  const sources = createLibrarySources(pages);
  if (sources.length === 1) {
    return first;
  }

  const {
    archiveId: _archiveId,
    libraryArchiveUri: _libraryArchiveUri,
    ...page
  } = first;

  return { ...page, sources };
}

function createPageEvidenceOptions(
  options: Parameters<typeof readArchivePage>[2] = {},
): ArchiveEvidenceOptions {
  return {
    ...(options.evidenceLimit === undefined
      ? {}
      : { limit: options.evidenceLimit }),
    ...(options.order === undefined ? {} : { order: options.order }),
    ...(options.sourceContext === undefined
      ? {}
      : { sourceContext: options.sourceContext }),
  };
}

function createEvidenceResult(
  items: readonly ArchiveEvidenceItem[],
  options: ArchiveEvidenceOptions,
): ArchiveEvidence {
  const limit = options.limit ?? DEFAULT_LIBRARY_PAGE_LIMIT;
  const offset = parseLibraryObjectCursor(options.cursor, "evidence");
  const sorted = [...items].sort((left, right) =>
    compareLibraryEvidenceItems(left, right, options.order ?? "doc-asc"),
  );
  const pageItems = sorted.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;

  return {
    items: pageItems,
    limit,
    nextCursor: nextOffset < sorted.length ? String(nextOffset) : null,
  };
}

function createRelatedResult(
  items: readonly ArchiveListItem[],
  options: ArchiveRelatedOptions,
): ArchiveRelatedResult {
  const limit = options.limit ?? DEFAULT_LIBRARY_PAGE_LIMIT;
  const offset = parseLibraryObjectCursor(options.cursor, "related");
  const sorted = [...items].sort((left, right) =>
    compareLibraryListItems(left, right, options.order ?? "doc-asc"),
  );
  const pageItems = sorted.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;

  return {
    items: pageItems,
    limit,
    nextCursor: nextOffset < sorted.length ? String(nextOffset) : null,
  };
}

function createEvidencePreview(evidence: ArchiveEvidence, limit: number) {
  const sources = evidence.items.slice(0, limit);

  return {
    nextCursor:
      sources.length < evidence.items.length ? String(sources.length) : null,
    shown: sources.length,
    sources,
    total: evidence.items.length,
  };
}

function createLibrarySources(
  values: readonly {
    readonly archiveId?: number;
    readonly libraryArchiveUri?: string;
  }[],
): readonly ArchiveLibrarySource[] {
  const sources = new Map<number, ArchiveLibrarySource>();
  for (const value of values) {
    if (
      value.archiveId === undefined ||
      value.libraryArchiveUri === undefined
    ) {
      continue;
    }
    sources.set(value.archiveId, {
      archiveId: value.archiveId,
      libraryArchiveUri: value.libraryArchiveUri,
    });
  }
  return [...sources.values()].sort(
    (left, right) => left.archiveId - right.archiveId,
  );
}

function compareLibraryEvidenceItems(
  left: ArchiveEvidenceItem,
  right: ArchiveEvidenceItem,
  order: "doc-asc" | "doc-desc",
): number {
  const direction = order === "doc-asc" ? 1 : -1;
  return (
    (compareOptionalNumbers(left.archiveId, right.archiveId) ||
      left.chapterId - right.chapterId ||
      left.startSentenceIndex - right.startSentenceIndex ||
      left.endSentenceIndex - right.endSentenceIndex ||
      left.id.localeCompare(right.id)) * direction
  );
}

function compareLibraryListItems(
  left: ArchiveListItem,
  right: ArchiveListItem,
  order: "doc-asc" | "doc-desc",
): number {
  const direction = order === "doc-asc" ? 1 : -1;
  return (
    (compareOptionalNumbers(left.archiveId, right.archiveId) ||
      left.id.localeCompare(right.id)) * direction
  );
}

function compareOptionalNumbers(
  left: number | undefined,
  right: number | undefined,
): number {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function parseLibraryObjectCursor(
  cursor: string | undefined,
  kind: "evidence" | "related",
): number {
  if (cursor === undefined) {
    return 0;
  }
  if (!/^(0|[1-9][0-9]*)$/u.test(cursor)) {
    throw new Error(`Invalid library ${kind} cursor: ${cursor}`);
  }
  return Number(cursor);
}

async function listReadyLibraryArchives(
  target: ParsedWikiGraphLibraryUri,
): Promise<readonly WikiGraphLibraryArchiveRecord[]> {
  await assertWikiGraphLibraryIndexReady(target);
  return (await listWikiGraphLibraryArchives(target)).filter(
    isReadableLibraryArchive,
  );
}

function shouldListTextStreams(options: ArchiveCollectionOptions): boolean {
  return (
    options.types !== undefined &&
    options.types.some((type) => type === "source" || type === "summary")
  );
}

function createSortedArchiveIds(result: {
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

async function resolveReadableIndexedArchive(
  target: ParsedWikiGraphLibraryUri,
  archiveId: number,
): Promise<WikiGraphLibraryArchiveRecord> {
  const library = await resolveWikiGraphLibrary(target);
  const archive = await getWikiGraphLibraryArchiveById(library, archiveId);
  if (!isReadableLibraryArchive(archive)) {
    throw new Error(
      `Wiki Graph library archive ${archiveId} is not readable while listing library objects.`,
    );
  }
  return archive;
}

function isReadableLibraryArchive(
  archive: WikiGraphLibraryArchiveRecord,
): boolean {
  return archive.exists && archive.status === "present";
}

async function readLibraryArchiveDocument<T>(
  archive: WikiGraphLibraryArchiveRecord,
  operation: (document: ReadonlyDocument) => Promise<T>,
): Promise<T> {
  return await new WikiGraphArchiveFile(archive.path).readDocument(operation);
}

function createLibrarySource(
  archive: WikiGraphLibraryArchiveRecord,
): ArchiveLibrarySource {
  return {
    archiveId: archive.id,
    libraryArchiveUri: archive.uri,
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isArchiveObjectNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(" was not found in this archive.")
  );
}

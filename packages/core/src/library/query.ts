import type { ReadonlyDocument } from "../document/index.js";
import {
  listArchiveEvidence,
  listRelatedArchiveObjects,
  packArchiveContext,
  readArchivePage,
} from "../retrieval/query/archive-view/index.js";
import { RELATED_SEARCH_INDEX_RESULT } from "../retrieval/query/archive-view/related/core.js";
import {
  createCollectionResult,
  createFindResult,
} from "../retrieval/query/archive-view/helper/results.js";
import {
  findWikiGraphLibraryObjectsBucketed,
  shouldUseLibraryBucketedSearch,
} from "./search-query.js";
import { hydrateSearchIndexHits } from "../retrieval/query/archive-view/search/hydration.js";
import type {
  ArchiveCollectionOptions,
  ArchiveCollectionResult,
  ArchiveEvidence,
  ArchiveEvidenceItem,
  ArchiveEvidenceOptions,
  ArchiveFindEvidencePreview,
  ArchiveFindHit,
  ArchiveFindOptions,
  ArchiveFindOrder,
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
  createLibrarySource,
  createSortedArchiveIds,
  isReadableLibraryArchive,
  readLibraryArchiveDocument,
  resolveReadableIndexedArchive,
} from "./query-helpers.js";
import {
  parseWikiGraphLibraryUri,
  resolveWikiGraphLibrary,
  resolveWikiGraphLibraryById,
  type ParsedWikiGraphLibraryUri,
} from "./registry.js";
import {
  assertWikiGraphLibraryHasQueryableArtifacts,
  assertWikiGraphLibraryQueryArtifactsReady,
  assertWikiGraphLibraryIndexReady,
  listWikiGraphLibraryIndexArchiveIdsForObject,
  listWikiGraphLibrarySearchIndex,
  queryWikiGraphLibrarySearchIndex,
} from "./search-index.js";
import { withWikiGraphLibraryLock } from "./lock.js";

const DEFAULT_LIBRARY_PAGE_LIMIT = 20;
const LIBRARY_QUERY_INDEX_LIMIT_MULTIPLIER = 20;
const LIBRARY_QUERY_INDEX_MIN_LIMIT = 100;

export async function findWikiGraphLibraryObjects(
  target: ParsedWikiGraphLibraryUri,
  query: string,
  options: ArchiveFindOptions = {},
): Promise<ArchiveFindResult> {
  return await withLibraryQueryLock(
    target,
    async () =>
      await findWikiGraphLibraryObjectsUnlocked(target, query, options),
  );
}

async function findWikiGraphLibraryObjectsUnlocked(
  target: ParsedWikiGraphLibraryUri,
  query: string,
  options: ArchiveFindOptions,
): Promise<ArchiveFindResult> {
  if (shouldUseLibraryBucketedSearch(options)) {
    return await findWikiGraphLibraryObjectsBucketed(target, query, options);
  }
  if (options.skipUnindexed !== true) {
    await assertWikiGraphLibraryQueryArtifactsReady(
      target,
      createLibraryCoverageOptions(options),
    );
  } else {
    const coverage = createLibraryCoverageOptions(options);
    if (Object.keys(coverage).length === 0) {
      await assertWikiGraphLibraryHasQueryableArtifacts(target);
    } else {
      await assertWikiGraphLibraryHasQueryableArtifacts(target, coverage);
    }
  }

  const indexHitLimit = createLibraryQueryIndexHitLimit(options);
  const result = await queryWikiGraphLibrarySearchIndex(target, query, {
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
    ...(options.queryMode === undefined
      ? {}
      : { queryMode: options.queryMode }),
    objectHitLimit: indexHitLimit,
    textHitLimit: indexHitLimit,
  });

  if (result === undefined) {
    return createFindResult(query, [], options);
  }

  const hits: ArchiveFindHit[] = [];
  for (const archiveId of createSortedArchiveIds(result)) {
    const archive = await resolveReadableIndexedArchive(target, archiveId, {
      operation: "searching library objects",
    });
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

function createLibraryCoverageOptions(
  options: ArchiveFindOptions,
): Pick<ArchiveFindOptions, "embeddingProvider" | "queryMode"> {
  return {
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
    ...(options.queryMode === undefined
      ? {}
      : { queryMode: options.queryMode }),
  };
}

export async function findWikiGraphLibraryArchiveMembers(
  target: ParsedWikiGraphLibraryUri,
  query: string,
  options: ArchiveFindOptions = {},
): Promise<ArchiveFindResult> {
  return await withLibraryQueryLock(
    target,
    async () =>
      await findWikiGraphLibraryArchiveMembersUnlocked(target, query, options),
  );
}

async function findWikiGraphLibraryArchiveMembersUnlocked(
  target: ParsedWikiGraphLibraryUri,
  query: string,
  options: ArchiveFindOptions,
): Promise<ArchiveFindResult> {
  const terms = createLibraryArchiveMemberSearchTerms(query);
  const archives = await listWikiGraphLibraryArchives(target);
  const hits = archives
    .map(formatLibraryArchiveMemberHit)
    .filter((hit) => matchesLibraryArchiveMemberSearch(hit, terms));

  return createFindResult(query, hits, options, terms, "typed");
}

function createLibraryQueryIndexHitLimit(options: ArchiveFindOptions): number {
  return Math.max(
    (options.limit ?? DEFAULT_LIBRARY_PAGE_LIMIT) *
      LIBRARY_QUERY_INDEX_LIMIT_MULTIPLIER,
    LIBRARY_QUERY_INDEX_MIN_LIMIT,
  );
}

function createLibraryArchiveMemberSearchTerms(
  query: string,
): readonly string[] {
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
}

function matchesLibraryArchiveMemberSearch(
  hit: ArchiveFindHit,
  terms: readonly string[],
): boolean {
  if (terms.length === 0) {
    return true;
  }
  const haystack =
    `${hit.id}\n${hit.title}\n${hit.snippet}`.toLocaleLowerCase();

  return terms.every((term) => haystack.includes(term));
}

function formatLibraryArchiveMemberHit(
  archive: WikiGraphLibraryArchiveRecord,
): ArchiveFindHit {
  const details = [
    archive.relativePath,
    archive.status,
    archive.exists ? "exists" : "missing-file",
  ].join("  ");

  return {
    archiveId: archive.id,
    field: "metadata",
    id: archive.uri,
    libraryArchiveUri: archive.uri,
    snippet: details,
    title: archive.relativePath,
    type: "meta",
  };
}

export async function listWikiGraphLibraryObjects(
  target: ParsedWikiGraphLibraryUri,
  options: ArchiveCollectionOptions = {},
): Promise<ArchiveCollectionResult> {
  return await withLibraryQueryLock(
    target,
    async () => await listWikiGraphLibraryObjectsUnlocked(target, options),
  );
}

async function listWikiGraphLibraryObjectsUnlocked(
  target: ParsedWikiGraphLibraryUri,
  options: ArchiveCollectionOptions,
): Promise<ArchiveCollectionResult> {
  const hits: ArchiveFindHit[] = [];
  const result = await listWikiGraphLibrarySearchIndex(target, {
    includeText: shouldListTextStreams(options),
  });
  const archiveIds = createSortedArchiveIds(result);
  for (const archiveId of archiveIds) {
    const archive = await resolveReadableIndexedArchive(target, archiveId, {
      operation: "listing library objects",
    });
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

export async function listWikiGraphLibraryArchiveMembers(
  target: ParsedWikiGraphLibraryUri,
  options: ArchiveCollectionOptions = {},
): Promise<ArchiveCollectionResult> {
  return await withLibraryQueryLock(
    target,
    async () =>
      await listWikiGraphLibraryArchiveMembersUnlocked(target, options),
  );
}

async function listWikiGraphLibraryArchiveMembersUnlocked(
  target: ParsedWikiGraphLibraryUri,
  options: ArchiveCollectionOptions,
): Promise<ArchiveCollectionResult> {
  return createCollectionResult(
    (await listWikiGraphLibraryArchives(target)).map(
      formatLibraryArchiveMemberHit,
    ),
    options,
  );
}

export async function readWikiGraphLibraryPage(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  options: Parameters<typeof readArchivePage>[2] = {},
): Promise<ArchivePage> {
  return await withLibraryQueryLock(
    target,
    async () =>
      await readWikiGraphLibraryPageUnlocked(target, objectUri, options),
  );
}

async function readWikiGraphLibraryPageUnlocked(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  options: NonNullable<Parameters<typeof readArchivePage>[2]>,
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
    return {
      ...page,
      evidence: combinePageEvidencePreviews(
        pages,
        options.evidenceLimit ?? 3,
        options.order ?? "doc-asc",
      ),
    };
  }

  return page;
}

export async function listWikiGraphLibraryEvidence(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  options: ArchiveEvidenceOptions = {},
): Promise<ArchiveEvidence> {
  return await withLibraryQueryLock(
    target,
    async () =>
      await listWikiGraphLibraryEvidenceUnlocked(target, objectUri, options),
  );
}

async function listWikiGraphLibraryEvidenceUnlocked(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  options: ArchiveEvidenceOptions,
): Promise<ArchiveEvidence> {
  if (options.query !== undefined) {
    if (options.skipUnindexed === true) {
      await assertWikiGraphLibraryHasQueryableArtifacts(target, options);
    } else {
      await assertWikiGraphLibraryQueryArtifactsReady(target, options);
    }
  }
  const limit = options.limit ?? DEFAULT_LIBRARY_PAGE_LIMIT;
  const offset = parseLibraryObjectCursor(options.cursor, "evidence");
  const archiveWindowLimit = offset + limit;
  const results = await readIndexedArchiveResults(
    target,
    objectUri,
    async (document, archive) => {
      const { cursor: _cursor, ...archiveOptions } = options;
      const result = await listArchiveEvidence(document, objectUri, {
        ...archiveOptions,
        limit: archiveWindowLimit,
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
  return await withLibraryQueryLock(
    target,
    async () =>
      await listRelatedWikiGraphLibraryObjectsUnlocked(
        target,
        objectUri,
        options,
      ),
  );
}

async function listRelatedWikiGraphLibraryObjectsUnlocked(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
  options: ArchiveRelatedOptions,
): Promise<ArchiveRelatedResult> {
  if (options.query !== undefined) {
    if (options.skipUnindexed === true) {
      await assertWikiGraphLibraryHasQueryableArtifacts(target, options);
    } else {
      await assertWikiGraphLibraryQueryArtifactsReady(target, options);
    }
  }
  const libraryIndexResult =
    options.query === undefined
      ? undefined
      : ((await queryWikiGraphLibrarySearchIndex(target, options.query, {
          ...(options.embeddingProvider === undefined
            ? {}
            : { embeddingProvider: options.embeddingProvider }),
          ...(options.queryMode === undefined
            ? {}
            : { queryMode: options.queryMode }),
          types: ["entity", "node", "source"],
        })) ?? null);
  const limit = options.limit ?? DEFAULT_LIBRARY_PAGE_LIMIT;
  const offset = parseLibraryObjectCursor(options.cursor, "related");
  const archiveWindowLimit = offset + limit;
  const results = await readIndexedArchiveResults(
    target,
    objectUri,
    async (document, archive) => {
      const { cursor: _cursor, ...archiveOptions } = options;
      const result = await listRelatedArchiveObjects(document, objectUri, {
        ...archiveOptions,
        limit: archiveWindowLimit,
        ...(libraryIndexResult === undefined
          ? {}
          : {
              [RELATED_SEARCH_INDEX_RESULT]:
                libraryIndexResult === null
                  ? null
                  : {
                      objectHits: libraryIndexResult.objectHits.filter(
                        (hit) => hit.archiveId === archive.id,
                      ),
                      terms: libraryIndexResult.terms,
                      textHits: libraryIndexResult.textHits.filter(
                        (hit) => hit.archiveId === archive.id,
                      ),
                    },
            }),
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
  return await withLibraryQueryLock(
    target,
    async () =>
      await packWikiGraphLibraryContextUnlocked(target, objectUri, budget),
  );
}

async function packWikiGraphLibraryContextUnlocked(
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

async function withLibraryQueryLock<T>(
  target: ParsedWikiGraphLibraryUri,
  operation: () => Promise<T>,
): Promise<T> {
  const library = await resolveWikiGraphLibrary(target);
  return await withWikiGraphLibraryLock(library.id, "read", operation);
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
    if (!isTripleObjectUri(objectUri)) {
      throw new Error(`Wiki Graph library object was not found: ${objectUri}`);
    }

    // Library v1 cannot project every triple occurrence into the index yet.
    // Keep the archive scan explicit and restricted to triples so entity/chunk
    // lookups remain index-backed and do not silently regress to full scans.
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

function combinePageEvidencePreviews(
  pages: readonly ArchivePage[],
  limit: number,
  order: ArchiveFindOrder,
): ArchiveFindEvidencePreview {
  const evidencePages = pages.flatMap((page) =>
    page.type === "entity" || page.type === "triple" ? [page] : [],
  );
  const orderedPages =
    order === "doc-desc" ? evidencePages.slice().reverse() : evidencePages;
  const sources = orderedPages.flatMap((page) =>
    page.evidence.sources.map((source) => ({
      ...source,
      ...(page.archiveId === undefined ? {} : { archiveId: page.archiveId }),
      ...(page.libraryArchiveUri === undefined
        ? {}
        : { libraryArchiveUri: page.libraryArchiveUri }),
    })),
  );
  const total = evidencePages.reduce(
    (sum, page) => sum + page.evidence.total,
    0,
  );
  const pageSources = sources.slice(0, limit);
  const shown = pageSources.length;

  return {
    nextCursor: limit < total ? String(limit) : null,
    shown,
    sources: pageSources,
    total,
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

export function createLibrarySources(
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isArchiveObjectNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(" was not found in this archive.")
  );
}

function isTripleObjectUri(objectUri: string): boolean {
  return /^wikg:\/\/(?:chapter\/[1-9][0-9]*\/)?triple\/Q[1-9][0-9]*\/[^/]+\/Q[1-9][0-9]*\/?$/u.test(
    objectUri,
  );
}

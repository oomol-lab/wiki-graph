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
import {
  BROAD_FIND_LENS_HINT,
  DEFAULT_FIND_LIMIT,
} from "../retrieval/query/archive-view/helper/constants.js";
import { createLexicalQuery } from "../retrieval/query/lexical-search.js";
import {
  compareChapterTitleIndexHits,
  compareTextIndexHits,
  getObjectBucketCursorId,
  isAfterChapterTitleKey,
  isAfterTextKey,
} from "../retrieval/query/archive-view/search/bucket-order.js";
import {
  hydrateCachedChunkBucketHit,
  hydrateCachedObjectBucketHit,
} from "../retrieval/query/archive-view/search/bucket-hydration.js";
import { hydrateSearchIndexHits } from "../retrieval/query/archive-view/search/hydration.js";
import { tryDecodeBucketSearchSessionCursor } from "../retrieval/query/archive-view/search/buckets.js";
import {
  createSearchSession,
  encodeBucketSearchSessionCursor,
  populateSearchSessionObjectCaches,
  readSearchSessionChunkBucketPage,
  readSearchSessionDescriptor,
  readSearchSessionMetadataForCursor,
  readSearchSessionObjectBucketPage,
  type BucketSearchCursor,
  type SearchChapterTitleCursorKey,
  type SearchChunkCursorKey,
  type SearchObjectCursorKey,
  type SearchSessionDescriptor,
  type SearchTextCursorKey,
} from "../retrieval/query/search-cache/index.js";
import {
  SEARCH_INDEX_FTS_HIT_LIMIT,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  type SearchIndexObjectHit,
  type SearchIndexTextHit,
} from "../retrieval/search-index/index.js";
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
const LIBRARY_QUERY_INDEX_LIMIT_MULTIPLIER = 20;
const LIBRARY_QUERY_INDEX_MIN_LIMIT = 100;

export async function findWikiGraphLibraryObjects(
  target: ParsedWikiGraphLibraryUri,
  query: string,
  options: ArchiveFindOptions = {},
): Promise<ArchiveFindResult> {
  if (shouldUseLibraryBucketedSearch(options)) {
    return await findWikiGraphLibraryObjectsBucketed(target, query, options);
  }

  const indexHitLimit = createLibraryQueryIndexHitLimit(options);
  const result = await queryWikiGraphLibrarySearchIndex(target, query, {
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

function shouldUseLibraryBucketedSearch(options: ArchiveFindOptions): boolean {
  return options.types === undefined && options.triplePattern === undefined;
}

function createLibraryQueryIndexHitLimit(options: ArchiveFindOptions): number {
  return Math.max(
    (options.limit ?? DEFAULT_LIBRARY_PAGE_LIMIT) *
      LIBRARY_QUERY_INDEX_LIMIT_MULTIPLIER,
    LIBRARY_QUERY_INDEX_MIN_LIMIT,
  );
}

async function findWikiGraphLibraryObjectsBucketed(
  target: ParsedWikiGraphLibraryUri,
  query: string,
  options: ArchiveFindOptions,
): Promise<ArchiveFindResult> {
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const search = createLexicalQuery(query);

  if (search === undefined) {
    return createFindResult(query, [], options);
  }
  if (options.cursor !== undefined) {
    const cursor = tryDecodeBucketSearchSessionCursor(options.cursor);

    if (cursor === undefined) {
      throw new Error("Invalid search cursor.");
    }
    return await readLibraryBucketedSearchResultPage(target, cursor, {
      ...options,
      limit,
    });
  }

  const state = await assertWikiGraphLibraryIndexReady(target);
  const archiveKey = createLibrarySearchArchiveKey(target);
  const sessionId = await createSearchSession({
    archiveKey,
    chapters: options.chapters ?? null,
    lens: "broad",
    match: options.match ?? "any",
    order: options.order ?? "doc-asc",
    query,
    revisionScope: state.sourceFingerprint,
    terms: search.terms,
    types: null,
  });
  const descriptor = await readSearchSessionDescriptor(sessionId, archiveKey);

  return await readLibraryBucketedSearchResultPage(
    target,
    {
      createdAt: descriptor.createdAt,
      cursor: { bucket: 0 },
      sessionId,
    },
    { ...options, limit },
  );
}

async function readLibraryBucketedSearchResultPage(
  target: ParsedWikiGraphLibraryUri,
  cursor: {
    readonly createdAt: number;
    readonly cursor: BucketSearchCursor;
    readonly sessionId: string;
  },
  options: ArchiveFindOptions & { readonly limit: number },
): Promise<ArchiveFindResult> {
  const archiveKey = createLibrarySearchArchiveKey(target);
  const session = await readSearchSessionMetadataForCursor(
    cursor.sessionId,
    archiveKey,
    cursor.createdAt,
  );
  const items: ArchiveFindHit[] = [];
  let bucketCursor: BucketSearchCursor | undefined = cursor.cursor;

  while (bucketCursor !== undefined && items.length < options.limit) {
    const remaining = options.limit - items.length;
    const page = await readLibraryBucketPage(
      target,
      session,
      bucketCursor,
      remaining,
    );

    items.push(...page.items);
    bucketCursor = page.nextCursor;
  }

  return {
    chapters: session.chapters,
    items,
    lens: "broad",
    lensHint: BROAD_FIND_LENS_HINT,
    limit: options.limit,
    match: session.match as ArchiveFindResult["match"],
    nextCursor:
      bucketCursor === undefined
        ? null
        : encodeBucketSearchSessionCursor(
            cursor.sessionId,
            bucketCursor,
            session.createdAt,
          ),
    order: options.order ?? "doc-asc",
    query: session.query,
    terms: session.terms,
    types: null,
  };
}

async function readLibraryBucketPage(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  cursor: BucketSearchCursor,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  switch (cursor.bucket) {
    case 0:
      return await readLibraryChapterTitleBucketPage(
        target,
        session,
        cursor.key,
        limit,
      );
    case 1:
      return await readLibraryObjectBucketPage(
        target,
        session,
        cursor.key,
        limit,
      );
    case 2:
      return await readLibraryChunkBucketPage(
        target,
        session,
        cursor.key,
        limit,
      );
    case 3:
      return await readLibraryTextBucketPage(
        target,
        session,
        cursor.key,
        limit,
      );
  }
}

async function readLibraryChapterTitleBucketPage(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  after: SearchChapterTitleCursorKey | undefined,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  const result = await queryWikiGraphLibrarySearchIndex(target, session.query, {
    match: session.match as ArchiveFindResult["match"],
    objectHitLimit: SEARCH_INDEX_FTS_HIT_LIMIT,
    textHitLimit: 0,
    types: ["chapter-title"],
  });
  const hits = [...(result?.objectHits ?? [])]
    .filter(
      (hit) => hit.ownerKind === SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter,
    )
    .sort(compareChapterTitleIndexHits)
    .filter((hit) => isAfterChapterTitleKey(hit, after));
  const page = hits.slice(0, limit + 1);
  const items = await hydrateLibraryIndexHits(target, {
    objectHits: page.slice(0, limit),
    terms: session.terms,
    textHits: [],
  });
  const last = page.at(limit - 1);

  return {
    items,
    nextCursor:
      page.length > limit && last !== undefined
        ? {
            bucket: 0,
            key: {
              archiveId: last.archiveId,
              chapterId: Number(last.ownerId),
              score: last.score,
            },
          }
        : { bucket: 1 },
  };
}

async function readLibraryObjectBucketPage(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  after: SearchObjectCursorKey | undefined,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  if (!session.objectCachesPopulated) {
    await populateLibraryObjectBucketCaches(target, session);
  }
  const page = await readSearchSessionObjectBucketPage(
    session.sessionId,
    1,
    after,
    limit,
  );
  const items = page.slice(0, limit);
  const hydrated = await hydrateLibraryCachedHits(
    target,
    items,
    async (document, hit) => await hydrateCachedObjectBucketHit(document, hit),
  );
  const last = items.at(-1);

  return {
    items: hydrated,
    nextCursor:
      page.length > limit && last !== undefined
        ? {
            bucket: 1,
            key: {
              archiveId: getLibraryHitArchiveId(last),
              id: getObjectBucketCursorId(last),
              kind: last.type === "triple" ? "triple" : "entity",
              score: last.score ?? 0,
            },
          }
        : { bucket: 2 },
  };
}

async function readLibraryChunkBucketPage(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  after: SearchChunkCursorKey | undefined,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  const page = await readSearchSessionChunkBucketPage(
    session.sessionId,
    after,
    limit,
  );
  const items = page.slice(0, limit);
  const hydrated = await hydrateLibraryCachedHits(
    target,
    items,
    async (document, hit) => await hydrateCachedChunkBucketHit(document, hit),
  );
  const last = items.at(-1);

  return {
    items: hydrated,
    nextCursor:
      page.length > limit && last !== undefined
        ? {
            bucket: 2,
            key: {
              archiveId: getLibraryHitArchiveId(last),
              chunkId: Number(last.id.slice("wikg://chunk/".length)),
              score: last.score ?? 0,
            },
          }
        : { bucket: 3 },
  };
}

async function readLibraryTextBucketPage(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  after: SearchTextCursorKey | undefined,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  const result = await queryWikiGraphLibrarySearchIndex(target, session.query, {
    match: session.match as ArchiveFindResult["match"],
    objectHitLimit: 0,
    ...(after === undefined
      ? {}
      : {
          textAfter: {
            archiveId: after.archiveId,
            chapterId: after.chapterId,
            kind: after.kind as SearchIndexTextHit["kind"],
            rank: after.rank,
            sentenceIndex: after.sentenceIndex,
          },
        }),
    textHitLimit: createLibraryBucketQueryWindow(limit),
    types: ["source", "summary"],
  });
  const hits = [...(result?.textHits ?? [])]
    .sort(compareTextIndexHits)
    .filter((hit) => isAfterTextKey(hit, after));
  const page = hits.slice(0, limit + 1);
  const items = await hydrateLibraryIndexHits(target, {
    objectHits: [],
    terms: session.terms,
    textHits: page.slice(0, limit),
  });
  const last = page.at(limit - 1);

  return {
    items,
    nextCursor:
      page.length > limit && last !== undefined
        ? {
            bucket: 3,
            key: {
              archiveId: last.archiveId,
              chapterId: last.chapterId,
              kind: last.kind,
              rank: last.rank,
              sentenceIndex: last.sentenceIndex,
            },
          }
        : undefined,
  };
}

function createLibraryBucketQueryWindow(limit: number): number {
  return Math.max(limit + 1, limit * 3 + 1, 100);
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

async function populateLibraryObjectBucketCaches(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
): Promise<void> {
  const result = await queryWikiGraphLibrarySearchIndex(target, session.query, {
    match: session.match as ArchiveFindResult["match"],
    objectHitLimit: SEARCH_INDEX_FTS_HIT_LIMIT,
    textHitLimit: 0,
    types: null,
  });
  const entityScores = new Map<string, number[]>();
  const chunkScores = new Map<string, number[]>();

  for (const hit of result?.objectHits ?? []) {
    if (hit.ownerKind === SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity) {
      const key = createLibraryScopedObjectKey(hit.archiveId, hit.ownerId);
      const scores = entityScores.get(key) ?? [];

      scores.push(hit.score);
      entityScores.set(key, scores);
      continue;
    }
    if (hit.ownerKind === SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk) {
      const key = createLibraryScopedObjectKey(hit.archiveId, hit.ownerId);
      const scores = chunkScores.get(key) ?? [];

      scores.push(hit.score);
      chunkScores.set(key, scores);
    }
  }

  await populateSearchSessionObjectCaches({
    chunkHits: [...chunkScores].map(([key, propertyTopScores]) => {
      const { archiveId, objectId } = parseLibraryScopedObjectKey(key);

      return {
        archiveId,
        chunkId: Number(objectId),
        propertyTopScores,
      };
    }),
    entityHits: [...entityScores].map(([key, propertyTopScores]) => {
      const { archiveId, objectId } = parseLibraryScopedObjectKey(key);

      return {
        archiveId,
        propertyTopScores,
        qid: objectId,
      };
    }),
    sessionId: session.sessionId,
  });
}

async function hydrateLibraryIndexHits(
  target: ParsedWikiGraphLibraryUri,
  result: {
    readonly objectHits: readonly SearchIndexObjectHit[];
    readonly terms: readonly string[];
    readonly textHits: readonly SearchIndexTextHit[];
  },
): Promise<readonly ArchiveFindHit[]> {
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

  return hits;
}

async function hydrateLibraryCachedHits(
  target: ParsedWikiGraphLibraryUri,
  hits: readonly ArchiveFindHit[],
  hydrate: (
    document: ReadonlyDocument,
    hit: ArchiveFindHit,
  ) => Promise<ArchiveFindHit | undefined>,
): Promise<readonly ArchiveFindHit[]> {
  const hydrated: ArchiveFindHit[] = [];

  for (const archiveId of [
    ...new Set(hits.map((hit) => getLibraryHitArchiveId(hit))),
  ].sort((left, right) => left - right)) {
    const archive = await resolveReadableIndexedArchive(target, archiveId, {
      operation: "searching library objects",
    });
    const source = createLibrarySource(archive);
    const archiveHits = hits.filter(
      (hit) => getLibraryHitArchiveId(hit) === archiveId,
    );

    await readLibraryArchiveDocument(archive, async (document) => {
      for (const hit of archiveHits) {
        const item = await hydrate(document, hit);

        if (item !== undefined) {
          hydrated.push({ ...item, ...source });
        }
      }
    });
  }

  return hydrated;
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

function createLibrarySearchArchiveKey(
  target: ParsedWikiGraphLibraryUri,
): string {
  return target.isDefault
    ? "library:default"
    : `library:${target.publicId ?? "unknown"}`;
}

function getLibraryHitArchiveId(hit: ArchiveFindHit): number {
  if (hit.archiveId === undefined) {
    throw new Error("Internal error: library search hit is missing archiveId.");
  }
  return hit.archiveId;
}

function createLibraryScopedObjectKey(
  archiveId: number,
  objectId: string,
): string {
  return `${archiveId}:${objectId}`;
}

function parseLibraryScopedObjectKey(key: string): {
  readonly archiveId: number;
  readonly objectId: string;
} {
  const separator = key.indexOf(":");

  if (separator <= 0) {
    throw new Error(`Invalid library search cache key: ${key}`);
  }

  return {
    archiveId: Number(key.slice(0, separator)),
    objectId: key.slice(separator + 1),
  };
}

async function resolveReadableIndexedArchive(
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

function isTripleObjectUri(objectUri: string): boolean {
  return /^wikg:\/\/(?:chapter\/[1-9][0-9]*\/)?triple\/Q[1-9][0-9]*\/[^/]+\/Q[1-9][0-9]*\/?$/u.test(
    objectUri,
  );
}

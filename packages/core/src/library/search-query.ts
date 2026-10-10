import type { ReadonlyDocument } from "../document/index.js";
import {
  BROAD_FIND_LENS_HINT,
  DEFAULT_FIND_LIMIT,
} from "../retrieval/query/archive-view/helper/constants.js";
import { createFindResult } from "../retrieval/query/archive-view/helper/results.js";
import { createLexicalQuery } from "../retrieval/query/lexical-search.js";
import {
  compareTitleIndexHits,
  compareTextIndexHits,
  createTitleBucketTypes,
  getObjectBucketCursorId,
  isAfterTitleKey,
  isAfterTextKey,
  matchesTitleBucketType,
} from "../retrieval/query/archive-view/search/bucket-order.js";
import {
  hydrateCachedChunkBucketHit,
  hydrateCachedObjectBucketHit,
} from "../retrieval/query/archive-view/search/bucket-hydration.js";
import {
  assertSearchCursorContextMatch,
  createSentenceEvidenceSearchCacheInput,
} from "../retrieval/query/archive-view/search/cache-input.js";
import { hydrateSearchIndexHits } from "../retrieval/query/archive-view/search/hydration.js";
import { tryDecodeBucketSearchSessionCursor } from "../retrieval/query/archive-view/search/buckets.js";
import {
  createSearchSession,
  decodeIndependentBucketSearchSessionCursor,
  encodeBucketSearchSessionCursor,
  encodeIndependentBucketSearchSessionCursor,
  populateSearchSessionObjectCaches,
  readSearchSessionChunkBucketPage,
  readSearchSessionDescriptor,
  readSearchSessionMetadataForCursor,
  readSearchSessionObjectBucketPage,
  type BucketSearchCursor,
  type SearchTitleCursorKey,
  type SearchChunkHitInput,
  type SearchChunkCursorKey,
  type SearchEntityHitInput,
  type SearchEvidenceHitEventInput,
  type SearchObjectCursorKey,
  type SearchSessionDescriptor,
  type SearchTextCursorKey,
  type SearchTripleHitInput,
} from "../retrieval/query/search-cache/index.js";
import {
  SEARCH_INDEX_FTS_HIT_LIMIT,
  SEARCH_INDEX_VERSION,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  type SearchIndexObjectHit,
  type SearchIndexTextHit,
} from "../retrieval/search-index/index.js";
import type {
  ArchiveFindFilterType,
  ArchiveFindHit,
  ArchiveFindOptions,
  ArchiveFindResult,
} from "../retrieval/query/archive-view/types.js";
import type { ParsedWikiGraphLibraryUri } from "./registry.js";
import {
  assertWikiGraphLibraryHasQueryableArtifacts,
  assertWikiGraphLibraryQueryArtifactsReady,
  assertWikiGraphLibraryIndexReady,
  queryWikiGraphLibrarySearchIndex,
} from "./search-index.js";
import {
  createLibrarySource,
  createSortedArchiveIds,
  readLibraryArchiveDocument,
  resolveReadableIndexedArchive,
} from "./query-helpers.js";

export interface WikiGraphLibrarySearchBucketDefinition {
  readonly id: string;
  readonly types: readonly ArchiveFindFilterType[];
}

export interface WikiGraphLibraryBucketSearchOptions extends Omit<
  ArchiveFindOptions,
  "cursor" | "limit" | "triplePattern" | "types"
> {
  readonly buckets: readonly WikiGraphLibrarySearchBucketDefinition[];
  readonly limitPerBucket?: number;
}

export interface WikiGraphLibrarySearchBucketPage {
  readonly id: string;
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: string | null;
  readonly query: string;
  readonly terms: readonly string[];
  readonly types: readonly ArchiveFindFilterType[];
}

export interface WikiGraphLibraryBucketSearchResult {
  readonly buckets: readonly WikiGraphLibrarySearchBucketPage[];
  readonly query: string;
}

export interface WikiGraphLibraryBucketContinuationOptions {
  readonly embeddingProvider?: ArchiveFindOptions["embeddingProvider"];
  readonly limit?: number;
}

export function shouldUseLibraryBucketedSearch(
  options: ArchiveFindOptions,
): boolean {
  return options.triplePattern === undefined;
}

export async function findWikiGraphLibraryObjectBucketsShared(
  target: ParsedWikiGraphLibraryUri,
  query: string,
  options: WikiGraphLibraryBucketSearchOptions,
): Promise<WikiGraphLibraryBucketSearchResult> {
  assertLibrarySearchBucketDefinitions(options.buckets);
  const limit = options.limitPerBucket ?? DEFAULT_FIND_LIMIT;
  const search = createLexicalQuery(query);

  if (search === undefined) {
    return {
      buckets: options.buckets.map((bucket) => ({
        id: bucket.id,
        items: [],
        nextCursor: null,
        query,
        terms: [],
        types: bucket.types,
      })),
      query,
    };
  }

  await assertLibrarySearchReady(target, options);
  const state = await assertWikiGraphLibraryIndexReady(target);
  const archiveKey = createLibrarySearchArchiveKey(target);
  const types = [...new Set(options.buckets.flatMap((bucket) => bucket.types))];
  const sessionId = await createSearchSession({
    archiveKey,
    chapters: options.chapters ?? null,
    lens: "typed",
    match: options.match ?? "any",
    order: options.order ?? "doc-asc",
    query,
    queryMode: options.queryMode ?? "hybrid",
    revisionScope: `${SEARCH_INDEX_VERSION}:${state.sourceFingerprint}`,
    terms: search.terms,
    types,
  });
  const session = await readSearchSessionDescriptor(sessionId, archiveKey);
  const buckets: WikiGraphLibrarySearchBucketPage[] = [];

  for (const bucket of options.buckets) {
    buckets.push(
      await readLibraryIndependentBucketPage(
        target,
        session,
        bucket.id,
        bucket.types,
        { bucket: 0 },
        limit,
        options,
      ),
    );
  }

  return { buckets, query };
}

export async function continueWikiGraphLibraryObjectBucketShared(
  target: ParsedWikiGraphLibraryUri,
  cursorValue: string,
  options: WikiGraphLibraryBucketContinuationOptions = {},
): Promise<WikiGraphLibrarySearchBucketPage> {
  const cursor = decodeIndependentBucketSearchSessionCursor(cursorValue);
  const archiveKey = createLibrarySearchArchiveKey(target);
  const session = await readSearchSessionMetadataForCursor(
    cursor.sessionId,
    archiveKey,
    cursor.createdAt,
  );
  const types = cursor.types as readonly ArchiveFindFilterType[];

  assertIndependentBucketTypes(types, session.types);
  return await readLibraryIndependentBucketPage(
    target,
    session,
    cursor.bucketId,
    types,
    cursor.cursor,
    options.limit ?? DEFAULT_FIND_LIMIT,
    options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider },
  );
}

async function readLibraryIndependentBucketPage(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  bucketId: string,
  types: readonly ArchiveFindFilterType[],
  cursor: BucketSearchCursor,
  limit: number,
  options: Pick<ArchiveFindOptions, "embeddingProvider">,
): Promise<WikiGraphLibrarySearchBucketPage> {
  const items: ArchiveFindHit[] = [];
  let bucketCursor: BucketSearchCursor | undefined = cursor;

  while (bucketCursor !== undefined && items.length < limit) {
    const page = await readLibraryBucketPage(
      target,
      session,
      bucketCursor,
      limit - items.length,
      options,
      types,
    );
    items.push(...page.items);
    bucketCursor = page.nextCursor;
  }
  bucketCursor = normalizeIndependentBucketCursor(types, bucketCursor);

  return {
    id: bucketId,
    items,
    nextCursor:
      bucketCursor === undefined
        ? null
        : encodeIndependentBucketSearchSessionCursor(
            session.sessionId,
            bucketId,
            types,
            bucketCursor,
            session.createdAt,
          ),
    query: session.query,
    terms: session.terms,
    types,
  };
}

export async function findWikiGraphLibraryObjectsBucketed(
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
    return await readLibraryBucketedSearchResultPage(target, query, cursor, {
      ...options,
      limit,
    });
  }

  await assertLibrarySearchReady(target, options);
  const state = await assertWikiGraphLibraryIndexReady(target);
  const archiveKey = createLibrarySearchArchiveKey(target);
  const types = options.types ?? null;
  const sessionId = await createSearchSession({
    archiveKey,
    chapters: options.chapters ?? null,
    lens: options.types === undefined ? "broad" : "typed",
    match: options.match ?? "any",
    order: options.order ?? "doc-asc",
    query,
    queryMode: options.queryMode ?? "hybrid",
    revisionScope: `${SEARCH_INDEX_VERSION}:${state.sourceFingerprint}`,
    terms: search.terms,
    types,
  });
  const descriptor = await readSearchSessionDescriptor(sessionId, archiveKey);

  return await readLibraryBucketedSearchResultPage(
    target,
    query,
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
  query: string,
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

  assertLibrarySearchCursorTypesMatch(options.types, session.types);
  assertSearchCursorContextMatch(query, options, session);

  const items: ArchiveFindHit[] = [];
  let bucketCursor: BucketSearchCursor | undefined = cursor.cursor;

  while (bucketCursor !== undefined && items.length < options.limit) {
    const remaining = options.limit - items.length;
    const page = await readLibraryBucketPage(
      target,
      session,
      bucketCursor,
      remaining,
      options,
      session.types as readonly ArchiveFindFilterType[] | null,
    );

    items.push(...page.items);
    bucketCursor = page.nextCursor;
  }

  return {
    chapters: session.chapters,
    items,
    lens: session.types === null ? "broad" : "typed",
    lensHint: session.types === null ? BROAD_FIND_LENS_HINT : null,
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
    order: session.order,
    query: session.query,
    terms: session.terms,
    types: session.types as ArchiveFindResult["types"],
  };
}

async function readLibraryBucketPage(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  cursor: BucketSearchCursor,
  limit: number,
  options: ArchiveFindOptions,
  types: readonly ArchiveFindFilterType[] | null,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  switch (cursor.bucket) {
    case 0:
      return shouldReadLibraryBucket(
        types,
        "archive",
        "archive-title",
        "chapter",
        "chapter-title",
      )
        ? await readLibraryChapterTitleBucketPage(
            target,
            session,
            cursor.key,
            limit,
            options,
            types,
          )
        : { items: [], nextCursor: { bucket: 1 } };
    case 1:
      return shouldReadLibraryBucket(types, "entity", "triple")
        ? await readLibraryObjectBucketPage(
            target,
            session,
            cursor.key,
            limit,
            options,
            types,
          )
        : { items: [], nextCursor: { bucket: 2 } };
    case 2:
      return shouldReadLibraryBucket(types, "node")
        ? await readLibraryChunkBucketPage(
            target,
            session,
            cursor.key,
            limit,
            options,
            types,
          )
        : { items: [], nextCursor: { bucket: 3 } };
    case 3:
      return shouldReadLibraryBucket(types, "source", "summary")
        ? await readLibraryTextBucketPage(
            target,
            session,
            cursor.key,
            limit,
            options,
            types,
          )
        : { items: [], nextCursor: undefined };
  }
}

async function readLibraryChapterTitleBucketPage(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  after: SearchTitleCursorKey | undefined,
  limit: number,
  options: ArchiveFindOptions,
  types: readonly ArchiveFindFilterType[] | null,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  const titleTypes = createTitleBucketTypes(types);
  const result = await queryWikiGraphLibrarySearchIndex(target, session.query, {
    ...(session.chapters === null ? {} : { chapters: session.chapters }),
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
    match: session.match as ArchiveFindResult["match"],
    queryMode: session.queryMode,
    queryId: session.sessionId,
    objectHitLimit: SEARCH_INDEX_FTS_HIT_LIMIT,
    textHitLimit: SEARCH_INDEX_FTS_HIT_LIMIT,
    types: titleTypes,
  });
  const hits = createLibraryChapterTitleIndexHits(result)
    .filter((hit) => matchesTitleBucketType(hit, titleTypes))
    .sort(compareTitleIndexHits)
    .filter((hit) => isAfterTitleKey(hit, after));
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
              ownerId: last.ownerId,
              ownerKind: last.ownerKind,
              score: last.score,
            },
          }
        : { bucket: 1 },
  };
}

function createLibraryChapterTitleIndexHits(
  result:
    | {
        readonly objectHits: readonly SearchIndexObjectHit[];
        readonly textHits: readonly SearchIndexTextHit[];
      }
    | undefined,
): readonly SearchIndexObjectHit[] {
  const hits = new Map<string, SearchIndexObjectHit>();
  for (const hit of result?.objectHits ?? []) {
    hits.set(`${hit.archiveId}:${hit.ownerId}`, hit);
  }
  for (const hit of result?.textHits ?? []) {
    const key = `${hit.archiveId}:${hit.chapterId}`;
    const current = hits.get(key);
    if (current === undefined || hit.score > current.score) {
      hits.set(key, {
        archiveId: hit.archiveId,
        chapterId: hit.chapterId,
        ownerId: String(hit.chapterId),
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.title,
        score: hit.score,
      });
    }
  }
  return [...hits.values()];
}

async function readLibraryObjectBucketPage(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  after: SearchObjectCursorKey | undefined,
  limit: number,
  options: ArchiveFindOptions,
  types: readonly ArchiveFindFilterType[] | null,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  if (!session.objectCachesPopulated) {
    const input = await createLibraryObjectBucketCacheInput(
      target,
      session,
      options,
    );

    await populateSearchSessionObjectCaches({
      chunkHits: input.chunkHits,
      entityHits: input.entityHits,
      evidenceEvents: input.evidenceEvents,
      sessionId: session.sessionId,
      tripleHits: input.tripleHits,
    });
  }
  const page = await readSearchSessionObjectBucketPage(
    session.sessionId,
    1,
    after,
    limit,
    types,
  );
  const items = page
    .slice(0, limit)
    .filter((hit) => matchesLibraryTypes(hit, types));
  const hydrated = await hydrateLibraryCachedHits(
    target,
    items,
    async (document, hit) => await hydrateCachedObjectBucketHit(document, hit),
  );
  const last = page.at(Math.min(limit, page.length) - 1);

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
  options: ArchiveFindOptions,
  _types: readonly ArchiveFindFilterType[] | null,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  if (!session.objectCachesPopulated) {
    const input = await createLibraryObjectBucketCacheInput(
      target,
      session,
      options,
    );
    await populateSearchSessionObjectCaches({
      chunkHits: input.chunkHits,
      entityHits: input.entityHits,
      evidenceEvents: input.evidenceEvents,
      sessionId: session.sessionId,
      tripleHits: input.tripleHits,
    });
  }
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
  options: ArchiveFindOptions,
  types: readonly ArchiveFindFilterType[] | null,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  const textTypes = createLibraryTextTypes(types);
  const result = await queryWikiGraphLibrarySearchIndex(target, session.query, {
    ...(session.chapters === null ? {} : { chapters: session.chapters }),
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
    queryMode: session.queryMode,
    queryId: session.sessionId,
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
    types: textTypes,
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

function assertLibrarySearchCursorTypesMatch(
  requestedTypes: readonly string[] | undefined,
  sessionTypes: readonly string[] | null,
): void {
  if (requestedTypes === undefined) {
    return;
  }
  if (requestedTypes.length !== (sessionTypes?.length ?? 0)) {
    throw new Error("Search cursor does not match the requested result types.");
  }
  const sessionTypeSet = new Set(sessionTypes ?? []);

  if (requestedTypes.some((type) => !sessionTypeSet.has(type))) {
    throw new Error("Search cursor does not match the requested result types.");
  }
}

async function createLibraryObjectBucketCacheInput(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  options: ArchiveFindOptions,
): Promise<{
  readonly chunkHits: readonly SearchChunkHitInput[];
  readonly entityHits: readonly SearchEntityHitInput[];
  readonly evidenceEvents: readonly SearchEvidenceHitEventInput[];
  readonly tripleHits: readonly SearchTripleHitInput[];
}> {
  const usesEmbedding =
    session.queryMode === "embedding" ||
    (session.queryMode !== "fts" && options.embeddingProvider !== undefined);
  const result = await queryWikiGraphLibrarySearchIndex(target, session.query, {
    ...(session.chapters === null ? {} : { chapters: session.chapters }),
    match: session.match as ArchiveFindResult["match"],
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
    queryMode: session.queryMode,
    objectHitLimit: SEARCH_INDEX_FTS_HIT_LIMIT,
    textHitLimit: usesEmbedding ? SEARCH_INDEX_FTS_HIT_LIMIT : 0,
    types: null,
    queryId: session.sessionId,
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

  const sentenceInputs = await createLibrarySentenceEvidenceInputs(
    target,
    session,
    options,
    result,
  );
  return {
    chunkHits: [
      ...[...chunkScores].map(([key, propertyTopScores]) => {
        const { archiveId, objectId } = parseLibraryScopedObjectKey(key);
        return {
          archiveId,
          chunkId: Number(objectId),
          propertyTopScores,
        };
      }),
      ...sentenceInputs.chunkHits,
    ],
    entityHits: [
      ...[...entityScores].map(([key, propertyTopScores]) => {
        const { archiveId, objectId } = parseLibraryScopedObjectKey(key);
        return {
          archiveId,
          propertyTopScores,
          qid: objectId,
        };
      }),
      ...sentenceInputs.entityHits,
    ],
    evidenceEvents: sentenceInputs.evidenceEvents,
    tripleHits: sentenceInputs.tripleHits,
  };
}

async function createLibrarySentenceEvidenceInputs(
  target: ParsedWikiGraphLibraryUri,
  session: SearchSessionDescriptor,
  options: ArchiveFindOptions,
  result:
    | {
        readonly objectHits: readonly SearchIndexObjectHit[];
        readonly terms: readonly string[];
        readonly textHits: readonly SearchIndexTextHit[];
      }
    | undefined,
): Promise<{
  readonly chunkHits: readonly SearchChunkHitInput[];
  readonly entityHits: readonly SearchEntityHitInput[];
  readonly evidenceEvents: readonly SearchEvidenceHitEventInput[];
  readonly tripleHits: readonly SearchTripleHitInput[];
}> {
  const combined = {
    chunkHits: [] as SearchChunkHitInput[],
    entityHits: [] as SearchEntityHitInput[],
    evidenceEvents: [] as SearchEvidenceHitEventInput[],
    tripleHits: [] as SearchTripleHitInput[],
  };
  if (result === undefined) return combined;

  for (const archiveId of createSortedArchiveIds(result)) {
    const archive = await resolveReadableIndexedArchive(target, archiveId, {
      operation: "searching library objects",
    });
    const input = await readLibraryArchiveDocument(
      archive,
      async (document) =>
        await createSentenceEvidenceSearchCacheInput(
          document,
          {
            objectHits: [],
            terms: result.terms,
            textHits: result.textHits.filter(
              (hit) => hit.archiveId === archiveId,
            ),
          },
          {
            ...options,
            ...(session.chapters === null
              ? {}
              : { chapters: session.chapters }),
            ...(session.types === null
              ? {}
              : { types: session.types as ArchiveFindFilterType[] }),
          },
        ),
    );
    combined.chunkHits.push(...input.chunkHits);
    combined.entityHits.push(...input.entityHits);
    combined.evidenceEvents.push(...input.evidenceEvents);
    combined.tripleHits.push(...input.tripleHits);
  }
  return combined;
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

function shouldReadLibraryBucket(
  selectedTypes: readonly ArchiveFindFilterType[] | null,
  ...types: ArchiveFindFilterType[]
): boolean {
  return (
    selectedTypes === null || types.some((type) => selectedTypes.includes(type))
  );
}

function matchesLibraryTypes(
  hit: ArchiveFindHit,
  types: readonly ArchiveFindFilterType[] | null,
): boolean {
  return (
    types === null ||
    (hit.type === "entity" && types.includes("entity")) ||
    (hit.type === "triple" && types.includes("triple"))
  );
}

function createLibraryTextTypes(
  types: readonly ArchiveFindFilterType[] | null,
): readonly ("source" | "summary")[] {
  if (types === null) {
    return ["source", "summary"];
  }

  return types.filter(
    (type): type is "source" | "summary" =>
      type === "source" || type === "summary",
  );
}

function normalizeIndependentBucketCursor(
  types: readonly ArchiveFindFilterType[] | null,
  cursor: BucketSearchCursor | undefined,
): BucketSearchCursor | undefined {
  if (cursor === undefined || types === null) return cursor;
  if (
    (cursor.bucket === 0 &&
      shouldReadLibraryBucket(
        types,
        "archive",
        "archive-title",
        "chapter",
        "chapter-title",
      )) ||
    (cursor.bucket === 1 &&
      shouldReadLibraryBucket(types, "entity", "triple")) ||
    (cursor.bucket === 2 && shouldReadLibraryBucket(types, "node")) ||
    (cursor.bucket === 3 && shouldReadLibraryBucket(types, "source", "summary"))
  ) {
    return cursor;
  }
  if (cursor.bucket === 3) return undefined;
  return normalizeIndependentBucketCursor(types, {
    bucket: (cursor.bucket + 1) as 1 | 2 | 3,
  });
}

async function assertLibrarySearchReady(
  target: ParsedWikiGraphLibraryUri,
  options: Pick<
    ArchiveFindOptions,
    "embeddingProvider" | "queryMode" | "skipUnindexed"
  >,
): Promise<void> {
  const coverage = {
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
    ...(options.queryMode === undefined
      ? {}
      : { queryMode: options.queryMode }),
  };
  if (options.skipUnindexed !== true) {
    await assertWikiGraphLibraryQueryArtifactsReady(target, coverage);
  } else if (Object.keys(coverage).length === 0) {
    await assertWikiGraphLibraryHasQueryableArtifacts(target);
  } else {
    await assertWikiGraphLibraryHasQueryableArtifacts(target, coverage);
  }
}

function assertLibrarySearchBucketDefinitions(
  buckets: readonly WikiGraphLibrarySearchBucketDefinition[],
): void {
  const ids = new Set<string>();
  for (const bucket of buckets) {
    if (bucket.id === "") throw new Error("Search bucket id cannot be empty.");
    if (ids.has(bucket.id)) {
      throw new Error(`Duplicate search bucket id: ${bucket.id}`);
    }
    if (bucket.types.length === 0) {
      throw new Error(`Search bucket ${bucket.id} must include result types.`);
    }
    ids.add(bucket.id);
  }
}

function assertIndependentBucketTypes(
  types: readonly ArchiveFindFilterType[],
  sessionTypes: readonly string[] | null,
): void {
  if (
    sessionTypes === null ||
    types.length === 0 ||
    types.some((type) => !sessionTypes.includes(type))
  ) {
    throw new Error("Search bucket cursor does not match its search session.");
  }
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

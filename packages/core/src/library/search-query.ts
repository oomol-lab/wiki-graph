import type { ReadonlyDocument } from "../document/index.js";
import {
  BROAD_FIND_LENS_HINT,
  DEFAULT_FIND_LIMIT,
} from "../retrieval/query/archive-view/helper/constants.js";
import { createFindResult } from "../retrieval/query/archive-view/helper/results.js";
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
  type SearchChunkHitInput,
  type SearchChunkCursorKey,
  type SearchEntityHitInput,
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
  ArchiveFindFilterType,
  ArchiveFindHit,
  ArchiveFindOptions,
  ArchiveFindResult,
} from "../retrieval/query/archive-view/types.js";
import type { ParsedWikiGraphLibraryUri } from "./registry.js";
import {
  assertWikiGraphLibraryIndexReady,
  queryWikiGraphLibrarySearchIndex,
} from "./search-index.js";
import {
  createLibrarySource,
  createSortedArchiveIds,
  readLibraryArchiveDocument,
  resolveReadableIndexedArchive,
} from "./query-helpers.js";

export function shouldUseLibraryBucketedSearch(
  options: ArchiveFindOptions,
): boolean {
  return options.triplePattern === undefined;
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
    return await readLibraryBucketedSearchResultPage(target, cursor, {
      ...options,
      limit,
    });
  }

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
    revisionScope: state.sourceFingerprint,
    terms: search.terms,
    types,
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

  assertLibrarySearchCursorTypesMatch(options.types, session.types);

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
    order: options.order ?? "doc-asc",
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
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  switch (cursor.bucket) {
    case 0:
      return shouldReadLibraryBucket(session, "chapter-title")
        ? await readLibraryChapterTitleBucketPage(
            target,
            session,
            cursor.key,
            limit,
          )
        : { items: [], nextCursor: { bucket: 1 } };
    case 1:
      return shouldReadLibraryBucket(session, "entity", "triple")
        ? await readLibraryObjectBucketPage(target, session, cursor.key, limit)
        : { items: [], nextCursor: { bucket: 2 } };
    case 2:
      return shouldReadLibraryBucket(session, "node")
        ? await readLibraryChunkBucketPage(target, session, cursor.key, limit)
        : { items: [], nextCursor: { bucket: 3 } };
    case 3:
      return shouldReadLibraryBucket(session, "source", "summary")
        ? await readLibraryTextBucketPage(target, session, cursor.key, limit)
        : { items: [], nextCursor: undefined };
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
    ...(session.chapters === null ? {} : { chapters: session.chapters }),
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
    const input = await createLibraryObjectBucketCacheInput(target, session);

    await populateSearchSessionObjectCaches({
      chunkHits: input.chunkHits,
      entityHits: input.entityHits,
      sessionId: session.sessionId,
    });
  }
  const page = await readSearchSessionObjectBucketPage(
    session.sessionId,
    1,
    after,
    limit,
  );
  const items = page
    .slice(0, limit)
    .filter((hit) => matchesLibrarySessionTypes(hit, session));
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
  const types = createLibraryTextTypes(session);
  const result = await queryWikiGraphLibrarySearchIndex(target, session.query, {
    ...(session.chapters === null ? {} : { chapters: session.chapters }),
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
    types,
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
): Promise<{
  readonly chunkHits: readonly SearchChunkHitInput[];
  readonly entityHits: readonly SearchEntityHitInput[];
}> {
  const result = await queryWikiGraphLibrarySearchIndex(target, session.query, {
    ...(session.chapters === null ? {} : { chapters: session.chapters }),
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

  return {
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
  };
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
  session: SearchSessionDescriptor,
  ...types: ArchiveFindFilterType[]
): boolean {
  return (
    session.types === null ||
    types.some((type) => session.types?.includes(type))
  );
}

function matchesLibrarySessionTypes(
  hit: ArchiveFindHit,
  session: SearchSessionDescriptor,
): boolean {
  return (
    session.types === null ||
    (hit.type === "entity" && session.types.includes("entity")) ||
    (hit.type === "triple" && session.types.includes("triple"))
  );
}

function createLibraryTextTypes(
  session: SearchSessionDescriptor,
): readonly ("source" | "summary")[] {
  if (session.types === null) {
    return ["source", "summary"];
  }

  return session.types.filter(
    (type): type is "source" | "summary" =>
      type === "source" || type === "summary",
  );
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

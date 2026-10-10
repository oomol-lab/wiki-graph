import { getNumber, type Database } from "../../../document/database.js";
import type { ReadonlyDocument } from "../../../document/index.js";
import type {
  ArchiveFindMatch,
  ArchiveFindObjectType,
} from "../../query/view.js";
import {
  createSearchTokenPlan,
  hasSearchTokens,
  listSearchPlanTerms,
  type SearchTokenPlan,
} from "./tokenizer.js";
import { createTierQueries } from "./match.js";
import {
  createChapterParams,
  createChapterSql,
  createObjectTypeParams,
  createObjectTypeSql,
  createTextKindFilter,
  shouldQueryObjects,
} from "./helpers.js";
import type {
  SearchIndexEmbeddingProvider,
  SearchIndexQueryMode,
  SearchIndexObjectHit,
  SearchIndexQueryResult,
  SearchIndexTextHit,
  SearchObjectPropertyKind,
  SearchObjectPropertyOwnerKind,
  TextSentenceKind,
} from "./types.js";
import {
  SEARCH_INDEX_DENSE_EXPANDED_SENTENCE_LIMIT,
  SEARCH_INDEX_DENSE_SEGMENT_HIT_LIMIT,
  SEARCH_INDEX_FTS_HIT_LIMIT,
  TEXT_SENTENCE_KIND,
  TIER_WEIGHTS,
} from "./types.js";
import { assertSearchIndexNotDirty } from "./status.js";
import { deserializeFloat32Vector } from "./write.js";
import {
  claimCachedQuery,
  clearCachedQueryHits,
  completeCachedQuery,
  countCachedFtsHits,
  createTransientQueryId,
  decodeCachedChapterId,
  finalizeCachedTextHitScores,
  insertCachedDenseSegmentHit,
  insertCachedFtsTextHit,
  insertCachedObjectHit,
  listCachedDenseSegmentHits,
  normalizeCachedFtsHits,
  openSearchQueryCacheDatabase,
  pruneAndNormalizeCachedDenseSegmentHits,
  pruneCachedFtsHits,
  upsertCachedEmbeddingTextHit,
} from "./query-cache.js";

const QUERY_BATCH_SIZE = 512;
const QUERY_CACHE_WAIT_MS = 20;

export async function querySearchIndex(
  document: ReadonlyDocument,
  query: string,
  options: {
    readonly chapters?: readonly number[];
    readonly embeddingProvider?: SearchIndexEmbeddingProvider;
    readonly match?: ArchiveFindMatch;
    readonly queryId?: string;
    readonly queryMode?: SearchIndexQueryMode;
    readonly objectHitLimit?: number;
    readonly textAfter?: {
      readonly archiveId: number;
      readonly chapterId: number;
      readonly kind: TextSentenceKind;
      readonly rank: number;
      readonly sentenceIndex: number;
    };
    readonly textHitLimit?: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  } = {},
): Promise<SearchIndexQueryResult | undefined> {
  const plan = createSearchTokenPlan(query);
  const terms = listSearchPlanTerms(plan);

  return await document.readSearchIndexDatabase(async (database) => {
    await assertSearchIndexNotDirty(database);
    const indexState = await readSearchIndexQueryState(database);
    const hasDenseSegments =
      (indexState.indexes === "dense" || indexState.indexes === "fts,dense") &&
      (await hasTable(database, "text_embedding_segments"));
    const hasFts =
      indexState.indexes === "fts" || indexState.indexes === "fts,dense";
    const hasDense = hasDenseSegments;
    const queryMode = options.queryMode ?? "hybrid";
    if (queryMode === "fts" && !hasFts) {
      throw new Error("FTS query mode requires a current FTS search index.");
    }
    if (queryMode === "embedding" && !hasDense) {
      throw new Error(
        "Embedding query mode requires a current Dense search index.",
      );
    }
    const usesFts =
      queryMode !== "embedding" && hasFts && hasSearchTokens(plan);
    const persistent = options.queryId !== undefined;
    const cachedTypes = persistent ? null : options.types;
    const usesDense =
      queryMode !== "fts" &&
      hasDense &&
      options.textHitLimit !== 0 &&
      createDenseTextKindFilter(cachedTypes).length > 0;

    if (!usesFts && !usesDense) {
      return undefined;
    }

    const cache = await openSearchQueryCacheDatabase();
    const queryId = options.queryId ?? createTransientQueryId();
    const queryOwnerId = createTransientQueryId();

    try {
      while (true) {
        const claim = await claimCachedQuery(cache, queryId, queryOwnerId);
        if (claim === "complete") break;
        if (claim === "pending") {
          await waitForQueryCache();
          continue;
        }

        try {
          if (usesFts) {
            await populateCachedFtsHits(database, cache, queryId, query, plan, {
              ...(options.chapters === undefined
                ? {}
                : { chapters: options.chapters }),
              match: options.match ?? "any",
              ...(cachedTypes === undefined ? {} : { types: cachedTypes }),
            });
          }
          await normalizeCachedFtsHits(cache, queryId);

          if (usesDense) {
            await populateCachedDenseHits(
              database,
              cache,
              queryId,
              query,
              indexState,
              {
                ...(options.chapters === undefined
                  ? {}
                  : { chapters: options.chapters }),
                ...(options.embeddingProvider === undefined
                  ? {}
                  : { embeddingProvider: options.embeddingProvider }),
                queryMode,
                ...(cachedTypes === undefined ? {} : { types: cachedTypes }),
              },
            );
          }
          await finalizeCachedTextHitScores(cache, queryId);
          await completeCachedQuery(cache, queryId);
        } catch (error) {
          await clearCachedQueryHits(cache, queryId);
          throw error;
        }
        break;
      }

      return {
        objectHits: await readCachedObjectHits(cache, queryId, options),
        terms,
        textHits: await readCachedTextHits(cache, queryId, options, usesDense),
      };
    } finally {
      if (!persistent) await clearCachedQueryHits(cache, queryId);
      await cache.close();
    }
  });
}

async function waitForQueryCache(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, QUERY_CACHE_WAIT_MS);
  });
}

async function populateCachedFtsHits(
  database: Database,
  cache: Database,
  queryId: string,
  query: string,
  plan: SearchTokenPlan,
  options: {
    readonly chapters?: readonly number[];
    readonly match: ArchiveFindMatch;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<void> {
  const tierQueries = createTierQueries(query, plan, options.match);

  for (const [matchTier, tierQuery] of tierQueries.entries()) {
    if (tierQuery.matchExpression === "") continue;
    const counts = await countCachedFtsHits(cache, queryId);
    const objectRowLimit = Math.max(
      0,
      SEARCH_INDEX_FTS_HIT_LIMIT - counts.objectHits,
    );
    const textRowLimit = Math.max(
      0,
      SEARCH_INDEX_FTS_HIT_LIMIT - counts.textHits,
    );

    for (let offset = 0; offset < objectRowLimit; ) {
      const rows = await queryObjectRows(database, tierQuery.matchExpression, {
        ...options,
        limit: Math.min(QUERY_BATCH_SIZE, objectRowLimit - offset),
        offset,
      });
      if (rows.length === 0) break;

      await cache.transaction(async () => {
        for (const row of rows) {
          await insertCachedObjectHit(cache, queryId, matchTier, row);
        }
      });
      offset += rows.length;
      if (rows.length < QUERY_BATCH_SIZE) break;
    }

    for (let offset = 0; offset < textRowLimit; ) {
      const rows = await queryTextRows(database, tierQuery.matchExpression, {
        ...options,
        limit: Math.min(QUERY_BATCH_SIZE, textRowLimit - offset),
        offset,
      });
      if (rows.length === 0) break;

      await cache.transaction(async () => {
        for (const row of rows) {
          await insertCachedFtsTextHit(cache, queryId, matchTier, row);
        }
      });
      offset += rows.length;
      if (rows.length < QUERY_BATCH_SIZE) break;
    }

    await pruneCachedFtsHits(cache, queryId, SEARCH_INDEX_FTS_HIT_LIMIT);
  }
}

async function readCachedObjectHits(
  cache: Database,
  queryId: string,
  options: {
    readonly objectHitLimit?: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<readonly SearchIndexObjectHit[]> {
  if (!shouldQueryObjects(options.types) || options.objectHitLimit === 0) {
    return [];
  }

  return await cache.queryAll(
    `
      SELECT archive_id, owner_kind, owner_id, property_kind, chapter_id, score
      FROM query_object_hits AS r
      WHERE query_id = ? AND score IS NOT NULL
        ${createObjectTypeSql(options.types)}
      ORDER BY score DESC, archive_id, owner_kind, owner_id, property_kind
      LIMIT ?
    `,
    [
      queryId,
      ...createObjectTypeParams(options.types),
      options.objectHitLimit ?? SEARCH_INDEX_FTS_HIT_LIMIT,
    ],
    (row) => {
      const chapterId = decodeCachedChapterId(getNumber(row, "chapter_id"));

      return {
        archiveId: getNumber(row, "archive_id"),
        ...(chapterId === undefined ? {} : { chapterId }),
        ownerId: String(row.owner_id),
        ownerKind: getNumber(
          row,
          "owner_kind",
        ) as SearchObjectPropertyOwnerKind,
        propertyKind: getNumber(
          row,
          "property_kind",
        ) as SearchObjectPropertyKind,
        score: getNumber(row, "score"),
      };
    },
  );
}

async function readCachedTextHits(
  cache: Database,
  queryId: string,
  options: {
    readonly textAfter?: {
      readonly rank: number;
    };
    readonly textHitLimit?: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
  includesDenseEvidence: boolean,
): Promise<readonly SearchIndexTextHit[]> {
  const kinds = includesDenseEvidence
    ? createDenseTextKindFilter(options.types)
    : createTextKindFilter(options.types);
  if (kinds.length === 0 || options.textHitLimit === 0) return [];

  return await cache.queryAll(
    `
      SELECT archive_id, kind, chapter_id, sentence_index,
             words_count, rank, score
      FROM query_text_hits
      WHERE query_id = ? AND rank IS NOT NULL
        AND kind IN (${kinds.map(() => "?").join(", ")})
        ${options.textAfter === undefined ? "" : "AND rank > ?"}
      ORDER BY rank
      LIMIT ?
    `,
    [
      queryId,
      ...kinds,
      ...(options.textAfter === undefined ? [] : [options.textAfter.rank]),
      options.textHitLimit ?? SEARCH_INDEX_FTS_HIT_LIMIT,
    ],
    (row) => ({
      archiveId: getNumber(row, "archive_id"),
      chapterId: getNumber(row, "chapter_id"),
      kind: getNumber(row, "kind") as TextSentenceKind,
      rank: getNumber(row, "rank"),
      score: getNumber(row, "score"),
      sentenceIndex: getNumber(row, "sentence_index"),
      wordsCount: getNumber(row, "words_count"),
    }),
  );
}

interface SearchIndexQueryState {
  readonly denseDimensions?: number;
  readonly embeddingIdentity?: string;
  readonly embeddingModel?: string;
  readonly indexes: "dense" | "fts" | "fts,dense";
}

async function readSearchIndexQueryState(
  database: Database,
): Promise<SearchIndexQueryState> {
  const indexes = await database.queryOne(
    `
      SELECT value
      FROM search_index_state
      WHERE key = 'indexes'
    `,
    undefined,
    (row) => String(row.value),
  );
  const dimensionsValue = await database.queryOne(
    `
      SELECT value
      FROM search_index_state
      WHERE key = 'embeddingDimensions'
    `,
    undefined,
    (row) => Number(row.value),
  );
  const embeddingModel = await database.queryOne(
    `
      SELECT value
      FROM search_index_state
      WHERE key = 'embeddingModel'
    `,
    undefined,
    (row) => String(row.value),
  );
  const embeddingIdentity = await database.queryOne(
    `
      SELECT value
      FROM search_index_state
      WHERE key = 'embeddingIdentity'
    `,
    undefined,
    (row) => String(row.value),
  );
  const denseDimensions =
    dimensionsValue === undefined ? undefined : Number(dimensionsValue);

  const state: SearchIndexQueryState = {
    ...(embeddingIdentity === undefined || embeddingIdentity === ""
      ? {}
      : { embeddingIdentity }),
    ...(embeddingModel === undefined || embeddingModel === ""
      ? {}
      : { embeddingModel }),
    indexes: indexes === "dense" || indexes === "fts,dense" ? indexes : "fts",
  };

  if (
    denseDimensions !== undefined &&
    Number.isInteger(denseDimensions) &&
    denseDimensions > 0
  ) {
    return { ...state, denseDimensions };
  }

  return state;
}

async function hasTable(database: Database, table: string): Promise<boolean> {
  const row = await database.queryOne(
    `
      SELECT 1 AS found
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `,
    [table],
    (value) => getNumber(value, "found"),
  );

  return row === 1;
}

async function populateCachedDenseHits(
  database: Database,
  cache: Database,
  queryId: string,
  query: string,
  state: SearchIndexQueryState,
  options: {
    readonly chapters?: readonly number[];
    readonly embeddingProvider?: SearchIndexEmbeddingProvider;
    readonly queryMode?: SearchIndexQueryMode;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<void> {
  const requiresDense =
    options.queryMode === "embedding" || state.indexes === "dense";
  if (options.embeddingProvider === undefined) {
    if (requiresDense) {
      throw new Error(
        "Dense search requires embeddings configuration. Configure `wikg://local/config/embeddings` before querying a Dense-only index.",
      );
    }
    return;
  }

  if (
    state.embeddingModel !== undefined &&
    options.embeddingProvider.model !== state.embeddingModel
  ) {
    const message = `Dense query embedding model is ${options.embeddingProvider.model}; index expects ${state.embeddingModel}.`;

    if (requiresDense) {
      throw new Error(message);
    }
    return;
  }
  if (
    state.embeddingIdentity !== undefined &&
    options.embeddingProvider.identity !== undefined &&
    options.embeddingProvider.identity !== state.embeddingIdentity
  ) {
    const message = "Dense query embedding identity does not match the index.";

    if (requiresDense) {
      throw new Error(message);
    }
    return;
  }

  let queryVector: readonly number[];
  try {
    const result = await options.embeddingProvider.embedTexts([query]);

    queryVector = result.embeddings[0] ?? [];
  } catch (error) {
    if (requiresDense) {
      throw error;
    }
    return;
  }

  if (
    state.denseDimensions !== undefined &&
    queryVector.length !== state.denseDimensions
  ) {
    const message = `Dense query embedding has ${queryVector.length} dimensions; index expects ${state.denseDimensions}.`;

    if (requiresDense) {
      throw new Error(message);
    }
    return;
  }

  await populateCachedDenseSegmentHits(database, cache, queryId, queryVector, {
    ...(options.chapters === undefined ? {} : { chapters: options.chapters }),
    ...(options.types === undefined ? {} : { types: options.types }),
  });
  await pruneAndNormalizeCachedDenseSegmentHits(
    cache,
    queryId,
    SEARCH_INDEX_DENSE_SEGMENT_HIT_LIMIT,
  );
  await expandCachedDenseSegmentHits(database, cache, queryId);
}

async function populateCachedDenseSegmentHits(
  database: Database,
  cache: Database,
  queryId: string,
  queryVector: readonly number[],
  options: {
    readonly chapters?: readonly number[];
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<void> {
  const kinds = createDenseTextKindFilter(options.types);

  if (kinds.length === 0 || queryVector.length === 0) {
    return;
  }

  let afterId = 0;
  while (true) {
    const rows = await database.queryAll(
      `
        SELECT
          id,
          archive_id,
          kind,
          chapter_id,
          start_sentence_index,
          end_sentence_index,
          vector
        FROM text_embedding_segments
        WHERE id > ?
          AND kind IN (${kinds.map(() => "?").join(", ")})
          ${createChapterSql(options.chapters, "")}
        ORDER BY id
        LIMIT ?
      `,
      [
        afterId,
        ...kinds,
        ...createChapterParams(options.chapters),
        QUERY_BATCH_SIZE,
      ],
      (row) => ({
        archiveId: getNumber(row, "archive_id"),
        chapterId: getNumber(row, "chapter_id"),
        endSentenceIndex: getNumber(row, "end_sentence_index"),
        id: getNumber(row, "id"),
        kind: getNumber(row, "kind") as TextSentenceKind,
        rawScore: cosineSimilarity(
          queryVector,
          row.vector instanceof Uint8Array
            ? deserializeFloat32Vector(row.vector)
            : [],
        ),
        startSentenceIndex: getNumber(row, "start_sentence_index"),
      }),
    );
    if (rows.length === 0) break;

    await cache.transaction(async () => {
      for (const row of rows) {
        await insertCachedDenseSegmentHit(cache, queryId, row);
      }
    });
    afterId = rows.at(-1)!.id;
    if (rows.length < QUERY_BATCH_SIZE) break;
    await pruneAndNormalizeCachedDenseSegmentHits(
      cache,
      queryId,
      SEARCH_INDEX_DENSE_SEGMENT_HIT_LIMIT,
    );
  }
}

async function expandCachedDenseSegmentHits(
  database: Database,
  cache: Database,
  queryId: string,
): Promise<void> {
  for (const segment of await listCachedDenseSegmentHits(cache, queryId)) {
    const rows = await database.queryAll(
      `
        SELECT
          archive_id,
          kind,
          chapter_id,
          sentence_index,
          words_count
        FROM text_sentence_records
        WHERE archive_id = ?
          AND kind = ?
          AND chapter_id = ?
          AND sentence_index >= ?
          AND sentence_index <= ?
        ORDER BY sentence_index ASC
      `,
      [
        segment.archiveId,
        segment.kind,
        segment.chapterId,
        segment.startSentenceIndex,
        segment.endSentenceIndex,
      ],
      (row) => ({
        archiveId: getNumber(row, "archive_id"),
        chapterId: getNumber(row, "chapter_id"),
        kind: getNumber(row, "kind") as TextSentenceKind,
        score: segment.score,
        sentenceIndex: getNumber(row, "sentence_index"),
        wordsCount: getNumber(row, "words_count"),
      }),
    );

    await cache.transaction(async () => {
      for (const row of rows) {
        await upsertCachedEmbeddingTextHit(cache, queryId, row);
      }
    });
    const expandedCount = await cache.queryOne(
      `
        SELECT COUNT(*) AS count
        FROM query_text_hits
        WHERE query_id = ? AND embedding_score IS NOT NULL
      `,
      [queryId],
      (row) => getNumber(row, "count"),
    );
    if ((expandedCount ?? 0) >= SEARCH_INDEX_DENSE_EXPANDED_SENTENCE_LIMIT) {
      break;
    }
  }
}

function createDenseTextKindFilter(
  types: readonly ArchiveFindObjectType[] | null | undefined,
): readonly TextSentenceKind[] {
  const direct = createTextKindFilter(types);
  if (types === undefined || types === null) return direct;
  const needsSourceEvidence = types.some(
    (type) =>
      type === "chapter" ||
      type === "chapter-title" ||
      type === "entity" ||
      type === "node" ||
      type === "triple",
  );
  return needsSourceEvidence
    ? [...new Set([...direct, TEXT_SENTENCE_KIND.source])]
    : direct;
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const [index, leftValue] of left.entries()) {
    const rightValue = right[index] ?? 0;

    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

async function queryObjectRows(
  database: Database,
  matchExpression: string,
  options: {
    readonly chapters?: readonly number[];
    readonly limit: number;
    readonly offset: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<
  readonly (Omit<SearchIndexObjectHit, "score"> & {
    readonly rawScore: number;
  })[]
> {
  if (!shouldQueryObjects(options.types)) {
    return [];
  }

  return await database.queryAll(
    `
      SELECT
        r.owner_kind AS owner_kind,
        r.owner_id AS owner_id,
        r.property_kind AS property_kind,
        r.archive_id AS archive_id,
        r.chapter_id AS chapter_id,
        bm25(search_object_properties_fts, ?, ?, ?) AS raw_score
      FROM search_object_properties_fts
      JOIN search_object_properties_records AS r
        ON r.id = search_object_properties_fts.rowid
      WHERE search_object_properties_fts MATCH ?
        ${createChapterSql(options.chapters)}
        ${createObjectTypeSql(options.types)}
      ORDER BY raw_score ASC, r.archive_id, r.chapter_id,
               r.owner_kind, r.owner_id, r.property_kind
      LIMIT ? OFFSET ?
    `,
    [
      ...TIER_WEIGHTS,
      matchExpression,
      ...createChapterParams(options.chapters),
      ...createObjectTypeParams(options.types),
      options.limit,
      options.offset,
    ],
    (row) => ({
      ownerId: String(row.owner_id),
      archiveId: getNumber(row, "archive_id"),
      ownerKind: getNumber(row, "owner_kind") as SearchObjectPropertyOwnerKind,
      propertyKind: getNumber(row, "property_kind") as SearchObjectPropertyKind,
      rawScore: getNumber(row, "raw_score"),
      ...(row.chapter_id === null
        ? {}
        : { chapterId: getNumber(row, "chapter_id") }),
    }),
  );
}

async function queryTextRows(
  database: Database,
  matchExpression: string,
  options: {
    readonly chapters?: readonly number[];
    readonly limit: number;
    readonly offset: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<
  readonly (Omit<SearchIndexTextHit, "rank" | "score"> & {
    readonly rawScore: number;
  })[]
> {
  const kinds = createTextKindFilter(options.types);

  if (kinds.length === 0) {
    return [];
  }
  return await database.queryAll(
    `
      SELECT
        r.kind AS kind,
        r.archive_id AS archive_id,
        r.chapter_id AS chapter_id,
        r.sentence_index AS sentence_index,
        r.words_count AS words_count,
        bm25(text_sentence_fts, ?, ?, ?) AS raw_score
      FROM text_sentence_fts
      JOIN text_sentence_records AS r
        ON r.id = text_sentence_fts.rowid
      WHERE text_sentence_fts MATCH ?
        AND r.kind IN (${kinds.map(() => "?").join(", ")})
        ${createChapterSql(options.chapters)}
      ORDER BY raw_score ASC, r.archive_id, r.chapter_id,
               r.sentence_index, r.kind
      LIMIT ? OFFSET ?
    `,
    [
      ...TIER_WEIGHTS,
      matchExpression,
      ...kinds,
      ...createChapterParams(options.chapters),
      options.limit,
      options.offset,
    ],
    (row) => {
      return {
        chapterId: getNumber(row, "chapter_id"),
        archiveId: getNumber(row, "archive_id"),
        kind: getNumber(row, "kind") as TextSentenceKind,
        rawScore: getNumber(row, "raw_score"),
        sentenceIndex: getNumber(row, "sentence_index"),
        wordsCount: getNumber(row, "words_count"),
      };
    },
  );
}

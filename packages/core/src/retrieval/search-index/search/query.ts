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
} from "./tokenizer.js";
import { createTierQueries } from "./match.js";
import {
  createChapterParams,
  createChapterSql,
  createLimitParams,
  createLimitSql,
  createObjectHitKey,
  createObjectTypeParams,
  createObjectTypeSql,
  createTextHitKey,
  createTextKindFilter,
  rankToScore,
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

export async function querySearchIndex(
  document: ReadonlyDocument,
  query: string,
  options: {
    readonly chapters?: readonly number[];
    readonly embeddingProvider?: SearchIndexEmbeddingProvider;
    readonly match?: ArchiveFindMatch;
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
    const usesDense =
      queryMode !== "fts" &&
      hasDense &&
      options.textHitLimit !== 0 &&
      createDenseTextKindFilter(options.types).length > 0;

    if (!usesFts && !usesDense) {
      return undefined;
    }

    const tierQueries = createTierQueries(query, plan, options.match ?? "any");
    const objectHitLimit = options.objectHitLimit ?? SEARCH_INDEX_FTS_HIT_LIMIT;
    const textHitLimit = options.textHitLimit ?? SEARCH_INDEX_FTS_HIT_LIMIT;
    const queriesObjects = shouldQueryObjects(options.types);
    const queriesText = createTextKindFilter(options.types).length > 0;
    const objectHitsByKey = new Map<string, SearchIndexObjectHit>();
    const textHitsByKey = new Map<string, SearchIndexTextHit>();
    const ftsTextHitsByKey = new Map<string, SearchIndexTextHit>();

    if (usesFts) {
      for (const tierQuery of tierQueries) {
        if (tierQuery.matchExpression === "") {
          continue;
        }

        const objectHitRemaining = Math.max(
          0,
          objectHitLimit - objectHitsByKey.size,
        );
        const textHitRemaining = Math.max(
          0,
          textHitLimit - ftsTextHitsByKey.size,
        );

        if (
          (!queriesObjects || objectHitRemaining <= 0) &&
          (!queriesText || textHitRemaining <= 0)
        ) {
          break;
        }

        const textRowOptions = {
          ...options,
          textHitLimit: hasDense
            ? SEARCH_INDEX_FTS_HIT_LIMIT
            : textHitRemaining,
          // FTS owns keyset pagination in FTS-only mode.  A dense index may
          // exist in the cache without being used by this query; only a
          // hybrid query must defer the cursor until after RRF fusion.
          ...(usesDense || options.textAfter === undefined
            ? {}
            : { textAfter: options.textAfter }),
        };

        const [objectRows, textRows] = await Promise.all([
          queryObjectRows(database, tierQuery.matchExpression, {
            ...options,
            objectHitLimit: objectHitRemaining,
          }),
          queryTextRows(database, tierQuery.matchExpression, textRowOptions),
        ]);

        for (const hit of objectRows) {
          const key = createObjectHitKey(hit);

          if (!objectHitsByKey.has(key)) {
            objectHitsByKey.set(key, hit);
          }
        }
        for (const hit of textRows) {
          const key = createTextHitKey(hit);

          if (!ftsTextHitsByKey.has(key)) {
            ftsTextHitsByKey.set(key, hit);
          }
        }
        if (
          (!queriesObjects || objectHitsByKey.size >= objectHitLimit) &&
          (!queriesText || ftsTextHitsByKey.size >= textHitLimit)
        ) {
          break;
        }
      }
    }

    const ftsTextHits = [...ftsTextHitsByKey.values()];
    const denseTextHits = usesDense
      ? await queryDenseTextRows(database, query, indexState, options)
      : [];
    const textHits =
      ftsTextHits.length > 0 && denseTextHits.length > 0
        ? fuseTextHitsByRrf(ftsTextHits, denseTextHits)
        : denseTextHits.length > 0
          ? denseTextHits
          : ftsTextHits;

    for (const hit of applyTextAfter(textHits, options.textAfter).slice(
      0,
      textHitLimit,
    )) {
      const key = createTextHitKey(hit);

      if (!textHitsByKey.has(key)) {
        textHitsByKey.set(key, hit);
      }
    }

    return {
      objectHits: [...objectHitsByKey.values()],
      terms,
      textHits: [...textHitsByKey.values()],
    };
  });
}

interface SearchIndexQueryState {
  readonly denseDimensions?: number;
  readonly embeddingIdentity?: string;
  readonly embeddingModel?: string;
  readonly indexes: "dense" | "fts" | "fts,dense";
}

interface DenseSegmentHit {
  readonly archiveId: number;
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly kind: TextSentenceKind;
  readonly score: number;
  readonly startSentenceIndex: number;
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

async function queryDenseTextRows(
  database: Database,
  query: string,
  state: SearchIndexQueryState,
  options: {
    readonly chapters?: readonly number[];
    readonly embeddingProvider?: SearchIndexEmbeddingProvider;
    readonly queryMode?: SearchIndexQueryMode;
    readonly textHitLimit?: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<readonly SearchIndexTextHit[]> {
  const requiresDense =
    options.queryMode === "embedding" || state.indexes === "dense";
  if (options.embeddingProvider === undefined) {
    if (requiresDense) {
      throw new Error(
        "Dense search requires embeddings configuration. Configure `wikg://local/config/embeddings` before querying a Dense-only index.",
      );
    }
    return [];
  }

  if (
    state.embeddingModel !== undefined &&
    options.embeddingProvider.model !== state.embeddingModel
  ) {
    const message = `Dense query embedding model is ${options.embeddingProvider.model}; index expects ${state.embeddingModel}.`;

    if (requiresDense) {
      throw new Error(message);
    }
    return [];
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
    return [];
  }

  let queryVector: readonly number[];
  try {
    const result = await options.embeddingProvider.embedTexts([query]);

    queryVector = result.embeddings[0] ?? [];
  } catch (error) {
    if (requiresDense) {
      throw error;
    }
    return [];
  }

  if (
    state.denseDimensions !== undefined &&
    queryVector.length !== state.denseDimensions
  ) {
    const message = `Dense query embedding has ${queryVector.length} dimensions; index expects ${state.denseDimensions}.`;

    if (requiresDense) {
      throw new Error(message);
    }
    return [];
  }

  const segmentHits = await queryDenseSegmentHits(database, queryVector, {
    ...(options.chapters === undefined ? {} : { chapters: options.chapters }),
    limit: SEARCH_INDEX_DENSE_SEGMENT_HIT_LIMIT,
    ...(options.types === undefined ? {} : { types: options.types }),
  });

  if (segmentHits.length === 0) {
    return [];
  }

  return expandDenseSegmentHits(database, segmentHits, {
    limit: Math.max(
      options.textHitLimit ?? SEARCH_INDEX_FTS_HIT_LIMIT,
      SEARCH_INDEX_DENSE_EXPANDED_SENTENCE_LIMIT,
    ),
    ...(options.types === undefined ? {} : { types: options.types }),
  });
}

async function queryDenseSegmentHits(
  database: Database,
  queryVector: readonly number[],
  options: {
    readonly chapters?: readonly number[];
    readonly limit: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<readonly DenseSegmentHit[]> {
  const kinds = createDenseTextKindFilter(options.types);

  if (kinds.length === 0 || queryVector.length === 0) {
    return [];
  }

  const rows = await database.queryAll(
    `
      SELECT
        archive_id,
        kind,
        chapter_id,
        start_sentence_index,
        end_sentence_index,
        vector
      FROM text_embedding_segments
      WHERE kind IN (${kinds.map(() => "?").join(", ")})
        ${createChapterSql(options.chapters, "")}
    `,
    [...kinds, ...createChapterParams(options.chapters)],
    (row) => ({
      archiveId: getNumber(row, "archive_id"),
      chapterId: getNumber(row, "chapter_id"),
      endSentenceIndex: getNumber(row, "end_sentence_index"),
      kind: getNumber(row, "kind") as TextSentenceKind,
      startSentenceIndex: getNumber(row, "start_sentence_index"),
      vector:
        row.vector instanceof Uint8Array
          ? deserializeFloat32Vector(row.vector)
          : [],
    }),
  );

  return rows
    .map((row) => ({
      archiveId: row.archiveId,
      chapterId: row.chapterId,
      endSentenceIndex: row.endSentenceIndex,
      kind: row.kind,
      score: cosineSimilarity(queryVector, row.vector),
      startSentenceIndex: row.startSentenceIndex,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.archiveId - right.archiveId ||
        left.chapterId - right.chapterId ||
        left.startSentenceIndex - right.startSentenceIndex ||
        left.kind - right.kind,
    )
    .slice(0, options.limit);
}

async function expandDenseSegmentHits(
  database: Database,
  segmentHits: readonly DenseSegmentHit[],
  options: {
    readonly limit: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<readonly SearchIndexTextHit[]> {
  const kinds = createDenseTextKindFilter(options.types);
  const hitsByKey = new Map<string, SearchIndexTextHit>();

  for (const [segmentRank, segment] of segmentHits.entries()) {
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
          AND kind IN (${kinds.map(() => "?").join(", ")})
        ORDER BY sentence_index ASC
      `,
      [
        segment.archiveId,
        segment.kind,
        segment.chapterId,
        segment.startSentenceIndex,
        segment.endSentenceIndex,
        ...kinds,
      ],
      (row) => {
        const rank = segmentRank + 1;

        return {
          archiveId: getNumber(row, "archive_id"),
          chapterId: getNumber(row, "chapter_id"),
          kind: getNumber(row, "kind") as TextSentenceKind,
          rank,
          score: segment.score,
          sentenceIndex: getNumber(row, "sentence_index"),
          wordsCount: getNumber(row, "words_count"),
        };
      },
    );

    for (const row of rows) {
      const key = createTextHitKey(row);
      const existing = hitsByKey.get(key);

      if (existing === undefined || row.score > existing.score) {
        hitsByKey.set(key, row);
      }
    }
    if (hitsByKey.size >= options.limit) {
      break;
    }
  }

  return [...hitsByKey.values()].slice(0, options.limit);
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

function fuseTextHitsByRrf(
  ftsHits: readonly SearchIndexTextHit[],
  denseHits: readonly SearchIndexTextHit[],
): readonly SearchIndexTextHit[] {
  const fused = new Map<
    string,
    { hit: SearchIndexTextHit; score: number; topRank: number }
  >();
  const addHits = (hits: readonly SearchIndexTextHit[], weight: number) => {
    for (const [index, hit] of hits.entries()) {
      const key = createTextHitKey(hit);
      const rank = index + 1;
      const contribution = weight / (60 + rank);
      const existing = fused.get(key);

      if (existing === undefined) {
        fused.set(key, {
          hit,
          score: contribution,
          topRank: rank,
        });
      } else {
        existing.score += contribution;
        existing.topRank = Math.min(existing.topRank, rank);
      }
    }
  };

  addHits(ftsHits, 1);
  addHits(denseHits, 1);

  return [...fused.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.topRank - right.topRank ||
        left.hit.archiveId - right.hit.archiveId ||
        left.hit.chapterId - right.hit.chapterId ||
        left.hit.sentenceIndex - right.hit.sentenceIndex ||
        left.hit.kind - right.hit.kind,
    )
    .map((entry, index) => ({
      ...entry.hit,
      rank: index + 1,
      score: entry.score,
    }));
}

function applyTextAfter(
  hits: readonly SearchIndexTextHit[],
  after:
    | {
        readonly archiveId: number;
        readonly chapterId: number;
        readonly kind: TextSentenceKind;
        readonly rank: number;
        readonly sentenceIndex: number;
      }
    | undefined,
): readonly SearchIndexTextHit[] {
  if (after === undefined) {
    return hits;
  }

  return hits.filter(
    (hit) =>
      hit.rank > after.rank ||
      (hit.rank === after.rank && hit.archiveId > after.archiveId) ||
      (hit.rank === after.rank &&
        hit.archiveId === after.archiveId &&
        hit.chapterId > after.chapterId) ||
      (hit.rank === after.rank &&
        hit.archiveId === after.archiveId &&
        hit.chapterId === after.chapterId &&
        hit.sentenceIndex > after.sentenceIndex) ||
      (hit.rank === after.rank &&
        hit.archiveId === after.archiveId &&
        hit.chapterId === after.chapterId &&
        hit.sentenceIndex === after.sentenceIndex &&
        hit.kind > after.kind),
  );
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
    readonly objectHitLimit?: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<readonly SearchIndexObjectHit[]> {
  if (!shouldQueryObjects(options.types) || options.objectHitLimit === 0) {
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
        bm25(search_object_properties_fts, ?, ?, ?) AS rank
      FROM search_object_properties_fts
      JOIN search_object_properties_records AS r
        ON r.id = search_object_properties_fts.rowid
      WHERE search_object_properties_fts MATCH ?
        ${createChapterSql(options.chapters)}
        ${createObjectTypeSql(options.types)}
      ORDER BY rank ASC, r.archive_id, r.chapter_id, r.owner_kind, r.owner_id, r.property_kind
      ${createLimitSql(options.objectHitLimit)}
    `,
    [
      ...TIER_WEIGHTS,
      matchExpression,
      ...createChapterParams(options.chapters),
      ...createObjectTypeParams(options.types),
      ...createLimitParams(options.objectHitLimit),
    ],
    (row) => ({
      ownerId: String(row.owner_id),
      archiveId: getNumber(row, "archive_id"),
      ownerKind: getNumber(row, "owner_kind") as SearchObjectPropertyOwnerKind,
      propertyKind: getNumber(row, "property_kind") as SearchObjectPropertyKind,
      score: rankToScore(getNumber(row, "rank")),
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
    readonly textAfter?: {
      readonly archiveId: number;
      readonly chapterId: number;
      readonly kind: TextSentenceKind;
      readonly rank: number;
      readonly sentenceIndex: number;
    };
    readonly textHitLimit?: number;
    readonly types?: readonly ArchiveFindObjectType[] | null;
  },
): Promise<readonly SearchIndexTextHit[]> {
  const kinds = createTextKindFilter(options.types);

  if (kinds.length === 0) {
    return [];
  }
  if (options.textHitLimit === 0) {
    return [];
  }

  const after = options.textAfter;

  return await database.queryAll(
    `
      SELECT
        kind,
        archive_id,
        chapter_id,
        sentence_index,
        words_count,
        rank
      FROM (
        SELECT
          r.kind AS kind,
          r.archive_id AS archive_id,
          r.chapter_id AS chapter_id,
          r.sentence_index AS sentence_index,
          r.words_count AS words_count,
          bm25(text_sentence_fts, ?, ?, ?) AS rank
        FROM text_sentence_fts
        JOIN text_sentence_records AS r
          ON r.id = text_sentence_fts.rowid
        WHERE text_sentence_fts MATCH ?
          AND r.kind IN (${kinds.map(() => "?").join(", ")})
          ${createChapterSql(options.chapters)}
      )
      ${
        after === undefined
          ? ""
          : `
            WHERE (
              rank > ?
              OR (rank = ? AND archive_id > ?)
              OR (rank = ? AND archive_id = ? AND chapter_id > ?)
              OR (
                rank = ?
                AND archive_id = ?
                AND chapter_id = ?
                AND sentence_index > ?
              )
              OR (
                rank = ?
                AND archive_id = ?
                AND chapter_id = ?
                AND sentence_index = ?
                AND kind > ?
              )
            )
          `
      }
      ORDER BY rank ASC, archive_id, chapter_id, sentence_index, kind
      ${createLimitSql(options.textHitLimit)}
    `,
    [
      ...TIER_WEIGHTS,
      matchExpression,
      ...kinds,
      ...createChapterParams(options.chapters),
      ...(after === undefined
        ? []
        : [
            after.rank,
            after.rank,
            after.archiveId,
            after.rank,
            after.archiveId,
            after.chapterId,
            after.rank,
            after.archiveId,
            after.chapterId,
            after.sentenceIndex,
            after.rank,
            after.archiveId,
            after.chapterId,
            after.sentenceIndex,
            after.kind,
          ]),
      ...createLimitParams(options.textHitLimit),
    ],
    (row) => {
      const rank = getNumber(row, "rank");

      return {
        chapterId: getNumber(row, "chapter_id"),
        archiveId: getNumber(row, "archive_id"),
        kind: getNumber(row, "kind") as TextSentenceKind,
        rank,
        score: rankToScore(rank),
        sentenceIndex: getNumber(row, "sentence_index"),
        wordsCount: getNumber(row, "words_count"),
      };
    },
  );
}

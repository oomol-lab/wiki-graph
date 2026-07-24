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
  createTextHitKey,
  createTextKindFilter,
  rankToScore,
  shouldQueryObjects,
} from "./helpers.js";
import type {
  SearchIndexObjectHit,
  SearchIndexQueryResult,
  SearchIndexTextHit,
  SearchObjectPropertyKind,
  SearchObjectPropertyOwnerKind,
  TextSentenceKind,
} from "./types.js";
import { SEARCH_INDEX_FTS_HIT_LIMIT, TIER_WEIGHTS } from "./types.js";
import { assertSearchIndexNotDirty } from "./status.js";

export async function querySearchIndex(
  document: ReadonlyDocument,
  query: string,
  options: {
    readonly chapters?: readonly number[];
    readonly match?: ArchiveFindMatch;
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

  if (!hasSearchTokens(plan)) {
    return undefined;
  }

  const terms = listSearchPlanTerms(plan);

  return await document.readSearchIndexDatabase(async (database) => {
    await assertSearchIndexNotDirty(database);
    const tierQueries = createTierQueries(query, plan, options.match ?? "any");
    const objectHitLimit = options.objectHitLimit ?? SEARCH_INDEX_FTS_HIT_LIMIT;
    const textHitLimit = options.textHitLimit ?? SEARCH_INDEX_FTS_HIT_LIMIT;
    const queriesObjects = shouldQueryObjects(options.types);
    const queriesText = createTextKindFilter(options.types).length > 0;
    const objectHitsByKey = new Map<string, SearchIndexObjectHit>();
    const textHitsByKey = new Map<string, SearchIndexTextHit>();

    for (const tierQuery of tierQueries) {
      if (tierQuery.matchExpression === "") {
        continue;
      }

      const objectHitRemaining = Math.max(
        0,
        objectHitLimit - objectHitsByKey.size,
      );
      const textHitRemaining = Math.max(0, textHitLimit - textHitsByKey.size);

      if (
        (!queriesObjects || objectHitRemaining <= 0) &&
        (!queriesText || textHitRemaining <= 0)
      ) {
        break;
      }

      const [objectRows, textRows] = await Promise.all([
        queryObjectRows(database, tierQuery.matchExpression, {
          ...options,
          objectHitLimit: objectHitRemaining,
        }),
        queryTextRows(database, tierQuery.matchExpression, {
          ...options,
          textHitLimit: textHitRemaining,
        }),
      ]);

      for (const hit of objectRows) {
        const key = createObjectHitKey(hit);

        if (!objectHitsByKey.has(key)) {
          objectHitsByKey.set(key, hit);
        }
      }
      for (const hit of textRows) {
        const key = createTextHitKey(hit);

        if (!textHitsByKey.has(key)) {
          textHitsByKey.set(key, hit);
        }
      }
      if (
        (!queriesObjects || objectHitsByKey.size >= objectHitLimit) &&
        (!queriesText || textHitsByKey.size >= textHitLimit)
      ) {
        break;
      }
    }

    return {
      objectHits: [...objectHitsByKey.values()],
      terms,
      textHits: [...textHitsByKey.values()],
    };
  });
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
      ORDER BY rank ASC, r.archive_id, r.chapter_id, r.owner_kind, r.owner_id, r.property_kind
      ${createLimitSql(options.objectHitLimit)}
    `,
    [
      ...TIER_WEIGHTS,
      matchExpression,
      ...createChapterParams(options.chapters),
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

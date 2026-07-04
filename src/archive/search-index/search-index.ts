import { createHash } from "crypto";

import {
  getNumber,
  type Database,
  type SqlBindValue,
} from "../../document/database.js";
import type { Document, ReadonlyDocument } from "../../document/index.js";

import {
  createSearchTokenPlan,
  hasSearchTokens,
  listSearchPlanTerms,
  normalizeSearchText,
  type SearchTokenPlan,
} from "./search-tokenizer.js";
import type {
  ArchiveFindMatch,
  ArchiveFindObjectType,
} from "../query/archive-view.js";

export const TEXT_SENTENCE_KIND = {
  source: 1,
  summary: 2,
} as const;

export type TextSentenceKind =
  (typeof TEXT_SENTENCE_KIND)[keyof typeof TEXT_SENTENCE_KIND];

export const SEARCH_OBJECT_PROPERTY_OWNER_KIND = {
  chapter: 1,
  chunk: 2,
  entity: 3,
} as const;

export type SearchObjectPropertyOwnerKind =
  (typeof SEARCH_OBJECT_PROPERTY_OWNER_KIND)[keyof typeof SEARCH_OBJECT_PROPERTY_OWNER_KIND];

export const SEARCH_OBJECT_PROPERTY_KIND = {
  title: 1,
  label: 1,
  content: 2,
  surface: 1,
} as const;

export type SearchObjectPropertyKind =
  (typeof SEARCH_OBJECT_PROPERTY_KIND)[keyof typeof SEARCH_OBJECT_PROPERTY_KIND];

export interface TextSentenceRecordInput {
  readonly chapterId: number;
  readonly kind: TextSentenceKind;
  readonly sentenceIndex: number;
  readonly text: string;
  readonly wordsCount: number;
}

export interface SearchObjectPropertyRecordInput {
  readonly chapterId?: number;
  readonly ownerId: string;
  readonly ownerKind: SearchObjectPropertyOwnerKind;
  readonly propertyKind: SearchObjectPropertyKind;
  readonly text: string;
}

export interface SearchIndexInput {
  readonly objectProperties: readonly SearchObjectPropertyRecordInput[];
  readonly textSentences: readonly TextSentenceRecordInput[];
}

export type SearchIndexProgressPhase =
  | "checking"
  | "clearing"
  | "collecting"
  | "finalizing"
  | "indexing-objects"
  | "indexing-text";

export interface SearchIndexProgressEvent {
  readonly done?: number;
  readonly phase: SearchIndexProgressPhase;
  readonly total?: number;
  readonly unit?: "chapter" | "object" | "sentence";
}

export type SearchIndexProgressReporter = (
  event: SearchIndexProgressEvent,
) => void | Promise<void>;

export interface SearchIndexTextHit {
  readonly chapterId: number;
  readonly kind: TextSentenceKind;
  readonly score: number;
  readonly sentenceIndex: number;
  readonly wordsCount: number;
}

export interface SearchIndexObjectHit {
  readonly chapterId?: number;
  readonly ownerId: string;
  readonly ownerKind: SearchObjectPropertyOwnerKind;
  readonly propertyKind: SearchObjectPropertyKind;
  readonly score: number;
}

export interface SearchIndexQueryResult {
  readonly objectHits: readonly SearchIndexObjectHit[];
  readonly terms: readonly string[];
  readonly textHits: readonly SearchIndexTextHit[];
}

const SEARCH_INDEX_VERSION = "3";
export const SEARCH_INDEX_FTS_HIT_LIMIT = 32_000;
const FTS5_RANK_SCORE_SCALE = 1_000_000;
const TIER_WEIGHTS = [1, 0.45, 0.08] as const;

export interface ArchiveIndexSettings {
  readonly ftsEmbedded: boolean;
}

export async function readArchiveIndexSettings(
  document: ReadonlyDocument,
): Promise<ArchiveIndexSettings> {
  return await document.readDatabase(async (database) => {
    const row = await database.queryOne(
      `
        SELECT fts_embedded
        FROM archive_index_settings
        WHERE id = 1
      `,
      undefined,
      (value) => ({
        ftsEmbedded: getNumber(value, "fts_embedded") !== 0,
      }),
    );

    return row ?? { ftsEmbedded: false };
  });
}

export async function setFtsIndexEmbedded(
  document: Document,
  embedded: boolean,
): Promise<void> {
  await document.readDatabase(async (database) => {
    await database.run(
      `
        INSERT INTO archive_index_settings(id, fts_embedded)
        VALUES (1, ?)
        ON CONFLICT(id)
        DO UPDATE SET fts_embedded = excluded.fts_embedded
      `,
      [embedded ? 1 : 0],
    );
  });
}

export async function isSearchIndexCurrent(
  document: ReadonlyDocument,
): Promise<boolean> {
  const chaptersRevision = await document.serials.getChaptersRevision();

  try {
    return await document.readSearchIndexDatabase(async (database) => {
      const current = await database.queryAll(
        `
          SELECT key, value
          FROM search_index_state
          WHERE key IN ('version', 'chaptersRevision')
        `,
        undefined,
        (row) => [String(row.key), String(row.value)] as const,
      );
      const state = new Map(current);

      return (
        state.get("version") === SEARCH_INDEX_VERSION &&
        state.get("chaptersRevision") === String(chaptersRevision)
      );
    });
  } catch (error) {
    if (isMissingSearchIndexError(error)) {
      return false;
    }

    throw error;
  }
}

export async function ensureSearchIndex(
  document: Document,
  input: SearchIndexInput,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  const chaptersRevision = await document.serials.getChaptersRevision();

  await document.writeSearchIndexDatabase(async (database) => {
    const fingerprint = createSearchIndexFingerprint(input);
    const current = await database.queryAll(
      `
        SELECT key, value
        FROM search_index_state
        WHERE key IN ('version', 'fingerprint', 'chaptersRevision')
      `,
      undefined,
      (row) => [String(row.key), String(row.value)] as const,
    );
    const state = new Map(current);

    if (
      state.get("version") === SEARCH_INDEX_VERSION &&
      state.get("fingerprint") === fingerprint &&
      state.get("chaptersRevision") === String(chaptersRevision)
    ) {
      return;
    }

    await database.transaction(async () => {
      await progress?.({ phase: "clearing" });
      await database.run("DELETE FROM text_sentence_fts");
      await database.run("DELETE FROM search_object_properties_fts");
      await database.run("DELETE FROM search_object_properties_records");
      await database.run("DELETE FROM search_index_state");

      let textDone = 0;
      for (const record of input.textSentences) {
        const plan = createSearchTokenPlan(record.text);
        const rowId = await insertTextSentenceRecord(database, record);

        await insertFtsRecord(database, "text_sentence_fts", rowId, plan);
        textDone += 1;
        await progress?.({
          done: textDone,
          phase: "indexing-text",
          total: input.textSentences.length,
          unit: "sentence",
        });
      }

      let objectDone = 0;
      for (const record of input.objectProperties) {
        const plan = createSearchTokenPlan(record.text);
        const rowId = await insertSearchObjectPropertyRecord(database, record);

        await insertFtsRecord(
          database,
          "search_object_properties_fts",
          rowId,
          plan,
        );
        objectDone += 1;
        await progress?.({
          done: objectDone,
          phase: "indexing-objects",
          total: input.objectProperties.length,
          unit: "object",
        });
      }

      await progress?.({ phase: "finalizing" });
      await database.run(
        `
          INSERT INTO search_index_state(key, value)
          VALUES ('version', ?)
        `,
        [SEARCH_INDEX_VERSION],
      );
      await database.run(
        `
          INSERT INTO search_index_state(key, value)
          VALUES ('fingerprint', ?)
        `,
        [fingerprint],
      );
      await database.run(
        `
          INSERT INTO search_index_state(key, value)
          VALUES ('chaptersRevision', ?)
        `,
        [String(chaptersRevision)],
      );
    });
  });
}

export async function querySearchIndex(
  document: ReadonlyDocument,
  query: string,
  options: {
    readonly chapters?: readonly number[];
    readonly match?: ArchiveFindMatch;
    readonly objectHitLimit?: number;
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
        objectHitsByKey.set(createObjectHitKey(hit), hit);
      }
      for (const hit of textRows) {
        textHitsByKey.set(createTextHitKey(hit), hit);
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
        r.chapter_id AS chapter_id,
        bm25(search_object_properties_fts, ?, ?, ?) AS rank
      FROM search_object_properties_fts
      JOIN search_object_properties_records AS r
        ON r.id = search_object_properties_fts.rowid
      WHERE search_object_properties_fts MATCH ?
        ${createChapterSql(options.chapters)}
      ORDER BY rank ASC, r.chapter_id, r.owner_kind, r.owner_id, r.property_kind
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

  return await database.queryAll(
    `
      SELECT
        r.kind AS kind,
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
      ORDER BY rank ASC, r.chapter_id, r.sentence_index, r.kind
      ${createLimitSql(options.textHitLimit)}
    `,
    [
      ...TIER_WEIGHTS,
      matchExpression,
      ...kinds,
      ...createChapterParams(options.chapters),
      ...createLimitParams(options.textHitLimit),
    ],
    (row) => ({
      chapterId: getNumber(row, "chapter_id"),
      kind: getNumber(row, "kind") as TextSentenceKind,
      score: rankToScore(getNumber(row, "rank")),
      sentenceIndex: getNumber(row, "sentence_index"),
      wordsCount: getNumber(row, "words_count"),
    }),
  );
}

function createTierQueries(
  query: string,
  plan: SearchTokenPlan,
  match: ArchiveFindMatch,
): readonly {
  readonly matchExpression: string;
}[] {
  if (match === "all") {
    return createAllMatchTierQueries(query);
  }

  return [
    {
      matchExpression: createMatchExpression([
        { column: "tier1", tokens: plan.tier1.map((token) => token.encoded) },
      ]),
    },
    {
      matchExpression: createMatchExpression([
        { column: "tier1", tokens: plan.tier1.map((token) => token.encoded) },
        { column: "tier2", tokens: plan.tier2.map((token) => token.encoded) },
      ]),
    },
    {
      matchExpression: createMatchExpression([
        { column: "tier1", tokens: plan.tier1.map((token) => token.encoded) },
        { column: "tier2", tokens: plan.tier2.map((token) => token.encoded) },
        { column: "tier3", tokens: plan.tier3.map((token) => token.encoded) },
      ]),
    },
  ];
}

function createAllMatchTierQueries(query: string): readonly {
  readonly matchExpression: string;
}[] {
  const termPlans = normalizeSearchText(query)
    .split(/\s+/u)
    .map((term) => createSearchTokenPlan(term))
    .filter(hasSearchTokens);

  const createExpression = (
    selectTokens: (plan: SearchTokenPlan) => readonly string[],
  ): string =>
    termPlans
      .map((termPlan) => {
        const tokens = [...new Set(selectTokens(termPlan))];

        return tokens.length === 0 ? "" : `(${tokens.join(" OR ")})`;
      })
      .filter((term) => term !== "")
      .join(" AND ");

  return [
    {
      matchExpression: createExpression((termPlan) =>
        termPlan.tier1.map((token) => `tier1:${escapeFtsToken(token.encoded)}`),
      ),
    },
    {
      matchExpression: createExpression((termPlan) => [
        ...termPlan.tier1.map(
          (token) => `tier1:${escapeFtsToken(token.encoded)}`,
        ),
        ...termPlan.tier2.map(
          (token) => `tier2:${escapeFtsToken(token.encoded)}`,
        ),
      ]),
    },
    {
      matchExpression: createExpression((termPlan) => [
        ...termPlan.tier1.map(
          (token) => `tier1:${escapeFtsToken(token.encoded)}`,
        ),
        ...termPlan.tier2.map(
          (token) => `tier2:${escapeFtsToken(token.encoded)}`,
        ),
        ...termPlan.tier3.map(
          (token) => `tier3:${escapeFtsToken(token.encoded)}`,
        ),
      ]),
    },
  ];
}

function createMatchExpression(
  groups: readonly {
    readonly column: string;
    readonly tokens: readonly string[];
  }[],
): string {
  return groups
    .map((group) => ({
      ...group,
      tokens: [...new Set(group.tokens)],
    }))
    .filter((group) => group.tokens.length > 0)
    .map(
      (group) =>
        `${group.column}:(${group.tokens.map(escapeFtsToken).join(" OR ")})`,
    )
    .join(" OR ");
}

function escapeFtsToken(token: string): string {
  return `"${token.replaceAll('"', '""')}"`;
}

async function insertTextSentenceRecord(
  database: Database,
  record: TextSentenceRecordInput,
): Promise<number> {
  const rowId = await database.queryOne(
    `
      SELECT id
      FROM text_sentence_records
      WHERE kind = ? AND chapter_id = ? AND sentence_index = ?
    `,
    [record.kind, record.chapterId, record.sentenceIndex],
    (row) => getNumber(row, "id"),
  );

  if (rowId !== undefined) {
    return rowId;
  }

  await database.run(
    `
      INSERT INTO text_sentence_records (
        kind, chapter_id, sentence_index, words_count, byte_offset, byte_length
      )
      VALUES (?, ?, ?, ?, 0, 0)
    `,
    [record.kind, record.chapterId, record.sentenceIndex, record.wordsCount],
  );

  return await database.getLastInsertRowId();
}

async function insertSearchObjectPropertyRecord(
  database: Database,
  record: SearchObjectPropertyRecordInput,
): Promise<number> {
  await database.run(
    `
      INSERT INTO search_object_properties_records (
        owner_kind, owner_id, property_kind, chapter_id
      )
      VALUES (?, ?, ?, ?)
    `,
    [
      record.ownerKind,
      record.ownerId,
      record.propertyKind,
      record.chapterId ?? null,
    ],
  );

  return await database.getLastInsertRowId();
}

async function insertFtsRecord(
  database: Database,
  table: "search_object_properties_fts" | "text_sentence_fts",
  rowId: number,
  plan: SearchTokenPlan,
): Promise<void> {
  await database.run(
    `
      INSERT INTO ${table}(rowid, tier1, tier2, tier3)
      VALUES (?, ?, ?, ?)
    `,
    [
      rowId,
      serializeTokens(plan.tier1),
      serializeTokens(plan.tier2),
      serializeTokens(plan.tier3),
    ],
  );
}

function createSearchIndexFingerprint(input: SearchIndexInput): string {
  const hash = createHash("sha256");

  for (const record of input.textSentences) {
    hash.update("text");
    hash.update("\0");
    hash.update(String(record.kind));
    hash.update("\0");
    hash.update(String(record.chapterId));
    hash.update("\0");
    hash.update(String(record.sentenceIndex));
    hash.update("\0");
    hash.update(record.text);
    hash.update("\0");
  }

  for (const record of input.objectProperties) {
    hash.update("object-property");
    hash.update("\0");
    hash.update(String(record.ownerKind));
    hash.update("\0");
    hash.update(record.ownerId);
    hash.update("\0");
    hash.update(String(record.propertyKind));
    hash.update("\0");
    hash.update(String(record.chapterId ?? ""));
    hash.update("\0");
    hash.update(record.text);
    hash.update("\0");
  }

  return hash.digest("hex");
}

function isMissingSearchIndexError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;

  return (
    code === "SQLITE_CANTOPEN" ||
    (error instanceof Error &&
      (error.message.includes("Archive SQLite entry is missing: fts.db") ||
        error.message.includes("no such table: search_index_state")))
  );
}

function serializeTokens(
  tokens: readonly {
    readonly encoded: string;
  }[],
): string {
  return tokens.map((token) => token.encoded).join(" ");
}

function createChapterSql(chapters: readonly number[] | undefined): string {
  return chapters === undefined || chapters.length === 0
    ? ""
    : `AND r.chapter_id IN (${chapters.map(() => "?").join(", ")})`;
}

function createChapterParams(
  chapters: readonly number[] | undefined,
): readonly SqlBindValue[] {
  return chapters === undefined ? [] : [...chapters];
}

function createLimitSql(limit: number | undefined): string {
  return limit === undefined ? "" : "LIMIT ?";
}

function createLimitParams(limit: number | undefined): readonly SqlBindValue[] {
  return limit === undefined ? [] : [limit];
}

function shouldQueryObjects(
  types: readonly ArchiveFindObjectType[] | null | undefined,
): boolean {
  return (
    types === undefined ||
    types === null ||
    types.includes("chapter") ||
    types.includes("node") ||
    types.includes("entity")
  );
}

function createTextKindFilter(
  types: readonly ArchiveFindObjectType[] | null | undefined,
): readonly TextSentenceKind[] {
  if (types === undefined || types === null) {
    return [TEXT_SENTENCE_KIND.summary, TEXT_SENTENCE_KIND.source];
  }

  const kinds: TextSentenceKind[] = [];

  if (types.includes("summary")) {
    kinds.push(TEXT_SENTENCE_KIND.summary);
  }
  if (types.includes("source")) {
    kinds.push(TEXT_SENTENCE_KIND.source);
  }

  return kinds;
}

function rankToScore(rank: number): number {
  const relevance = Math.max(0, -rank) * FTS5_RANK_SCORE_SCALE;

  return relevance / (1 + relevance);
}

function createObjectHitKey(hit: SearchIndexObjectHit): string {
  return [
    hit.ownerKind,
    hit.ownerId,
    hit.propertyKind,
    hit.chapterId ?? "",
  ].join(":");
}

function createTextHitKey(hit: SearchIndexTextHit): string {
  return [hit.kind, hit.chapterId, hit.sentenceIndex].join(":");
}

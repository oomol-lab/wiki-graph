import { stat } from "fs/promises";

import { resolveWikiGraphCacheDatabasePath } from "../../runtime/common/wiki-graph/dir.js";
import { getNumber } from "../../document/database.js";
import { openSharedStateDatabase } from "../../document/index.js";
import type { Database } from "../../document/index.js";
import type { GcContext, GcJobResult } from "../../runtime/gc/index.js";
import { isNodeError } from "../../utils/node-error.js";

import type {
  CachedDisambiguationRecord,
  CachedPageRecord,
  CachedQidRecord,
  DisambiguationLinkedQid,
  DisambiguationPageText,
  DisambiguationProfileError,
  DisambiguationProfile,
  DisambiguationProfileMeaning,
  EnrichmentStore,
} from "./types.js";

type SqlRow = Record<string, unknown>;

const CREATE_QID_CACHE_SQL = `
CREATE TABLE IF NOT EXISTS qid_cache (
  qid TEXT NOT NULL,
  language TEXT NOT NULL,
  label TEXT,
  description TEXT,
  pages_json TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (qid, language)
);
`;

const CREATE_DISAMBIGUATION_CACHE_SQL = `
CREATE TABLE IF NOT EXISTS disambiguation_cache (
  qid TEXT NOT NULL,
  wiki TEXT NOT NULL,
  pages_json TEXT NOT NULL,
  profile_json TEXT,
  profile_error_json TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (qid, wiki)
);
`;

const WIKIPAGE_CACHE_SCHEMA_SQL = `
${CREATE_QID_CACHE_SQL}

CREATE INDEX IF NOT EXISTS idx_qid_cache_checked_at
ON qid_cache(checked_at);

${CREATE_DISAMBIGUATION_CACHE_SQL}

CREATE INDEX IF NOT EXISTS idx_disambiguation_cache_checked_at
ON disambiguation_cache(checked_at);
`;
const WIKIPAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class WikipageCache implements EnrichmentStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public static async open(path?: string): Promise<WikipageCache> {
    const databasePath = path ?? resolveWikiGraphCacheDatabasePath();
    const database = await openSharedStateDatabase(
      databasePath,
      WIKIPAGE_CACHE_SCHEMA_SQL,
    );

    try {
      await migrateWikipageCacheSchema(database);
    } catch (error) {
      await database.close().catch(() => undefined);
      throw error;
    }

    return new WikipageCache(database);
  }

  public async close(): Promise<void> {
    await this.#database.close();
  }

  public async getQids(
    qids: readonly string[],
    language: string,
  ): Promise<ReadonlyMap<string, CachedQidRecord>> {
    if (qids.length === 0) {
      return new Map();
    }

    const results = new Map<string, CachedQidRecord>();

    for (const qid of qids) {
      const record = await this.#database.queryOne(
        `
SELECT *
FROM qid_cache
WHERE qid = ? AND language = ?
`,
        [qid, language],
        mapQidRecord,
      );

      if (record !== undefined) {
        results.set(qid, record);
      }
    }

    return results;
  }

  public async putQids(
    records: readonly CachedQidRecord[],
    language: string,
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.#database.run(
          `
INSERT INTO qid_cache (
  qid, language, label, description, pages_json, checked_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(qid, language) DO UPDATE SET
  label = excluded.label,
  description = excluded.description,
  pages_json = excluded.pages_json,
  checked_at = excluded.checked_at,
  updated_at = excluded.updated_at
`,
          [
            record.qid,
            language,
            record.label ?? null,
            record.description ?? null,
            JSON.stringify(record.sitelinks),
            record.checkedAt,
            record.updatedAt,
          ],
        );
      }
    });
  }

  public async getDisambiguations(
    qids: readonly string[],
    wiki: string,
  ): Promise<ReadonlyMap<string, CachedDisambiguationRecord>> {
    if (qids.length === 0) {
      return new Map();
    }

    const results = new Map<string, CachedDisambiguationRecord>();

    for (const qid of qids) {
      const record = await this.#database.queryOne(
        `
SELECT *
FROM disambiguation_cache
WHERE qid = ? AND wiki = ?
`,
        [qid, wiki],
        mapDisambiguationRecord,
      );

      if (record !== undefined) {
        if (isExpiredProfileError(record.profileError)) {
          continue;
        }
        results.set(qid, record);
      }
    }

    return results;
  }

  public async putDisambiguations(
    records: readonly CachedDisambiguationRecord[],
    wiki: string,
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.#database.run(
          `
INSERT INTO disambiguation_cache (
  qid, wiki, pages_json, profile_json, profile_error_json, checked_at
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(qid, wiki) DO UPDATE SET
  pages_json = excluded.pages_json,
  profile_json = excluded.profile_json,
  profile_error_json = excluded.profile_error_json,
  checked_at = excluded.checked_at
`,
          [
            record.disambiguationQid,
            wiki,
            JSON.stringify(record.pages),
            record.profile === undefined
              ? null
              : JSON.stringify(record.profile),
            record.profileError === undefined
              ? null
              : JSON.stringify(record.profileError),
            record.checkedAt,
          ],
        );
      }
    });
  }
}

export async function runWikipageCacheGc(
  context: GcContext,
): Promise<GcJobResult> {
  const databasePath = resolveWikiGraphCacheDatabasePath();
  const beforeBytes = await readFileSize(databasePath);

  if (beforeBytes === undefined) {
    return {
      freedBytes: 0,
      removed: 0,
      scanned: 0,
    };
  }

  const database = await openSharedStateDatabase(
    databasePath,
    WIKIPAGE_CACHE_SCHEMA_SQL,
  );

  try {
    await migrateWikipageCacheSchema(database);

    const scanned = await countWikipageCacheRows(database);
    const cutoff = new Date(context.now - WIKIPAGE_CACHE_TTL_MS).toISOString();
    const expired = await countExpiredWikipageCacheRows(database, cutoff);

    if (!context.dryRun && expired > 0) {
      await database.transaction(async () => {
        await database.run("DELETE FROM qid_cache WHERE checked_at < ?", [
          cutoff,
        ]);
        await database.run(
          "DELETE FROM disambiguation_cache WHERE checked_at < ?",
          [cutoff],
        );
      });
      await database.run("VACUUM");
    }

    const afterBytes = await readFileSize(databasePath);

    return {
      freedBytes: context.dryRun
        ? estimateDryRunFreedBytes(beforeBytes, scanned, expired)
        : Math.max(0, beforeBytes - (afterBytes ?? 0)),
      removed: expired,
      scanned,
    };
  } finally {
    await database.close();
  }
}

function estimateDryRunFreedBytes(
  beforeBytes: number,
  scanned: number,
  expired: number,
): number {
  if (scanned === 0 || expired === 0) {
    return 0;
  }

  return Math.round(beforeBytes * (expired / scanned));
}

async function migrateWikipageCacheSchema(database: Database): Promise<void> {
  await migrateQidCacheSchema(database);
  await migrateDisambiguationCacheSchema(database);
}

async function migrateQidCacheSchema(database: Database): Promise<void> {
  const columns = await listTableColumns(database, "qid_cache");

  if (columns.has("language")) {
    return;
  }

  await database.transaction(async () => {
    const transactionColumns = await listTableColumns(database, "qid_cache");

    if (transactionColumns.has("language")) {
      return;
    }

    await database.run("ALTER TABLE qid_cache RENAME TO qid_cache_legacy");
    await database.run(CREATE_QID_CACHE_SQL);
    await database.run(`
INSERT OR IGNORE INTO qid_cache (
  qid, language, label, description, pages_json, checked_at, updated_at
)
SELECT qid, 'en', label, description, pages_json, checked_at, updated_at
FROM qid_cache_legacy
`);
    await database.run("DROP TABLE qid_cache_legacy");
  });
}

async function migrateDisambiguationCacheSchema(
  database: Database,
): Promise<void> {
  const columns = await listTableColumns(database, "disambiguation_cache");

  if (!columns.has("wiki")) {
    await database.transaction(async () => {
      const transactionColumns = await listTableColumns(
        database,
        "disambiguation_cache",
      );

      if (transactionColumns.has("wiki")) {
        return;
      }

      await database.run(
        "ALTER TABLE disambiguation_cache RENAME TO disambiguation_cache_legacy",
      );
      await database.run(CREATE_DISAMBIGUATION_CACHE_SQL);
      await database.run(`
INSERT OR IGNORE INTO disambiguation_cache (
  qid, wiki, pages_json, profile_json, checked_at
)
SELECT qid, 'enwiki', pages_json, profile_json, checked_at
FROM disambiguation_cache_legacy
`);
      await database.run("DROP TABLE disambiguation_cache_legacy");
    });
  }

  const updatedColumns = await listTableColumns(
    database,
    "disambiguation_cache",
  );

  if (!updatedColumns.has("profile_error_json")) {
    await database.run(
      "ALTER TABLE disambiguation_cache ADD COLUMN profile_error_json TEXT",
    );
  }
}

async function listTableColumns(
  database: Database,
  table: string,
): Promise<ReadonlySet<string>> {
  const columns = await database.queryAll(
    `PRAGMA table_info(${table})`,
    undefined,
    (row) => getString(row.name, "name"),
  );

  return new Set(columns);
}

async function countWikipageCacheRows(database: Database): Promise<number> {
  const qids = await countRows(database, "qid_cache");
  const disambiguations = await countRows(database, "disambiguation_cache");

  return qids + disambiguations;
}

async function countExpiredWikipageCacheRows(
  database: Database,
  cutoff: string,
): Promise<number> {
  const qids = await countRows(database, "qid_cache", cutoff);
  const disambiguations = await countRows(
    database,
    "disambiguation_cache",
    cutoff,
  );

  return qids + disambiguations;
}

async function countRows(
  database: Database,
  table: "disambiguation_cache" | "qid_cache",
  checkedBefore?: string,
): Promise<number> {
  return (
    (await database.queryOne(
      `
SELECT COUNT(*) AS count
FROM ${table}
${checkedBefore === undefined ? "" : "WHERE checked_at < ?"}
`,
      checkedBefore === undefined ? undefined : [checkedBefore],
      (row) => getNumber(row, "count"),
    )) ?? 0
  );
}

async function readFileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function mapQidRecord(row: SqlRow): CachedQidRecord {
  const description = getOptionalString(row.description);
  const label = getOptionalString(row.label);

  return {
    checkedAt: getString(row.checked_at, "checked_at"),
    ...(description === undefined ? {} : { description }),
    ...(label === undefined ? {} : { label }),
    qid: getString(row.qid, "qid"),
    sitelinks: parsePageRecords(getString(row.pages_json, "pages_json")),
    updatedAt: getString(row.updated_at, "updated_at"),
  };
}

function mapDisambiguationRecord(row: SqlRow): CachedDisambiguationRecord {
  const profileErrorJson = getOptionalString(row.profile_error_json);
  const profileError =
    profileErrorJson === undefined
      ? undefined
      : parseDisambiguationProfileError(profileErrorJson);

  return {
    checkedAt: getString(row.checked_at, "checked_at"),
    disambiguationQid: getString(row.qid, "qid"),
    pages: parseDisambiguationPages(getString(row.pages_json, "pages_json")),
    ...(profileError === undefined ? {} : { profileError }),
    ...(getOptionalString(row.profile_json) === undefined
      ? {}
      : {
          profile: parseDisambiguationProfile(
            getOptionalString(row.profile_json)!,
          ),
        }),
  };
}

function isExpiredProfileError(
  error: DisambiguationProfileError | undefined,
): boolean {
  if (error === undefined) {
    return false;
  }

  const retryAt = Date.parse(error.retryAfter);

  return Number.isFinite(retryAt) && retryAt <= Date.now();
}

function parsePageRecords(value: string): readonly CachedPageRecord[] {
  const parsed: unknown = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isCachedPageRecord);
}

function parseDisambiguationPages(
  value: string,
): readonly DisambiguationPageText[] {
  const parsed: unknown = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isDisambiguationPageText);
}

function isCachedPageRecord(value: unknown): value is CachedPageRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.isDisambiguation === "boolean" &&
    typeof record.title === "string" &&
    record.title !== "" &&
    isSupportedWiki(record.wiki)
  );
}

function isDisambiguationPageText(
  value: unknown,
): value is DisambiguationPageText {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    Array.isArray(record.linkedQids) &&
    record.linkedQids.every(isLinkedQid) &&
    typeof record.text === "string" &&
    record.text !== "" &&
    typeof record.title === "string" &&
    record.title !== "" &&
    isSupportedWiki(record.wiki)
  );
}

function parseDisambiguationProfile(value: string): DisambiguationProfile {
  const parsed: unknown = JSON.parse(value);

  if (!isDisambiguationProfile(parsed)) {
    throw new Error(
      "Expected profile_json to contain a disambiguation profile.",
    );
  }

  return parsed;
}

function parseDisambiguationProfileError(
  value: string,
): DisambiguationProfileError | undefined {
  const parsed: unknown = JSON.parse(value);

  if (!isDisambiguationProfileError(parsed)) {
    return undefined;
  }

  return parsed;
}

function isDisambiguationProfile(
  value: unknown,
): value is DisambiguationProfile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    Array.isArray(record.meanings) &&
    record.meanings.every(isDisambiguationProfileMeaning) &&
    typeof record.sourceQid === "string" &&
    /^Q[1-9]\d*$/u.test(record.sourceQid) &&
    (!("surface" in record) || typeof record.surface === "string")
  );
}

function isDisambiguationProfileMeaning(
  value: unknown,
): value is DisambiguationProfileMeaning {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    (!("category" in record) || typeof record.category === "string") &&
    typeof record.information === "string" &&
    typeof record.name === "string" &&
    record.name !== "" &&
    (record.priority === "primary" ||
      record.priority === "secondary" ||
      record.priority === "other") &&
    typeof record.qid === "string" &&
    /^Q[1-9]\d*$/u.test(record.qid)
  );
}

function isDisambiguationProfileError(
  value: unknown,
): value is DisambiguationProfileError {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.failedAt === "string" &&
    typeof record.message === "string" &&
    typeof record.retryAfter === "string"
  );
}

function isLinkedQid(value: unknown): value is DisambiguationLinkedQid {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.qid === "string" &&
    /^Q[1-9]\d*$/u.test(record.qid) &&
    typeof record.title === "string" &&
    record.title !== ""
  );
}

function isSupportedWiki(value: unknown): value is "enwiki" | "zhwiki" {
  return value === "enwiki" || value === "zhwiki";
}

function getString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${field} to be a string.`);
  }

  return value;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

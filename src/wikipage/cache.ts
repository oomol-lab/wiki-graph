import { dirname } from "path";
import { mkdir } from "fs/promises";

import { resolveWikiGraphCacheDatabasePath } from "../common/wiki-graph-dir.js";
import { Database } from "../document/index.js";

import type {
  CachedDisambiguationRecord,
  CachedQidRecord,
  DisambiguationOption,
} from "./types.js";

type SqlRow = Record<string, unknown>;

const WIKIPAGE_CACHE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS qid_cache (
  qid TEXT PRIMARY KEY,
  label TEXT,
  description TEXT,
  sitelink_wiki TEXT,
  sitelink_title TEXT,
  page_id INTEGER,
  is_disambiguation INTEGER NOT NULL,
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disambiguation_cache (
  qid TEXT PRIMARY KEY,
  wiki TEXT NOT NULL,
  language TEXT NOT NULL,
  page_title TEXT NOT NULL,
  page_id INTEGER,
  options_json TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
`;

export class WikipageCache {
  readonly #database: Database;

  private constructor(database: Database) {
    this.#database = database;
  }

  public static async open(path?: string): Promise<WikipageCache> {
    const databasePath = path ?? resolveWikiGraphCacheDatabasePath();

    await mkdir(dirname(databasePath), { recursive: true });

    return new WikipageCache(
      await Database.open(databasePath, WIKIPAGE_CACHE_SCHEMA_SQL),
    );
  }

  public async close(): Promise<void> {
    await this.#database.close();
  }

  public async getQids(
    qids: readonly string[],
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
WHERE qid = ?
`,
        [qid],
        mapQidRecord,
      );

      if (record !== undefined) {
        results.set(qid, record);
      }
    }

    return results;
  }

  public async putQids(records: readonly CachedQidRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.#database.run(
          `
INSERT INTO qid_cache (
  qid, label, description, sitelink_wiki, sitelink_title, page_id,
  is_disambiguation, checked_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(qid) DO UPDATE SET
  label = excluded.label,
  description = excluded.description,
  sitelink_wiki = excluded.sitelink_wiki,
  sitelink_title = excluded.sitelink_title,
  page_id = excluded.page_id,
  is_disambiguation = excluded.is_disambiguation,
  checked_at = excluded.checked_at,
  updated_at = excluded.updated_at
`,
          [
            record.qid,
            record.label ?? null,
            record.description ?? null,
            record.sitelinkWiki ?? null,
            record.sitelinkTitle ?? null,
            record.pageId ?? null,
            record.isDisambiguation ? 1 : 0,
            record.checkedAt,
            record.updatedAt,
          ],
        );
      }
    });
  }

  public async getDisambiguations(
    qids: readonly string[],
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
WHERE qid = ?
`,
        [qid],
        mapDisambiguationRecord,
      );

      if (record !== undefined) {
        results.set(qid, record);
      }
    }

    return results;
  }

  public async putDisambiguations(
    records: readonly CachedDisambiguationRecord[],
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.#database.run(
          `
INSERT INTO disambiguation_cache (
  qid, wiki, language, page_title, page_id, options_json, checked_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(qid) DO UPDATE SET
  wiki = excluded.wiki,
  language = excluded.language,
  page_title = excluded.page_title,
  page_id = excluded.page_id,
  options_json = excluded.options_json,
  checked_at = excluded.checked_at
`,
          [
            record.disambiguationQid,
            record.wiki,
            record.language,
            record.pageTitle,
            record.pageId ?? null,
            JSON.stringify(record.options),
            record.checkedAt,
          ],
        );
      }
    });
  }
}

function mapQidRecord(row: SqlRow): CachedQidRecord {
  const description = getOptionalString(row.description);
  const label = getOptionalString(row.label);
  const pageId = getOptionalNumber(row.page_id);
  const sitelinkTitle = getOptionalString(row.sitelink_title);
  const sitelinkWiki = getOptionalString(row.sitelink_wiki);

  return {
    checkedAt: getString(row.checked_at, "checked_at"),
    ...(description === undefined ? {} : { description }),
    isDisambiguation:
      getNumber(row.is_disambiguation, "is_disambiguation") !== 0,
    ...(label === undefined ? {} : { label }),
    ...(pageId === undefined ? {} : { pageId }),
    qid: getString(row.qid, "qid"),
    ...(sitelinkTitle === undefined ? {} : { sitelinkTitle }),
    ...(sitelinkWiki === undefined ? {} : { sitelinkWiki }),
    updatedAt: getString(row.updated_at, "updated_at"),
  };
}

function mapDisambiguationRecord(row: SqlRow): CachedDisambiguationRecord {
  const pageId = getOptionalNumber(row.page_id);

  return {
    checkedAt: getString(row.checked_at, "checked_at"),
    disambiguationQid: getString(row.qid, "qid"),
    language: getString(row.language, "language"),
    options: parseOptions(getString(row.options_json, "options_json")),
    ...(pageId === undefined ? {} : { pageId }),
    pageTitle: getString(row.page_title, "page_title"),
    wiki: getString(row.wiki, "wiki"),
  };
}

function parseOptions(value: string): readonly DisambiguationOption[] {
  const parsed = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isDisambiguationOption);
}

function isDisambiguationOption(value: unknown): value is DisambiguationOption {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.qid === "string" &&
    record.qid !== "" &&
    typeof record.title === "string" &&
    record.title !== ""
  );
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

function getNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected ${field} to be a number.`);
  }

  return value;
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

import { dirname } from "path";
import { mkdir } from "fs/promises";

import { resolveWikiGraphCacheDatabasePath } from "../common/wiki-graph-dir.js";
import { Database } from "../document/index.js";

import type {
  CachedDisambiguationRecord,
  CachedPageRecord,
  CachedQidRecord,
  DisambiguationLinkedQid,
  DisambiguationPageText,
  DisambiguationProfile,
  DisambiguationProfileMeaning,
} from "./types.js";

type SqlRow = Record<string, unknown>;

const WIKIPAGE_CACHE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS qid_cache (
  qid TEXT PRIMARY KEY,
  label TEXT,
  description TEXT,
  pages_json TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disambiguation_cache (
  qid TEXT PRIMARY KEY,
  pages_json TEXT NOT NULL,
  profile_json TEXT,
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
  qid, label, description, pages_json, checked_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(qid) DO UPDATE SET
  label = excluded.label,
  description = excluded.description,
  pages_json = excluded.pages_json,
  checked_at = excluded.checked_at,
  updated_at = excluded.updated_at
`,
          [
            record.qid,
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
  qid, pages_json, profile_json, checked_at
) VALUES (?, ?, ?, ?)
ON CONFLICT(qid) DO UPDATE SET
  pages_json = excluded.pages_json,
  profile_json = excluded.profile_json,
  checked_at = excluded.checked_at
`,
          [
            record.disambiguationQid,
            JSON.stringify(record.pages),
            record.profile === undefined
              ? null
              : JSON.stringify(record.profile),
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
  return {
    checkedAt: getString(row.checked_at, "checked_at"),
    disambiguationQid: getString(row.qid, "qid"),
    pages: parseDisambiguationPages(getString(row.pages_json, "pages_json")),
    ...(getOptionalString(row.profile_json) === undefined
      ? {}
      : {
          profile: parseDisambiguationProfile(
            getOptionalString(row.profile_json)!,
          ),
        }),
  };
}

function parsePageRecords(value: string): readonly CachedPageRecord[] {
  const parsed = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isCachedPageRecord);
}

function parseDisambiguationPages(
  value: string,
): readonly DisambiguationPageText[] {
  const parsed = JSON.parse(value);

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
  const parsed = JSON.parse(value);

  if (!isDisambiguationProfile(parsed)) {
    throw new Error("Expected profile_json to contain a disambiguation profile.");
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

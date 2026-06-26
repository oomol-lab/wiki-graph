import { dirname } from "path";
import { mkdir } from "fs/promises";

import { resolveWikiGraphCacheDatabasePath } from "../common/wiki-graph-dir.js";
import { Database } from "../document/index.js";

const SURFACE_BLOCKLIST_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS surface_blocklist (
  surface TEXT PRIMARY KEY,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

type SqlRow = Record<string, unknown>;

export interface WikimatchSurfaceBlocklistRecord {
  readonly createdAt: string;
  readonly note?: string;
  readonly surface: string;
  readonly updatedAt: string;
}

export class WikimatchSurfaceBlocklist {
  readonly #database: Database;

  private constructor(database: Database) {
    this.#database = database;
  }

  public static async open(path?: string): Promise<WikimatchSurfaceBlocklist> {
    const databasePath = path ?? resolveWikiGraphCacheDatabasePath();

    await mkdir(dirname(databasePath), { recursive: true });

    return new WikimatchSurfaceBlocklist(
      await Database.open(databasePath, SURFACE_BLOCKLIST_SCHEMA_SQL),
    );
  }

  public async close(): Promise<void> {
    await this.#database.close();
  }

  public async has(surface: string): Promise<boolean> {
    const record = await this.#database.queryOne(
      `
SELECT surface
FROM surface_blocklist
WHERE surface = ?
`,
      [surface],
      () => true,
    );

    return record === true;
  }

  public async getBlockedSurfaces(
    surfaces: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const blocked = new Set<string>();

    for (const surface of new Set(surfaces)) {
      if (await this.has(surface)) {
        blocked.add(surface);
      }
    }

    return blocked;
  }

  public async put(
    records: readonly {
      readonly note?: string;
      readonly surface: string;
    }[],
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const now = new Date().toISOString();

    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.#database.run(
          `
INSERT INTO surface_blocklist (
  surface, note, created_at, updated_at
) VALUES (?, ?, ?, ?)
ON CONFLICT(surface) DO UPDATE SET
  note = excluded.note,
  updated_at = excluded.updated_at
`,
          [record.surface, record.note ?? null, now, now],
        );
      }
    });
  }

  public async list(): Promise<readonly WikimatchSurfaceBlocklistRecord[]> {
    return await this.#database.queryAll(
      `
SELECT *
FROM surface_blocklist
ORDER BY surface
`,
      undefined,
      mapRecord,
    );
  }
}

function mapRecord(row: SqlRow): WikimatchSurfaceBlocklistRecord {
  const note = getOptionalString(row.note);

  return {
    createdAt: getString(row.created_at, "created_at"),
    ...(note === undefined ? {} : { note }),
    surface: getString(row.surface, "surface"),
    updatedAt: getString(row.updated_at, "updated_at"),
  };
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

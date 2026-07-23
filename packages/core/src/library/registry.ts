import { randomBytes } from "crypto";
import { mkdir, stat } from "fs/promises";
import { join, resolve } from "path";

import {
  getNumber,
  getString,
  type Database,
  type SqlRow,
} from "../document/database.js";
import { openSharedStateDatabase } from "../document/index.js";
import {
  resolveWikiGraphCoreDatabasePath,
  resolveWikiGraphHomeDirectoryPath,
  resolveWikiGraphStagingDirectoryPath,
} from "../runtime/common/wiki-graph/dir.js";
import { WIKI_GRAPH_ARCHIVE_EXTENSION } from "../runtime/common/wiki-graph/uri.js";
import { isNodeError } from "../utils/node-error.js";
import { withWikiGraphLibraryLock } from "./lock.js";

const DEFAULT_LIBRARY_FOLDER_NAME = "default-library";
const PUBLIC_ID_BYTES = 6;
const RESERVED_METADATA_KEYS = new Set([
  "id",
  "public_id",
  "publicId",
  "folder_path",
  "folderPath",
  "is_default",
  "isDefault",
  "staging_path",
  "stagingPath",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "uri",
]);

const LIBRARY_REGISTRY_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    folder_path TEXT NOT NULL UNIQUE,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_libraries_single_default
  ON libraries(is_default)
  WHERE is_default = 1;

  CREATE TABLE IF NOT EXISTS library_metadata (
    library_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (library_id, key)
  );

  CREATE INDEX IF NOT EXISTS idx_library_metadata_library
  ON library_metadata(library_id);
`;

export interface WikiGraphLibraryRecord {
  readonly id: number;
  readonly publicId: string;
  readonly uri: string;
  readonly folderPath: string;
  readonly isDefault: boolean;
  readonly stagingPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ParsedWikiGraphLibraryUri {
  readonly archivePublicId?: string;
  readonly kind: "archive" | "metadata" | "scope";
  readonly objectUri?: string;
  readonly publicId?: string;
  readonly isDefault: boolean;
}

export function isWikiGraphLibraryUri(uri: string | undefined): uri is string {
  if (uri?.startsWith("wikg://lib") !== true) {
    return false;
  }
  try {
    const target = parseWikiGraphLibraryUri(uri);
    return (
      target !== undefined &&
      (target.kind !== "archive" || target.objectUri === undefined)
    );
  } catch {
    return false;
  }
}

export function parseWikiGraphLibraryUri(
  uri: string,
): ParsedWikiGraphLibraryUri | undefined {
  if (uri === "wikg://lib") {
    return { isDefault: true, kind: "scope" };
  }
  if (uri === "wikg://lib/meta") {
    return { isDefault: true, kind: "metadata" };
  }
  if (!uri.startsWith("wikg://lib/")) {
    return undefined;
  }

  const path = uri.slice("wikg://lib/".length).replace(/\/+$/u, "");
  if (
    path.split("/").some((part) => part.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION))
  ) {
    return undefined;
  }
  const explicitLibraryArchiveMatch =
    /^([^/]+)\.lib\/(?!meta(?:\/|$)|index(?:\/|$)|chapter(?:\/|$)|chunk(?:\/|$)|entity(?:\/|$)|triple(?:\/|$))([^/]+)(?:\/(.*))?$/u.exec(
      path,
    );
  const explicitLibraryPublicId = explicitLibraryArchiveMatch?.[1];
  const explicitArchivePublicId = explicitLibraryArchiveMatch?.[2];
  const explicitObjectPath = explicitLibraryArchiveMatch?.[3];
  if (
    explicitLibraryPublicId !== undefined &&
    explicitArchivePublicId !== undefined
  ) {
    return {
      archivePublicId: explicitArchivePublicId,
      isDefault: false,
      kind: "archive",
      ...(explicitObjectPath === undefined
        ? {}
        : { objectUri: formatWikiGraphLibraryObjectUri(explicitObjectPath) }),
      publicId: explicitLibraryPublicId,
    };
  }

  const match =
    /^([^/]+)\.lib(?:\/(meta|index|chapter|chunk|entity|triple)(?:\/(.*))?)?$/u.exec(
      path,
    );
  if (match?.[1] !== undefined) {
    if (match[2] !== undefined && match[2] !== "meta") {
      return {
        isDefault: false,
        kind: "scope",
        objectUri: formatWikiGraphLibraryObjectUri(
          [match[2], match[3]].filter(Boolean).join("/"),
        ),
        publicId: match[1],
      };
    }
    return {
      isDefault: false,
      kind: match[2] === "meta" ? "metadata" : "scope",
      publicId: match[1],
    };
  }

  const defaultLibraryScopeMatch =
    /^(index|chapter|chunk|entity|triple)(?:\/(.*))?$/u.exec(path);
  if (defaultLibraryScopeMatch?.[1] !== undefined) {
    return {
      isDefault: true,
      kind: "scope",
      objectUri: formatWikiGraphLibraryObjectUri(
        [defaultLibraryScopeMatch[1], defaultLibraryScopeMatch[2]]
          .filter(Boolean)
          .join("/"),
      ),
    };
  }

  const defaultLibraryArchiveMatch = /^([^/.][^/]*)(?:\/(.*))?$/u.exec(path);
  if (defaultLibraryArchiveMatch?.[1] !== undefined) {
    return {
      archivePublicId: defaultLibraryArchiveMatch[1],
      isDefault: true,
      kind: "archive",
      ...(defaultLibraryArchiveMatch[2] === undefined
        ? {}
        : {
            objectUri: formatWikiGraphLibraryObjectUri(
              defaultLibraryArchiveMatch[2],
            ),
          }),
    };
  }

  throw new Error(
    `Invalid Wiki Graph library URI: ${uri}. Expected wikg://lib, wikg://lib/meta, wikg://lib/<lib-id>.lib, or wikg://lib/<lib-id>.lib/meta.`,
  );
}

function formatWikiGraphLibraryObjectUri(path: string): string {
  return `wikg://${path.replace(/^\/+|\/+$/gu, "")}`;
}

export function formatWikiGraphLibraryUri(publicId?: string): string {
  return publicId === undefined ? "wikg://lib" : `wikg://lib/${publicId}.lib`;
}

export function resolveDefaultWikiGraphLibraryDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), DEFAULT_LIBRARY_FOLDER_NAME);
}

export function resolveWikiGraphLibraryStagingDirectoryPath(
  id: number,
): string {
  return join(resolveWikiGraphStagingDirectoryPath(), "library", String(id));
}

export async function ensureDefaultWikiGraphLibrary(): Promise<WikiGraphLibraryRecord> {
  return await withLibraryRegistryDatabase(async (database) => {
    const library = await database.transaction(async () => {
      const existing = await readDefaultLibraryRecord(database);
      if (existing !== undefined) {
        return existing;
      }

      const now = new Date().toISOString();
      const publicId = await createUniqueLibraryPublicId(database);
      const folderPath = resolveDefaultWikiGraphLibraryDirectoryPath();

      await database.run(
        `
          INSERT INTO libraries (public_id, folder_path, is_default, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?)
        `,
        [publicId, folderPath, now, now],
      );

      return await requireDefaultLibraryRecord(database);
    });

    await mkdir(library.folderPath, { recursive: true });
    return library;
  });
}

export async function createWikiGraphLibrary(input: {
  readonly folderPath: string;
}): Promise<WikiGraphLibraryRecord> {
  const folderPath = resolve(input.folderPath);
  if (await pathExists(folderPath)) {
    throw new Error(`Library folder already exists: ${folderPath}`);
  }

  return await withLibraryRegistryDatabase(async (database) => {
    return await database.transaction(async () => {
      const now = new Date().toISOString();
      const publicId = await createUniqueLibraryPublicId(database);

      await database.run(
        `
          INSERT INTO libraries (public_id, folder_path, is_default, created_at, updated_at)
          VALUES (?, ?, 0, ?, ?)
        `,
        [publicId, folderPath, now, now],
      );
      await mkdir(folderPath);

      return await requireLibraryRecordByPublicId(database, publicId);
    });
  });
}

export async function resolveWikiGraphLibrary(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryRecord> {
  if (target.isDefault) {
    return await ensureDefaultWikiGraphLibrary();
  }
  if (target.publicId === undefined) {
    throw new Error("Missing library id.");
  }

  return await withLibraryRegistryDatabase(
    async (database) =>
      await requireLibraryRecordByPublicId(database, target.publicId!),
  );
}

export async function resolveWikiGraphLibraryById(
  id: number,
): Promise<WikiGraphLibraryRecord> {
  return await withLibraryRegistryDatabase(
    async (database) => await requireLibraryRecordById(database, id),
  );
}

export async function listWikiGraphLibraryScope(
  target: ParsedWikiGraphLibraryUri,
): Promise<readonly []> {
  await resolveWikiGraphLibrary(target);
  return [];
}

export async function removeWikiGraphLibrary(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryRecord> {
  const library = await resolveWikiGraphLibrary(target);
  if (library.isDefault) {
    throw new Error(
      "The default library is managed by the system and cannot be removed.",
    );
  }

  await withWikiGraphLibraryLock(library.id, "write", async () => {
    await withLibraryRegistryDatabase(async (database) => {
      await database.transaction(async () => {
        await database.run(
          "DELETE FROM library_metadata WHERE library_id = ?",
          [library.id],
        );
        await database.run("DELETE FROM libraries WHERE id = ?", [library.id]);
      });
    });
  });

  return library;
}

export async function getWikiGraphLibraryMetadata(
  target: ParsedWikiGraphLibraryUri,
): Promise<Readonly<Record<string, unknown>>> {
  const library = await resolveWikiGraphLibrary(target);

  return await withLibraryRegistryDatabase(
    async (database) => await readLibraryMetadataMap(database, library.id),
  );
}

export async function replaceWikiGraphLibraryMetadata(
  target: ParsedWikiGraphLibraryUri,
  map: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  rejectReservedMetadataKeys(Object.keys(map));
  const library = await resolveWikiGraphLibrary(target);

  return await withLibraryRegistryDatabase(async (database) => {
    await database.transaction(async () => {
      await database.run("DELETE FROM library_metadata WHERE library_id = ?", [
        library.id,
      ]);
      for (const [key, value] of Object.entries(map)) {
        await putLibraryMetadata(database, library.id, key, value);
      }
    });
    return await readLibraryMetadataMap(database, library.id);
  });
}

export async function putWikiGraphLibraryMetadata(
  target: ParsedWikiGraphLibraryUri,
  key: string,
  value: unknown,
): Promise<Readonly<Record<string, unknown>>> {
  rejectReservedMetadataKeys([key]);
  const library = await resolveWikiGraphLibrary(target);

  return await withLibraryRegistryDatabase(async (database) => {
    await putLibraryMetadata(database, library.id, key, value);
    return await readLibraryMetadataMap(database, library.id);
  });
}

export async function deleteWikiGraphLibraryMetadataKey(
  target: ParsedWikiGraphLibraryUri,
  key: string,
): Promise<Readonly<Record<string, unknown>>> {
  const library = await resolveWikiGraphLibrary(target);

  return await withLibraryRegistryDatabase(async (database) => {
    await database.run(
      "DELETE FROM library_metadata WHERE library_id = ? AND key = ?",
      [library.id, key],
    );
    return await readLibraryMetadataMap(database, library.id);
  });
}

export async function clearWikiGraphLibraryMetadata(
  target: ParsedWikiGraphLibraryUri,
): Promise<Readonly<Record<string, unknown>>> {
  const library = await resolveWikiGraphLibrary(target);

  return await withLibraryRegistryDatabase(async (database) => {
    await database.run("DELETE FROM library_metadata WHERE library_id = ?", [
      library.id,
    ]);
    return await readLibraryMetadataMap(database, library.id);
  });
}

async function withLibraryRegistryDatabase<T>(
  operation: (database: Database) => Promise<T>,
): Promise<T> {
  const database = await openSharedStateDatabase(
    resolveWikiGraphCoreDatabasePath(),
    LIBRARY_REGISTRY_SCHEMA_SQL,
  );

  try {
    return await operation(database);
  } finally {
    await database.close();
  }
}

async function readDefaultLibraryRecord(
  database: Database,
): Promise<WikiGraphLibraryRecord | undefined> {
  return await database.queryOne(
    `
      SELECT id, public_id, folder_path, is_default, created_at, updated_at
      FROM libraries
      WHERE is_default = 1
    `,
    undefined,
    mapLibraryRecord,
  );
}

async function requireDefaultLibraryRecord(
  database: Database,
): Promise<WikiGraphLibraryRecord> {
  const record = await readDefaultLibraryRecord(database);
  if (record === undefined) {
    throw new Error("Default library registry record is missing.");
  }
  return record;
}

async function requireLibraryRecordByPublicId(
  database: Database,
  publicId: string,
): Promise<WikiGraphLibraryRecord> {
  const record = await database.queryOne(
    `
      SELECT id, public_id, folder_path, is_default, created_at, updated_at
      FROM libraries
      WHERE public_id = ?
    `,
    [publicId],
    mapLibraryRecord,
  );

  if (record === undefined) {
    throw new Error(`Unknown Wiki Graph library: ${publicId}`);
  }
  return record;
}

async function requireLibraryRecordById(
  database: Database,
  id: number,
): Promise<WikiGraphLibraryRecord> {
  const record = await database.queryOne(
    `
      SELECT id, public_id, folder_path, is_default, created_at, updated_at
      FROM libraries
      WHERE id = ?
    `,
    [id],
    mapLibraryRecord,
  );

  if (record === undefined) {
    throw new Error(`Unknown Wiki Graph library: ${id}`);
  }

  return record;
}

function mapLibraryRecord(row: SqlRow): WikiGraphLibraryRecord {
  const id = getNumber(row, "id");
  const publicId = getString(row, "public_id");
  return {
    createdAt: getString(row, "created_at"),
    folderPath: getString(row, "folder_path"),
    id,
    isDefault: getNumber(row, "is_default") === 1,
    publicId,
    stagingPath: resolveWikiGraphLibraryStagingDirectoryPath(id),
    updatedAt: getString(row, "updated_at"),
    uri: formatWikiGraphLibraryUri(
      getNumber(row, "is_default") === 1 ? undefined : publicId,
    ),
  };
}

async function readLibraryMetadataMap(
  database: Database,
  libraryId: number,
): Promise<Readonly<Record<string, unknown>>> {
  const rows = await database.queryAll(
    `
      SELECT key, value_json
      FROM library_metadata
      WHERE library_id = ?
      ORDER BY key
    `,
    [libraryId],
    (row) => ({
      key: getString(row, "key"),
      value: JSON.parse(getString(row, "value_json")) as unknown,
    }),
  );
  const map: Record<string, unknown> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

async function putLibraryMetadata(
  database: Database,
  libraryId: number,
  key: string,
  value: unknown,
): Promise<void> {
  await database.run(
    `
      INSERT INTO library_metadata (library_id, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(library_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `,
    [libraryId, key, JSON.stringify(value), new Date().toISOString()],
  );
}

async function createUniqueLibraryPublicId(
  database: Database,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const publicId = randomBytes(PUBLIC_ID_BYTES).toString("hex");
    const existing = await database.queryOne(
      "SELECT public_id FROM libraries WHERE public_id = ?",
      [publicId],
      (row) => getString(row, "public_id"),
    );
    if (existing === undefined) {
      return publicId;
    }
  }
  throw new Error("Could not generate a unique library id.");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function rejectReservedMetadataKeys(keys: readonly string[]): void {
  const reserved = keys.find((key) => RESERVED_METADATA_KEYS.has(key));
  if (reserved !== undefined) {
    throw new Error(`Library metadata cannot modify system field: ${reserved}`);
  }
}

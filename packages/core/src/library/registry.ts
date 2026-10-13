import {
  ensureRelativeDirectory,
  getWikiGraphPlatform,
  getWikiGraphStorage,
  type Directory,
} from "../runtime/platform/index.js";

import {
  getNumber,
  getString,
  type Database,
  type SqlRow,
} from "../document/database.js";
import { openWikiGraphStateDatabase } from "../document/index.js";
import {
  parseWikiGraphUriSyntax,
  WIKI_GRAPH_ARCHIVE_EXTENSION,
} from "../runtime/common/wiki-graph/uri.js";
import { bytesToHex } from "../utils/bytes.js";
import { randomBytes } from "../utils/crypto.js";
import { withWikiGraphLibraryLock } from "./lock.js";
import { RESERVED_LIBRARY_URI_SEGMENTS } from "./segments.js";

const DEFAULT_LIBRARY_FOLDER_NAME = "default-library";
const PUBLIC_ID_BYTES = 6;
let registryOperationQueue: Promise<void> = Promise.resolve();

const RESERVED_METADATA_KEYS = new Set([
  "id",
  "public_id",
  "publicId",
  "folder_path",
  "folderPath",
  "folder_identity",
  "folderIdentity",
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
    folder_identity TEXT NOT NULL UNIQUE,
    physical_identity TEXT,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_libraries_single_default
  ON libraries(is_default)
  WHERE is_default = 1;
  CREATE INDEX IF NOT EXISTS idx_libraries_physical_identity ON libraries(physical_identity);

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
  readonly folder: Directory;
  readonly isDefault: boolean;
  readonly staging: Directory;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ParsedWikiGraphLibraryUri {
  readonly archivePublicId?: string;
  readonly kind:
    | "archive"
    | "archive-collection"
    | "archive-path"
    | "archive-tree"
    | "metadata"
    | "path"
    | "registry"
    | "scope";
  readonly objectUri?: string;
  readonly publicId?: string;
  readonly isDefault: boolean;
}

export function isWikiGraphLibraryUri(uri: string | undefined): uri is string {
  if (uri === undefined) {
    return false;
  }
  try {
    const syntax = parseWikiGraphUriSyntax(uri);
    if (syntax.protocol !== "wikg" || syntax.path[0] !== "lib") {
      return false;
    }
    if (syntax.path.some((segment) => segment.endsWith(".lib"))) {
      return true;
    }
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
  if (!uri.includes("://")) {
    return undefined;
  }
  const parsed = parseWikiGraphUriSyntax(uri);
  if (parsed.protocol !== "wikg" || parsed.path[0] !== "lib") {
    return undefined;
  }

  const segments = parsed.path.slice(1);
  const fragment = formatWikiGraphUriFragment(parsed.fragment);

  if (segments.length === 0) {
    rejectLibraryStructureFragment(uri, fragment);
    return { isDefault: true, kind: "scope" };
  }
  if (segments.some((part) => part.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION))) {
    return undefined;
  }

  if (segments.some((segment) => segment.endsWith(".lib"))) {
    throw new Error(
      `Invalid Wiki Graph library URI: ${uri}. Use wikg://lib/<lib-id> and wikg://lib/<lib-id>/arc/<arc-id>; .lib suffixes are no longer supported.`,
    );
  }

  const [first, second, third, ...rest] = segments;
  if (first === "registry" && second === undefined) {
    rejectLibraryStructureFragment(uri, fragment);
    return { isDefault: true, kind: "registry" };
  }
  if (first === "meta" && second === undefined) {
    rejectLibraryStructureFragment(uri, fragment);
    return { isDefault: true, kind: "metadata" };
  }
  if (first === "path" && second === undefined) {
    rejectLibraryStructureFragment(uri, fragment);
    return { isDefault: true, kind: "path" };
  }

  const defaultLibraryScopeMatch =
    /^(index|chapter|chunk|entity|triple)$/u.exec(first ?? "");
  if (defaultLibraryScopeMatch?.[1] !== undefined) {
    return {
      isDefault: true,
      kind: "scope",
      objectUri: formatWikiGraphLibraryObjectUri(
        [first, second, third, ...rest].filter(Boolean).join("/"),
        fragment,
      ),
    };
  }

  if (first === "arc") {
    return parseLibraryArcUri(uri, undefined, segments.slice(1), fragment);
  }

  if (first === undefined || RESERVED_LIBRARY_URI_SEGMENTS.has(first)) {
    throw new Error(
      `Invalid Wiki Graph library URI: ${uri}. Reserved library URI segment: ${first ?? ""}.`,
    );
  }
  if (second === undefined) {
    rejectLibraryStructureFragment(uri, fragment);
    return { isDefault: false, kind: "scope", publicId: first };
  }
  if (second === "meta" && third === undefined) {
    rejectLibraryStructureFragment(uri, fragment);
    return { isDefault: false, kind: "metadata", publicId: first };
  }
  if (second === "path" && third === undefined) {
    rejectLibraryStructureFragment(uri, fragment);
    return { isDefault: false, kind: "path", publicId: first };
  }
  if (/^(index|chapter|chunk|entity|triple)$/u.test(second)) {
    return {
      isDefault: false,
      kind: "scope",
      objectUri: formatWikiGraphLibraryObjectUri(
        [second, third, ...rest].filter(Boolean).join("/"),
        fragment,
      ),
      publicId: first,
    };
  }
  if (second === "arc") {
    return parseLibraryArcUri(uri, first, segments.slice(2), fragment);
  }

  throw new Error(
    `Invalid Wiki Graph library URI: ${uri}. Expected wikg://lib, wikg://lib/registry, wikg://lib/<lib-id>, or <lib-scope>/arc/<arc-id>.`,
  );
}

function parseLibraryArcUri(
  uri: string,
  publicId: string | undefined,
  segments: readonly string[],
  fragment: string | undefined,
): ParsedWikiGraphLibraryUri {
  const isDefault = publicId === undefined;
  const [first, second, ...rest] = segments;
  const base = { isDefault, ...(publicId === undefined ? {} : { publicId }) };
  if (first === undefined) {
    rejectLibraryStructureFragment(uri, fragment);
    return { ...base, kind: "archive-collection" };
  }
  if (/^(chapter|chunk|entity|triple)$/u.test(first)) {
    return {
      ...base,
      kind: "scope",
      objectUri: formatWikiGraphLibraryObjectUri(
        [first, second, ...rest].filter(Boolean).join("/"),
        fragment,
      ),
    };
  }
  if (first === "tree" && second === undefined) {
    rejectLibraryStructureFragment(uri, fragment);
    return { ...base, kind: "archive-tree" };
  }
  if (RESERVED_LIBRARY_URI_SEGMENTS.has(first)) {
    throw new Error(
      `Invalid Wiki Graph library URI: ${uri}. Reserved archive member URI segment: ${first}.`,
    );
  }
  if (second === undefined) {
    rejectLibraryStructureFragment(uri, fragment);
    return { ...base, archivePublicId: first, kind: "archive" };
  }
  if (second === "path" && rest.length === 0) {
    rejectLibraryStructureFragment(uri, fragment);
    return { ...base, archivePublicId: first, kind: "archive-path" };
  }
  return {
    ...base,
    archivePublicId: first,
    kind: "archive",
    objectUri: formatWikiGraphLibraryObjectUri(
      [second, ...rest].join("/"),
      fragment,
    ),
  };
}

function rejectLibraryStructureFragment(
  uri: string,
  fragment: string | undefined,
): void {
  if (fragment !== undefined) {
    throw new Error(
      `Invalid Wiki Graph library URI: ${uri}. This library URI target does not support fragments.`,
    );
  }
}

function formatWikiGraphLibraryObjectUri(
  path: string,
  fragment?: string,
): string {
  return `wikg://${path.replace(/^\/+|\/+$/gu, "")}${
    fragment === undefined ? "" : `#${fragment}`
  }`;
}

function formatWikiGraphUriFragment(
  fragment:
    | number
    | { readonly begin: number; readonly end: number }
    | { readonly raw: string }
    | undefined,
): string | undefined {
  if (fragment === undefined) {
    return undefined;
  }
  if (typeof fragment === "number") {
    return String(fragment);
  }
  if ("raw" in fragment) {
    return fragment.raw;
  }

  return `${fragment.begin}..${fragment.end}`;
}

export function formatWikiGraphLibraryUri(publicId?: string): string {
  return publicId === undefined ? "wikg://lib" : `wikg://lib/${publicId}`;
}

export async function resolveDefaultWikiGraphLibraryDirectory(): Promise<Directory> {
  return await ensureRelativeDirectory(
    getWikiGraphStorage().library,
    DEFAULT_LIBRARY_FOLDER_NAME,
  );
}

export async function resolveWikiGraphLibraryStagingDirectory(
  id: number,
): Promise<Directory> {
  return await ensureRelativeDirectory(
    getWikiGraphStorage().library,
    `staging/library/${id}`,
  );
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
      const folder = await resolveDefaultWikiGraphLibraryDirectory();

      await database.run(
        `
          INSERT INTO libraries (public_id, folder_identity, is_default, created_at, updated_at, physical_identity)
          VALUES (?, ?, 1, ?, ?, ?)
        `,
        [
          publicId,
          folder.identity,
          now,
          now,
          (await folder.getPhysicalIdentity?.()) ?? null,
        ],
      );

      return await requireDefaultLibraryRecord(database);
    });

    return library;
  });
}

export async function createWikiGraphLibrary(input: {
  readonly folder: Directory;
}): Promise<WikiGraphLibraryRecord> {
  return await withLibraryRegistryDatabase(async (database) => {
    return await database.transaction(async () => {
      const now = new Date().toISOString();
      const publicId = await createUniqueLibraryPublicId(database);

      await database.run(
        `
          INSERT INTO libraries (public_id, folder_identity, is_default, created_at, updated_at, physical_identity)
          VALUES (?, ?, 0, ?, ?, ?)
        `,
        [
          publicId,
          input.folder.identity,
          now,
          now,
          (await input.folder.getPhysicalIdentity?.()) ?? null,
        ],
      );

      return await requireLibraryRecordByPublicId(database, publicId);
    });
  });
}

export async function listWikiGraphLibraries(): Promise<
  readonly WikiGraphLibraryRecord[]
> {
  await ensureDefaultWikiGraphLibrary();
  return await withLibraryRegistryDatabase(async (database) => {
    const rows = await database.queryAll(
      `
          SELECT id, public_id, folder_identity, is_default, created_at, updated_at
          FROM libraries
          ORDER BY is_default DESC, public_id
        `,
      undefined,
      (row) => row,
    );
    return await Promise.all(rows.map(mapLibraryRecord));
  });
}

/** Indexed lookup for Node aliases; does not enumerate unrelated libraries. */
export async function findWikiGraphLibraryByPhysicalIdentity(
  identity: string | undefined,
  folderIdentity?: string,
): Promise<WikiGraphLibraryRecord | undefined> {
  return await withLibraryRegistryDatabase(async (database) => {
    const row = await database.queryOne(
      "SELECT * FROM libraries WHERE folder_identity = ? OR physical_identity = ? ORDER BY (folder_identity = ?) DESC LIMIT 1",
      [folderIdentity ?? null, identity ?? null, folderIdentity ?? null],
      (row) => row,
    );
    if (row === undefined) return undefined;
    const record = await mapLibraryRecord(row);
    return record.folder.identity === folderIdentity ||
      (identity !== undefined &&
        (await record.folder.getPhysicalIdentity?.()) === identity)
      ? record
      : undefined;
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

export async function resolveWikiGraphLibraryForScan(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryRecord> {
  if (!target.isDefault) {
    return await resolveWikiGraphLibrary(target);
  }

  const existing = await withLibraryRegistryDatabase(
    async (database) => await readDefaultLibraryRecord(database),
  );
  return existing ?? (await ensureDefaultWikiGraphLibrary());
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

export async function updateWikiGraphLibraryFolderForRebind(
  library: WikiGraphLibraryRecord,
  folder: Directory,
): Promise<WikiGraphLibraryRecord> {
  return await withLibraryRegistryDatabase(async (database) => {
    return await database.transaction(async () => {
      const existing = await database.queryOne(
        "SELECT id FROM libraries WHERE folder_identity = ?",
        [folder.identity],
        (row) => getNumber(row, "id"),
      );
      if (existing !== undefined && existing !== library.id) {
        throw new Error(
          "Library Directory is already bound to another library",
        );
      }

      await database.run(
        "UPDATE libraries SET folder_identity = ?, updated_at = ?, physical_identity = ? WHERE id = ?",
        [
          folder.identity,
          new Date().toISOString(),
          (await folder.getPhysicalIdentity?.()) ?? null,
          library.id,
        ],
      );
      return await requireLibraryRecordById(database, library.id);
    });
  });
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
  const previous = registryOperationQueue;
  let release!: () => void;
  registryOperationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const database = await openWikiGraphStateDatabase(
      "core.sqlite",
      LIBRARY_REGISTRY_SCHEMA_SQL,
    );
    try {
      return await operation(database);
    } finally {
      await database.close();
    }
  } finally {
    release();
  }
}

async function readDefaultLibraryRecord(
  database: Database,
): Promise<WikiGraphLibraryRecord | undefined> {
  const row = await database.queryOne(
    `
      SELECT id, public_id, folder_identity, is_default, created_at, updated_at
      FROM libraries
      WHERE is_default = 1
    `,
    undefined,
    (row) => row,
  );
  return row === undefined ? undefined : await mapLibraryRecord(row);
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
  const row = await database.queryOne(
    `
      SELECT id, public_id, folder_identity, is_default, created_at, updated_at
      FROM libraries
      WHERE public_id = ?
    `,
    [publicId],
    (row) => row,
  );

  if (row === undefined) {
    throw new Error(`Unknown Wiki Graph library: ${publicId}`);
  }
  return await mapLibraryRecord(row);
}

async function requireLibraryRecordById(
  database: Database,
  id: number,
): Promise<WikiGraphLibraryRecord> {
  const row = await database.queryOne(
    `
      SELECT id, public_id, folder_identity, is_default, created_at, updated_at
      FROM libraries
      WHERE id = ?
    `,
    [id],
    (row) => row,
  );

  if (row === undefined) {
    throw new Error(`Unknown Wiki Graph library: ${id}`);
  }

  return await mapLibraryRecord(row);
}

async function mapLibraryRecord(row: SqlRow): Promise<WikiGraphLibraryRecord> {
  const id = getNumber(row, "id");
  const publicId = getString(row, "public_id");
  const folderIdentity = getString(row, "folder_identity");
  const folder =
    await getWikiGraphPlatform().resources.getDirectory(folderIdentity);
  if (folder === undefined) {
    throw new Error(`Library Directory is unavailable: ${folderIdentity}`);
  }
  return {
    createdAt: getString(row, "created_at"),
    folder,
    id,
    isDefault: getNumber(row, "is_default") === 1,
    publicId,
    staging: await resolveWikiGraphLibraryStagingDirectory(id),
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
    const publicId = bytesToHex(randomBytes(PUBLIC_ID_BYTES));
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

function rejectReservedMetadataKeys(keys: readonly string[]): void {
  const reserved = keys.find((key) => RESERVED_METADATA_KEYS.has(key));
  if (reserved !== undefined) {
    throw new Error(`Library metadata cannot modify system field: ${reserved}`);
  }
}

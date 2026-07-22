import { randomBytes } from "crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";

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
const LIBRARY_SCOPE_HEADS = new Set([
  "chapter",
  "chunk",
  "entity",
  "source",
  "summary",
  "triple",
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

  CREATE TABLE IF NOT EXISTS library_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL,
    public_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(library_id, public_id),
    UNIQUE(library_id, relative_path)
  );

  CREATE INDEX IF NOT EXISTS idx_library_archives_library
  ON library_archives(library_id);
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

export interface WikiGraphLibraryArchiveRecord {
  readonly id: number;
  readonly publicId: string;
  readonly uri: string;
  readonly libraryId: number;
  readonly libraryPublicId: string;
  readonly libraryUri: string;
  readonly relativePath: string;
  readonly archivePath: string;
  readonly status: "present" | "missing";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WikiGraphLibraryScanResult {
  readonly library: WikiGraphLibraryRecord;
  readonly items: readonly WikiGraphLibraryArchiveRecord[];
}

export interface WikiGraphLibraryArchiveMutationResult {
  readonly archive: WikiGraphLibraryArchiveRecord;
  readonly missing?: boolean;
}

export function isWikiGraphLibraryUri(uri: string | undefined): uri is string {
  if (uri === "wikg://lib") {
    return true;
  }
  if (uri?.startsWith("wikg://lib/") !== true) {
    return false;
  }

  return !uri
    .slice("wikg://lib/".length)
    .split("/")
    .some((part) => part.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION));
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
  const parts = path.split("/").filter((part) => part !== "");
  const explicitLibraryMatch = /^([^/]+)\.lib$/u.exec(parts[0] ?? "");
  if (explicitLibraryMatch?.[1] !== undefined) {
    const publicId = explicitLibraryMatch[1];
    const tail = parts.slice(1);
    if (tail.length === 0 || (tail.length === 1 && tail[0] === "meta")) {
      return {
        isDefault: false,
        kind: tail[0] === "meta" ? "metadata" : "scope",
        publicId,
      };
    }
    if (isLibraryScopeTail(tail)) {
      return {
        isDefault: false,
        kind: "scope",
        objectUri: formatWikiGraphObjectUri(tail.join("/")),
        publicId,
      };
    }
    return {
      archivePublicId: tail[0]!,
      isDefault: false,
      kind: "archive",
      ...formatOptionalObjectUriProperty(tail.slice(1)),
      publicId,
    };
  }

  if (isLibraryScopeTail(parts)) {
    return {
      isDefault: true,
      kind: "scope",
      objectUri: formatWikiGraphObjectUri(parts.join("/")),
    };
  }
  if (parts.length > 0) {
    return {
      archivePublicId: parts[0]!,
      isDefault: true,
      kind: "archive",
      ...formatOptionalObjectUriProperty(parts.slice(1)),
    };
  }

  if (/^[^/.][^/]*(?:\/meta)?$/u.test(path)) {
    throw new Error(
      "Specified library URIs must use the .lib suffix: wikg://lib/<lib-id>.lib",
    );
  }

  throw new Error(
    `Invalid Wiki Graph library URI: ${uri}. Expected wikg://lib, wikg://lib/meta, wikg://lib/<lib-id>.lib, wikg://lib/<lib-id>.lib/meta, or a library archive/scope URI.`,
  );
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

export async function listWikiGraphLibraryScope(
  target: ParsedWikiGraphLibraryUri,
): Promise<readonly WikiGraphLibraryArchiveRecord[]> {
  const library = await resolveWikiGraphLibrary(target);
  return await withLibraryRegistryDatabase(
    async (database) => await readLibraryArchiveRecords(database, library),
  );
}

export async function scanWikiGraphLibraryArchives(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryScanResult> {
  const library = await resolveWikiGraphLibrary(target);
  await mkdir(library.folderPath, { recursive: true });
  const relativePaths = await listWikgFiles(library.folderPath);
  const now = new Date().toISOString();
  const items = await withLibraryRegistryDatabase(async (database) => {
    await database.transaction(async () => {
      for (const relativePath of relativePaths) {
        const existing = await readLibraryArchiveRecordByRelativePath(
          database,
          library,
          relativePath,
        );
        if (existing === undefined) {
          await database.run(
            `
              INSERT INTO library_archives (library_id, public_id, relative_path, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
            `,
            [
              library.id,
              await createUniqueLibraryArchivePublicId(database, library.id),
              relativePath,
              now,
              now,
            ],
          );
        } else {
          await database.run(
            "UPDATE library_archives SET updated_at = ? WHERE id = ?",
            [now, existing.id],
          );
        }
      }
    });
    return await readLibraryArchiveRecords(database, library);
  });
  return { items, library };
}

export async function addWikiGraphArchiveToLibrary(input: {
  readonly target: ParsedWikiGraphLibraryUri;
  readonly inputPath: string;
  readonly to?: string;
  readonly cwd?: string;
}): Promise<WikiGraphLibraryArchiveMutationResult> {
  if (input.inputPath.startsWith("wikg://")) {
    throw new Error(
      "Library add --input accepts a file path, not a wikg:// URI.",
    );
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(input.inputPath)) {
    throw new Error("Library add does not support URL inputs yet.");
  }
  const library = await resolveWikiGraphLibrary(input.target);
  const cwd = input.cwd ?? process.cwd();
  const sourcePath = isAbsolute(input.inputPath)
    ? resolve(input.inputPath)
    : resolve(cwd, input.inputPath);
  await assertReadableWikgFile(sourcePath, "Library add input");
  const relativePath = assertSafeLibraryArchiveRelativePath(
    input.to ?? basename(sourcePath),
  );
  const archivePath = await resolveSafeLibraryArchivePath(
    library,
    relativePath,
    {
      mustNotExist: true,
    },
  );
  await mkdir(dirname(archivePath), { recursive: true });
  await copyFile(sourcePath, archivePath);
  assertInsideLibrary(
    await realpath(archivePath),
    await realpath(library.folderPath),
  );
  const archive = await registerLibraryArchivePath(library, relativePath);
  return { archive };
}

export async function removeWikiGraphLibraryArchive(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryArchiveMutationResult> {
  const { archive } = await resolveWikiGraphLibraryArchive(target);
  const missing = !(await pathExists(archive.archivePath));
  if (!missing) {
    await rm(archive.archivePath);
  }
  await withLibraryRegistryDatabase(async (database) => {
    await database.run("DELETE FROM library_archives WHERE id = ?", [
      archive.id,
    ]);
  });
  return {
    archive: { ...archive, status: missing ? "missing" : archive.status },
    ...(missing ? { missing: true } : {}),
  };
}

export async function moveWikiGraphLibraryArchive(input: {
  readonly target: ParsedWikiGraphLibraryUri;
  readonly to: string;
}): Promise<WikiGraphLibraryArchiveMutationResult> {
  const { archive, library } = await resolveWikiGraphLibraryArchive(
    input.target,
  );
  if (!(await pathExists(archive.archivePath))) {
    throw new Error(`Library archive file is missing: ${archive.relativePath}`);
  }
  const relativePath = assertSafeLibraryArchiveRelativePath(input.to);
  const toPath = await resolveSafeLibraryArchivePath(library, relativePath, {
    mustNotExist: true,
  });
  await mkdir(dirname(toPath), { recursive: true });
  await rename(archive.archivePath, toPath);
  const updated = await withLibraryRegistryDatabase(async (database) => {
    const now = new Date().toISOString();
    await database.run(
      "UPDATE library_archives SET relative_path = ?, updated_at = ? WHERE id = ?",
      [relativePath, now, archive.id],
    );
    return await requireLibraryArchiveRecordByPublicId(
      database,
      library,
      archive.publicId,
    );
  });
  return { archive: updated };
}

export async function resolveWikiGraphLibraryArchive(
  target: ParsedWikiGraphLibraryUri,
): Promise<{
  readonly library: WikiGraphLibraryRecord;
  readonly archive: WikiGraphLibraryArchiveRecord;
}> {
  if (target.kind !== "archive" || target.archivePublicId === undefined) {
    throw new Error("Expected a library archive URI.");
  }
  const library = await resolveWikiGraphLibrary(target);
  const archive = await withLibraryRegistryDatabase(
    async (database) =>
      await requireLibraryArchiveRecordByPublicId(
        database,
        library,
        target.archivePublicId!,
      ),
  );
  return { archive, library };
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

  await withLibraryRegistryDatabase(async (database) => {
    await database.transaction(async () => {
      await database.run("DELETE FROM library_metadata WHERE library_id = ?", [
        library.id,
      ]);
      await database.run("DELETE FROM library_archives WHERE library_id = ?", [
        library.id,
      ]);
      await database.run("DELETE FROM libraries WHERE id = ?", [library.id]);
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

async function readLibraryArchiveRecords(
  database: Database,
  library: WikiGraphLibraryRecord,
): Promise<readonly WikiGraphLibraryArchiveRecord[]> {
  const records = await database.queryAll(
    `
      SELECT id, library_id, public_id, relative_path, created_at, updated_at
      FROM library_archives
      WHERE library_id = ?
      ORDER BY relative_path
    `,
    [library.id],
    (row) => mapLibraryArchiveRecord(row, library),
  );
  return await Promise.all(records.map(withLibraryArchiveStatus));
}

async function readLibraryArchiveRecordByRelativePath(
  database: Database,
  library: WikiGraphLibraryRecord,
  relativePath: string,
): Promise<WikiGraphLibraryArchiveRecord | undefined> {
  const record = await database.queryOne(
    `
      SELECT id, library_id, public_id, relative_path, created_at, updated_at
      FROM library_archives
      WHERE library_id = ? AND relative_path = ?
    `,
    [library.id, relativePath],
    (row) => mapLibraryArchiveRecord(row, library),
  );
  return record === undefined
    ? undefined
    : await withLibraryArchiveStatus(record);
}

async function requireLibraryArchiveRecordByPublicId(
  database: Database,
  library: WikiGraphLibraryRecord,
  publicId: string,
): Promise<WikiGraphLibraryArchiveRecord> {
  const record = await database.queryOne(
    `
      SELECT id, library_id, public_id, relative_path, created_at, updated_at
      FROM library_archives
      WHERE library_id = ? AND public_id = ?
    `,
    [library.id, publicId],
    (row) => mapLibraryArchiveRecord(row, library),
  );
  if (record === undefined) {
    throw new Error(`Unknown Wiki Graph library archive: ${publicId}`);
  }
  return await withLibraryArchiveStatus(record);
}

function mapLibraryArchiveRecord(
  row: SqlRow,
  library: WikiGraphLibraryRecord,
): WikiGraphLibraryArchiveRecord {
  const publicId = getString(row, "public_id");
  const relativePath = getString(row, "relative_path");
  const archivePath = join(library.folderPath, relativePath);
  return {
    archivePath,
    createdAt: getString(row, "created_at"),
    id: getNumber(row, "id"),
    libraryId: getNumber(row, "library_id"),
    libraryPublicId: library.publicId,
    libraryUri: library.uri,
    publicId,
    relativePath,
    status: "present",
    updatedAt: getString(row, "updated_at"),
    uri: `${library.uri}/${publicId}`,
  };
}

async function withLibraryArchiveStatus(
  archive: WikiGraphLibraryArchiveRecord,
): Promise<WikiGraphLibraryArchiveRecord> {
  return {
    ...archive,
    status: (await pathExists(archive.archivePath)) ? "present" : "missing",
  };
}

async function registerLibraryArchivePath(
  library: WikiGraphLibraryRecord,
  relativePath: string,
): Promise<WikiGraphLibraryArchiveRecord> {
  return await withLibraryRegistryDatabase(async (database) => {
    const now = new Date().toISOString();
    await database.run(
      `
        INSERT INTO library_archives (library_id, public_id, relative_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        library.id,
        await createUniqueLibraryArchivePublicId(database, library.id),
        relativePath,
        now,
        now,
      ],
    );
    const record = await readLibraryArchiveRecordByRelativePath(
      database,
      library,
      relativePath,
    );
    if (record === undefined) {
      throw new Error("Library archive registry insert failed.");
    }
    return record;
  });
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

async function createUniqueLibraryArchivePublicId(
  database: Database,
  libraryId: number,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const publicId = randomBytes(PUBLIC_ID_BYTES).toString("hex");
    const existing = await database.queryOne(
      "SELECT public_id FROM library_archives WHERE library_id = ? AND public_id = ?",
      [libraryId, publicId],
      (row) => getString(row, "public_id"),
    );
    if (existing === undefined) {
      return publicId;
    }
  }
  throw new Error("Could not generate a unique library archive id.");
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

function isLibraryScopeTail(parts: readonly string[]): boolean {
  return parts.length > 0 && LIBRARY_SCOPE_HEADS.has(parts[0]!);
}

function formatOptionalObjectUri(parts: readonly string[]): string | undefined {
  return parts.length === 0
    ? undefined
    : formatWikiGraphObjectUri(parts.join("/"));
}

function formatOptionalObjectUriProperty(parts: readonly string[]): {
  readonly objectUri?: string;
} {
  const objectUri = formatOptionalObjectUri(parts);
  return objectUri === undefined ? {} : { objectUri };
}

function formatWikiGraphObjectUri(path: string): string {
  return `wikg://${path.replace(/^\/+|\/+$/gu, "")}`;
}

async function listWikgFiles(rootPath: string): Promise<readonly string[]> {
  const rootRealPath = await realpath(rootPath);
  const results: string[] = [];
  await walkLibraryDirectory(rootRealPath, rootRealPath, results);
  return results.sort((a, b) => a.localeCompare(b));
}

async function walkLibraryDirectory(
  rootRealPath: string,
  directoryPath: string,
  results: string[],
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const childRealPath = await realpath(path);
      assertInsideLibrary(childRealPath, rootRealPath);
      await walkLibraryDirectory(rootRealPath, childRealPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION)) {
      results.push(toLibraryRelativePath(rootRealPath, path));
    }
  }
}

async function assertReadableWikgFile(
  path: string,
  label: string,
): Promise<void> {
  if (!path.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION)) {
    throw new Error(`${label} must be a .wikg file.`);
  }
  const stats = await lstat(path);
  if (!stats.isFile()) {
    throw new Error(`${label} must be a regular .wikg file.`);
  }
}

function assertSafeLibraryArchiveRelativePath(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (normalized === "") {
    throw new Error("Library archive path cannot be empty.");
  }
  if (isAbsolute(path) || normalized.split("/").includes("..")) {
    throw new Error(
      "Library archive path must stay inside the library folder.",
    );
  }
  if (!normalized.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION)) {
    throw new Error("Library archive path must end with .wikg.");
  }
  return normalized;
}

async function resolveSafeLibraryArchivePath(
  library: WikiGraphLibraryRecord,
  relativePath: string,
  options: { readonly mustNotExist: boolean },
): Promise<string> {
  const rootRealPath = await realpath(library.folderPath);
  const archivePath = resolve(rootRealPath, relativePath);
  assertInsideLibrary(archivePath, rootRealPath);
  const parent = dirname(archivePath);
  if (await pathExists(parent)) {
    assertInsideLibrary(await realpath(parent), rootRealPath);
  }
  if (options.mustNotExist && (await pathExists(archivePath))) {
    throw new Error(`Library archive already exists: ${relativePath}`);
  }
  return archivePath;
}

function assertInsideLibrary(path: string, rootPath: string): void {
  const resolvedRoot = resolve(rootPath);
  const resolvedPath = resolve(path);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return;
  }
  throw new Error("Library archive path must stay inside the library folder.");
}

function toLibraryRelativePath(rootPath: string, path: string): string {
  return relative(rootPath, path).split(sep).join("/");
}

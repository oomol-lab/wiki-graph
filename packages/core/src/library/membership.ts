import { randomBytes } from "crypto";
import {
  constants,
  copyFile,
  mkdir,
  opendir,
  realpath,
  rename,
  rm,
  stat,
} from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "path";

import {
  getNumber,
  getOptionalString,
  getString,
  type Database,
  type SqlRow,
} from "../document/database.js";
import { openSharedStateDatabase } from "../document/index.js";
import { resolveWikiGraphCoreDatabasePath } from "../runtime/common/wiki-graph/dir.js";
import { WIKI_GRAPH_ARCHIVE_EXTENSION } from "../runtime/common/wiki-graph/uri.js";
import { readWikgArchiveMutationToken } from "../storage/wikg/index.js";
import { isNodeError } from "../utils/node-error.js";
import {
  parseWikiGraphLibraryUri,
  resolveWikiGraphLibrary,
  updateWikiGraphLibraryFolderPathForRebind,
  type ParsedWikiGraphLibraryUri,
  type WikiGraphLibraryRecord,
} from "./registry.js";
import { markWikiGraphLibraryIndexDirty } from "./search-index.js";
import { withWikiGraphLibraryLock } from "./lock.js";

const PUBLIC_ID_BYTES = 6;
const LIBRARY_ARCHIVE_MEMBERSHIP_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS library_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL,
    public_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'present',
    last_seen_mutation_token TEXT,
    last_seen_size INTEGER,
    last_seen_mtime_ms INTEGER,
    last_scanned_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(library_id, public_id)
  );

  CREATE INDEX IF NOT EXISTS idx_library_archives_library
  ON library_archives(library_id);

  CREATE INDEX IF NOT EXISTS idx_library_archives_library_path
  ON library_archives(library_id, relative_path);
`;

type LibraryPathIdentityMode = "trusted" | "untrusted";

type WikiGraphLibraryArchiveStatus = "conflict" | "missing" | "present";

export interface WikiGraphLibraryArchiveRecord {
  readonly id: number;
  readonly publicId: string;
  readonly uri: string;
  readonly libraryId: number;
  readonly libraryUri: string;
  readonly relativePath: string;
  readonly path: string;
  readonly exists: boolean;
  readonly status: WikiGraphLibraryArchiveStatus;
  readonly lastSeenMutationToken?: string;
  readonly lastSeenSize?: number;
  readonly lastSeenMtimeMs?: number;
  readonly lastScannedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WikiGraphLibraryScanResult {
  readonly library: WikiGraphLibraryRecord;
  readonly archives: readonly WikiGraphLibraryArchiveRecord[];
}

interface DiscoveredLibraryArchiveFile {
  readonly relativePath: string;
  readonly path: string;
  readonly mutationToken?: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export async function scanWikiGraphLibrary(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryScanResult> {
  const library = await resolveWikiGraphLibrary(target);
  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    const result = await scanWikiGraphLibraryUnlocked(target, library, {
      pathIdentity: "trusted",
    });

    await markWikiGraphLibraryIndexDirty(library);
    return result;
  });
}

export async function rebindWikiGraphLibrary(input: {
  readonly target: ParsedWikiGraphLibraryUri;
  readonly folderPath: string;
}): Promise<WikiGraphLibraryScanResult> {
  if (input.target.kind !== "scope" || input.target.objectUri !== undefined) {
    throw new Error("Library rebind requires a library scope URI.");
  }

  const library = await resolveWikiGraphLibrary(input.target);
  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    const rebound = await updateWikiGraphLibraryFolderPathForRebind(
      library,
      input.folderPath,
    );
    const result = await scanWikiGraphLibraryUnlocked(input.target, rebound, {
      pathIdentity: "untrusted",
    });

    await markWikiGraphLibraryIndexDirty(rebound);
    return result;
  });
}

async function scanWikiGraphLibraryUnlocked(
  target: ParsedWikiGraphLibraryUri,
  library: WikiGraphLibraryRecord,
  options: { readonly pathIdentity: LibraryPathIdentityMode },
): Promise<WikiGraphLibraryScanResult> {
  const files = await listWikgFiles(library.folderPath);

  await withLibraryArchiveMembershipDatabase(async (database) => {
    await database.transaction(async () => {
      const existing = await listLibraryArchiveRows(database, library);
      const currentPaths = new Set(files.map((file) => file.relativePath));
      const seenArchiveIds = new Set<number>();

      for (const file of files) {
        const existingAtPath = findExistingArchiveAtPath(existing, file);
        if (
          options.pathIdentity === "trusted" &&
          existingAtPath !== undefined
        ) {
          await updateLibraryArchiveSeen(database, existingAtPath.id, file, {
            status: "present",
          });
          seenArchiveIds.add(existingAtPath.id);
          continue;
        }

        const matchingTokenArchives =
          file.mutationToken === undefined
            ? []
            : existing.filter(
                (archive) =>
                  archive.lastSeenMutationToken === file.mutationToken &&
                  !seenArchiveIds.has(archive.id),
              );
        const adoptable = matchingTokenArchives.filter(
          (archive) => !currentPaths.has(archive.relativePath),
        );

        if (
          matchingTokenArchives.length === 1 &&
          adoptable.length === 1 &&
          file.mutationToken !== undefined
        ) {
          const archive = adoptable[0]!;
          await database.run(
            `
              UPDATE library_archives
              SET relative_path = ?
              WHERE id = ?
            `,
            [file.relativePath, archive.id],
          );
          await updateLibraryArchiveSeen(database, archive.id, file, {
            status: "present",
          });
          seenArchiveIds.add(archive.id);
          continue;
        }

        await insertLibraryArchive(database, library.id, file, {
          status:
            matchingTokenArchives.length === 0 ||
            file.mutationToken === undefined
              ? "present"
              : "conflict",
        });
      }

      const now = new Date().toISOString();
      for (const archive of existing) {
        if (
          seenArchiveIds.has(archive.id) ||
          (options.pathIdentity === "trusted" &&
            currentPaths.has(archive.relativePath))
        ) {
          continue;
        }
        await database.run(
          `
            UPDATE library_archives
            SET status = 'missing', updated_at = ?, last_scanned_at = ?
            WHERE id = ?
          `,
          [now, now, archive.id],
        );
      }
    });
  });

  return { library, archives: await listWikiGraphLibraryArchives(target) };
}

export async function listWikiGraphLibraryArchives(
  target: ParsedWikiGraphLibraryUri,
): Promise<readonly WikiGraphLibraryArchiveRecord[]> {
  const library = await resolveWikiGraphLibrary(target);
  return await withLibraryArchiveMembershipDatabase(
    async (database) => await listLibraryArchives(database, library),
  );
}

export async function getWikiGraphLibraryArchive(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryArchiveRecord> {
  const library = await resolveWikiGraphLibrary(target);
  return await resolveLibraryArchiveTarget(target, library);
}

export async function getWikiGraphLibraryArchiveById(
  library: WikiGraphLibraryRecord,
  archiveId: number,
): Promise<WikiGraphLibraryArchiveRecord> {
  return await withLibraryArchiveMembershipDatabase(
    async (database) =>
      await requireLibraryArchiveById(database, library, archiveId),
  );
}

export async function resolveWikiGraphLibraryArchivePath(
  archiveLocator: string,
): Promise<string> {
  const target = parseWikiGraphLibraryUri(archiveLocator);
  if (target === undefined || target.kind !== "archive") {
    throw new Error(
      `Expected a Wiki Graph library archive locator: ${archiveLocator}`,
    );
  }

  const archive = await getWikiGraphLibraryArchive(target);
  if (!archive.exists || archive.status === "missing") {
    throw new Error(`Wiki Graph library archive is missing: ${archiveLocator}`);
  }
  if (archive.status === "conflict") {
    throw new Error(
      `Wiki Graph library archive has a conflict and cannot be resolved: ${archiveLocator}`,
    );
  }

  return archive.path;
}

export async function addWikiGraphLibraryArchive(input: {
  readonly target: ParsedWikiGraphLibraryUri;
  readonly inputPath: string;
  readonly to?: string;
}): Promise<WikiGraphLibraryArchiveRecord> {
  if (input.inputPath.startsWith("wikg://")) {
    throw new Error(
      "Library add --input accepts a file path, not a Wiki Graph URI.",
    );
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(input.inputPath)) {
    throw new Error("Library add does not support URL inputs yet.");
  }

  const library = await resolveWikiGraphLibrary(input.target);
  await mkdir(library.folderPath, { recursive: true });
  const sourcePath = resolve(input.inputPath);
  const sourceStats = await stat(sourcePath);
  if (!sourceStats.isFile()) {
    throw new Error(`Library add --input must be a file: ${input.inputPath}`);
  }
  const sourceBasename = sourcePath.split(/[\\/]/u).at(-1) ?? "";
  const targetRelativePath = validateLibraryArchiveRelativePath(
    input.to ?? sourceBasename,
  );
  const targetPath = resolveLibraryRelativePath(
    library.folderPath,
    targetRelativePath,
  );

  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    await mkdir(dirname(targetPath), { recursive: true });
    await assertInsideLibrary(
      await realpath(dirname(targetPath)),
      library.folderPath,
    );
    await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
    await assertInsideLibrary(await realpath(targetPath), library.folderPath);
    const targetFile = await inspectLibraryArchiveFile(
      library.folderPath,
      targetRelativePath,
    );
    const archive = await withLibraryArchiveMembershipDatabase(
      async (database) => {
        await database.transaction(async () => {
          await ensureLibraryArchiveByRelativePath(
            database,
            library.id,
            targetFile,
          );
        });
        return await requireLibraryArchiveByRelativePath(
          database,
          library,
          targetRelativePath,
        );
      },
    );

    await markWikiGraphLibraryIndexDirty(library);
    return archive;
  });
}

export async function removeWikiGraphLibraryArchive(input: {
  readonly target: ParsedWikiGraphLibraryUri;
}): Promise<WikiGraphLibraryArchiveRecord> {
  const library = await resolveWikiGraphLibrary(input.target);
  const archive = await resolveLibraryArchiveTarget(input.target, library);

  await withWikiGraphLibraryLock(library.id, "write", async () => {
    await rm(archive.path, { force: true });
    await withLibraryArchiveMembershipDatabase(async (database) => {
      await database.run("DELETE FROM library_archives WHERE id = ?", [
        archive.id,
      ]);
    });
    await markWikiGraphLibraryIndexDirty(library);
  });

  return { ...archive, exists: false, status: "missing" };
}

export async function moveWikiGraphLibraryArchive(input: {
  readonly target: ParsedWikiGraphLibraryUri;
  readonly to: string;
}): Promise<WikiGraphLibraryArchiveRecord> {
  const library = await resolveWikiGraphLibrary(input.target);
  const archive = await resolveLibraryArchiveTarget(input.target, library);
  const targetRelativePath = validateLibraryArchiveRelativePath(input.to);
  const targetPath = resolveLibraryRelativePath(
    library.folderPath,
    targetRelativePath,
  );

  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    await mkdir(dirname(targetPath), { recursive: true });
    await assertInsideLibrary(
      await realpath(dirname(targetPath)),
      library.folderPath,
    );
    if (await pathExists(targetPath)) {
      throw new Error(
        `Library archive target already exists: ${targetRelativePath}`,
      );
    }
    await rename(archive.path, targetPath);
    await assertInsideLibrary(await realpath(targetPath), library.folderPath);
    const targetFile = await inspectLibraryArchiveFile(
      library.folderPath,
      targetRelativePath,
    );
    const moved = await withLibraryArchiveMembershipDatabase(
      async (database) => {
        await database.run(
          "UPDATE library_archives SET relative_path = ? WHERE id = ?",
          [targetRelativePath, archive.id],
        );
        await updateLibraryArchiveSeen(database, archive.id, targetFile, {
          status: "present",
        });
        return await requireLibraryArchiveByPublicId(
          database,
          library,
          archive.publicId,
        );
      },
    );

    await markWikiGraphLibraryIndexDirty(library);
    return moved;
  });
}

async function withLibraryArchiveMembershipDatabase<T>(
  operation: (database: Database) => Promise<T>,
): Promise<T> {
  const database = await openSharedStateDatabase(
    resolveWikiGraphCoreDatabasePath(),
    LIBRARY_ARCHIVE_MEMBERSHIP_SCHEMA_SQL,
  );

  try {
    await ensureLibraryArchiveMembershipColumns(database);
    await ensureLibraryArchiveMembershipPathIndex(database);
    return await operation(database);
  } finally {
    await database.close();
  }
}

async function listLibraryArchives(
  database: Database,
  library: WikiGraphLibraryRecord,
): Promise<WikiGraphLibraryArchiveRecord[]> {
  const rows = await queryLibraryArchiveRows(database, library.id);
  const archives: WikiGraphLibraryArchiveRecord[] = [];
  for (const row of rows) {
    const relativePath = getString(row, "relative_path");
    archives.push(
      mapLibraryArchiveRecord(
        library,
        row,
        await pathExists(join(library.folderPath, relativePath)),
      ),
    );
  }
  return archives;
}

async function listLibraryArchiveRows(
  database: Database,
  library: WikiGraphLibraryRecord,
): Promise<WikiGraphLibraryArchiveRecord[]> {
  const rows = await queryLibraryArchiveRows(database, library.id);
  return rows.map((row) => mapLibraryArchiveRecord(library, row, false));
}

async function queryLibraryArchiveRows(
  database: Database,
  libraryId: number,
): Promise<SqlRow[]> {
  return await database.queryAll(
    `
      SELECT id, public_id, relative_path, status, last_seen_mutation_token,
             last_seen_size, last_seen_mtime_ms, last_scanned_at,
             created_at, updated_at
      FROM library_archives
      WHERE library_id = ?
      ORDER BY relative_path
    `,
    [libraryId],
    (row) => row,
  );
}

async function ensureLibraryArchiveByRelativePath(
  database: Database,
  libraryId: number,
  file: DiscoveredLibraryArchiveFile,
): Promise<void> {
  const existing = await database.queryOne(
    `
      SELECT id
      FROM library_archives
      WHERE library_id = ? AND relative_path = ?
      ORDER BY CASE status
        WHEN 'present' THEN 0
        WHEN 'conflict' THEN 1
        ELSE 2
      END, id DESC
    `,
    [libraryId, file.relativePath],
    (row) => getNumber(row, "id"),
  );
  if (existing !== undefined) {
    await updateLibraryArchiveSeen(database, existing, file, {
      status: "present",
    });
    return;
  }

  await insertLibraryArchive(database, libraryId, file, { status: "present" });
}

async function insertLibraryArchive(
  database: Database,
  libraryId: number,
  file: DiscoveredLibraryArchiveFile,
  options: { readonly status: WikiGraphLibraryArchiveStatus },
): Promise<void> {
  const now = new Date().toISOString();
  await database.run(
    `
      INSERT INTO library_archives (
        library_id, public_id, relative_path, status, last_seen_mutation_token,
        last_seen_size, last_seen_mtime_ms, last_scanned_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      libraryId,
      await createUniqueLibraryArchivePublicId(database, libraryId),
      file.relativePath,
      options.status,
      file.mutationToken ?? null,
      file.size,
      Math.round(file.mtimeMs),
      now,
      now,
      now,
    ],
  );
}

async function updateLibraryArchiveSeen(
  database: Database,
  archiveId: number,
  file: DiscoveredLibraryArchiveFile,
  options: { readonly status: WikiGraphLibraryArchiveStatus },
): Promise<void> {
  const now = new Date().toISOString();
  await database.run(
    `
      UPDATE library_archives
      SET status = ?,
          last_seen_mutation_token = ?,
          last_seen_size = ?,
          last_seen_mtime_ms = ?,
          last_scanned_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [
      options.status,
      file.mutationToken ?? null,
      file.size,
      Math.round(file.mtimeMs),
      now,
      now,
      archiveId,
    ],
  );
}

async function requireLibraryArchiveByRelativePath(
  database: Database,
  library: WikiGraphLibraryRecord,
  relativePath: string,
): Promise<WikiGraphLibraryArchiveRecord> {
  const archive = await database.queryOne(
    `
      SELECT id, public_id, relative_path, status, last_seen_mutation_token,
             last_seen_size, last_seen_mtime_ms, last_scanned_at,
             created_at, updated_at
      FROM library_archives
      WHERE library_id = ? AND relative_path = ?
      ORDER BY CASE status
        WHEN 'present' THEN 0
        WHEN 'conflict' THEN 1
        ELSE 2
      END, id DESC
    `,
    [library.id, relativePath],
    (row) => mapLibraryArchiveRecord(library, row, true),
  );
  if (archive === undefined) {
    throw new Error(
      `Library archive registry record is missing: ${relativePath}`,
    );
  }
  return archive;
}

async function requireLibraryArchiveByPublicId(
  database: Database,
  library: WikiGraphLibraryRecord,
  publicId: string,
): Promise<WikiGraphLibraryArchiveRecord> {
  const row = await database.queryOne(
    `
      SELECT id, public_id, relative_path, status, last_seen_mutation_token,
             last_seen_size, last_seen_mtime_ms, last_scanned_at,
             created_at, updated_at
      FROM library_archives
      WHERE library_id = ? AND public_id = ?
    `,
    [library.id, publicId],
    (row) => row,
  );
  if (row === undefined) {
    throw new Error(`Unknown Wiki Graph library archive: ${publicId}`);
  }
  const relativePath = getString(row, "relative_path");
  return mapLibraryArchiveRecord(
    library,
    row,
    await pathExists(join(library.folderPath, relativePath)),
  );
}

async function requireLibraryArchiveById(
  database: Database,
  library: WikiGraphLibraryRecord,
  archiveId: number,
): Promise<WikiGraphLibraryArchiveRecord> {
  const row = await database.queryOne(
    `
      SELECT id, public_id, relative_path, status, last_seen_mutation_token,
             last_seen_size, last_seen_mtime_ms, last_scanned_at,
             created_at, updated_at
      FROM library_archives
      WHERE library_id = ? AND id = ?
    `,
    [library.id, archiveId],
    (row) => row,
  );
  if (row === undefined) {
    throw new Error(`Unknown Wiki Graph library archive: ${archiveId}`);
  }
  const relativePath = getString(row, "relative_path");
  return mapLibraryArchiveRecord(
    library,
    row,
    await pathExists(join(library.folderPath, relativePath)),
  );
}

async function resolveLibraryArchiveTarget(
  target: ParsedWikiGraphLibraryUri,
  library: WikiGraphLibraryRecord,
): Promise<WikiGraphLibraryArchiveRecord> {
  if (target.kind !== "archive" || target.archivePublicId === undefined) {
    throw new Error("Expected a Wiki Graph library archive URI.");
  }
  return await withLibraryArchiveMembershipDatabase(
    async (database) =>
      await requireLibraryArchiveByPublicId(
        database,
        library,
        target.archivePublicId!,
      ),
  );
}

function mapLibraryArchiveRecord(
  library: WikiGraphLibraryRecord,
  row: SqlRow,
  exists: boolean,
): WikiGraphLibraryArchiveRecord {
  const publicId = getString(row, "public_id");
  const relativePath = getString(row, "relative_path");
  const databaseStatus = normalizeArchiveStatus(
    getOptionalString(row, "status") ?? "present",
  );
  return {
    createdAt: getString(row, "created_at"),
    exists,
    id: getNumber(row, "id"),
    libraryId: library.id,
    libraryUri: library.uri,
    ...optionalStringField(
      row,
      "last_seen_mutation_token",
      "lastSeenMutationToken",
    ),
    ...optionalNumberField(row, "last_seen_mtime_ms", "lastSeenMtimeMs"),
    ...optionalNumberField(row, "last_seen_size", "lastSeenSize"),
    ...optionalStringField(row, "last_scanned_at", "lastScannedAt"),
    path: join(library.folderPath, relativePath),
    publicId,
    relativePath,
    status: exists ? databaseStatus : "missing",
    updatedAt: getString(row, "updated_at"),
    uri: `${library.uri}/${publicId}`,
  };
}

function findExistingArchiveAtPath(
  archives: readonly WikiGraphLibraryArchiveRecord[],
  file: DiscoveredLibraryArchiveFile,
): WikiGraphLibraryArchiveRecord | undefined {
  return archives
    .filter((archive) => archive.relativePath === file.relativePath)
    .sort((a, b) => archivePathMatchRank(a) - archivePathMatchRank(b))[0];
}

function archivePathMatchRank(archive: WikiGraphLibraryArchiveRecord): number {
  if (archive.status === "present") {
    return 0;
  }
  if (archive.status === "conflict") {
    return 1;
  }
  return 2;
}

async function listWikgFiles(
  root: string,
): Promise<DiscoveredLibraryArchiveFile[]> {
  const relativePaths: string[] = [];
  await walkLibraryDirectory(root, root, relativePaths);
  const files: DiscoveredLibraryArchiveFile[] = [];
  for (const relativePath of relativePaths.sort((a, b) => a.localeCompare(b))) {
    files.push(await inspectLibraryArchiveFile(root, relativePath));
  }
  return files;
}

async function walkLibraryDirectory(
  root: string,
  directory: string,
  files: string[],
): Promise<void> {
  let entries;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for await (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkLibraryDirectory(root, path, files);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION)
    ) {
      files.push(relative(root, path).replace(/\\/gu, "/"));
    }
  }
}

async function inspectLibraryArchiveFile(
  root: string,
  relativePath: string,
): Promise<DiscoveredLibraryArchiveFile> {
  const path = join(root, relativePath);
  const fileStat = await stat(path);
  const mutationToken = await readOptionalWikgMutationToken(path);
  return {
    mtimeMs: fileStat.mtimeMs,
    ...(mutationToken === undefined ? {} : { mutationToken }),
    path,
    relativePath,
    size: fileStat.size,
  };
}

async function readOptionalWikgMutationToken(
  path: string,
): Promise<string | undefined> {
  try {
    return await readWikgArchiveMutationToken(path);
  } catch {
    return undefined;
  }
}

function validateLibraryArchiveRelativePath(relativePath: string): string {
  const normalized = relativePath
    .replace(/\\/gu, "/")
    .replace(/^\/+|\/+$/gu, "");
  if (
    normalized === "" ||
    isAbsolute(relativePath) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(
      "Library archive target must be a relative path inside the library folder.",
    );
  }
  if (!normalized.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION)) {
    throw new Error("Library archive target must end with .wikg.");
  }
  return normalized;
}

function resolveLibraryRelativePath(
  root: string,
  relativePath: string,
): string {
  const path = resolve(root, relativePath);
  const rel = relative(resolve(root), path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Library archive target escapes the library folder.");
  }
  return path;
}

async function assertInsideLibrary(path: string, root: string): Promise<void> {
  const rootRealPath = await realpath(root);
  const rel = relative(rootRealPath, path);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Library archive path escapes the library folder.");
  }
}

async function ensureLibraryArchiveMembershipColumns(
  database: Database,
): Promise<void> {
  const columns = await database.queryAll(
    "PRAGMA table_info(library_archives)",
    undefined,
    (row) => getString(row, "name"),
  );
  const columnSet = new Set(columns);
  const additions: Array<readonly [string, string]> = [
    ["status", "TEXT NOT NULL DEFAULT 'present'"],
    ["last_seen_mutation_token", "TEXT"],
    ["last_seen_size", "INTEGER"],
    ["last_seen_mtime_ms", "INTEGER"],
    ["last_scanned_at", "TEXT"],
  ];
  for (const [name, definition] of additions) {
    if (!columnSet.has(name)) {
      await database.run(
        `ALTER TABLE library_archives ADD COLUMN ${name} ${definition}`,
      );
    }
  }
}

async function ensureLibraryArchiveMembershipPathIndex(
  database: Database,
): Promise<void> {
  if (await hasUniqueLibraryArchiveRelativePathIndex(database)) {
    await rebuildLibraryArchiveMembershipTable(database);
  }
  await database.run(
    `
      CREATE INDEX IF NOT EXISTS idx_library_archives_library_path
      ON library_archives(library_id, relative_path)
    `,
  );
}

async function hasUniqueLibraryArchiveRelativePathIndex(
  database: Database,
): Promise<boolean> {
  const indexes = await database.queryAll(
    "PRAGMA index_list(library_archives)",
    undefined,
    (row) => ({
      name: getString(row, "name"),
      unique: getNumber(row, "unique") === 1,
    }),
  );
  for (const index of indexes) {
    if (!index.unique) {
      continue;
    }
    const columns = await database.queryAll(
      `PRAGMA index_info(${sqlStringLiteral(index.name)})`,
      undefined,
      (row) => getString(row, "name"),
    );
    if (
      columns.length === 2 &&
      columns[0] === "library_id" &&
      columns[1] === "relative_path"
    ) {
      return true;
    }
  }
  return false;
}

async function rebuildLibraryArchiveMembershipTable(
  database: Database,
): Promise<void> {
  await database.transaction(async () => {
    await database.run(
      "ALTER TABLE library_archives RENAME TO library_archives_unique_path_legacy",
    );
    await database.run(`
      CREATE TABLE library_archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        public_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'present',
        last_seen_mutation_token TEXT,
        last_seen_size INTEGER,
        last_seen_mtime_ms INTEGER,
        last_scanned_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(library_id, public_id)
      )
    `);
    await database.run(`
      INSERT INTO library_archives (
        id, library_id, public_id, relative_path, status,
        last_seen_mutation_token, last_seen_size, last_seen_mtime_ms,
        last_scanned_at, created_at, updated_at
      )
      SELECT id, library_id, public_id, relative_path, status,
        last_seen_mutation_token, last_seen_size, last_seen_mtime_ms,
        last_scanned_at, created_at, updated_at
      FROM library_archives_unique_path_legacy
    `);
    await database.run("DROP TABLE library_archives_unique_path_legacy");
  });
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
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

function normalizeArchiveStatus(value: string): WikiGraphLibraryArchiveStatus {
  if (value === "conflict" || value === "missing" || value === "present") {
    return value;
  }
  return "present";
}

function optionalNumberField<K extends string>(
  row: SqlRow,
  dbKey: string,
  outputKey: K,
): Partial<Record<K, number>> {
  const value = row[dbKey];
  if (typeof value !== "number") {
    return {};
  }
  return { [outputKey]: value } as Partial<Record<K, number>>;
}

function optionalStringField<K extends string>(
  row: SqlRow,
  dbKey: string,
  outputKey: K,
): Partial<Record<K, string>> {
  const value = getOptionalString(row, dbKey);
  if (value === undefined) {
    return {};
  }
  return { [outputKey]: value } as Partial<Record<K, string>>;
}

import { createHash, randomUUID } from "crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
} from "path";

import { resolveWikiGraphStagingDirectoryPath } from "../common/wiki-graph-dir.js";
import { createWikiGraphTempDirectory } from "../common/wiki-graph-temp.js";
import { openSharedStateDatabase } from "../document/index.js";
import type { Database } from "../document/index.js";
import type { DocumentFileStore } from "../document/document.js";
import {
  isDisposableDirectoryEntry,
  readPathSize,
  removeDisposableChildDirectories,
  removeDisposableDescendantDirectories,
  removeDisposableDirectory,
} from "../gc/files.js";
import type { GcContext, GcJobResult } from "../gc/index.js";
import { AsyncSemaphore } from "../utils/async-semaphore.js";
import { isNodeError } from "../utils/node-error.js";

import {
  extractWikgArchive,
  listWikgArchiveEntries,
  readWikgArchiveMutationToken,
  readWikgArchiveEntry,
  WikgArchiveReader,
  writeWikgArchiveWithOverlays,
  type WikgArchiveOverlay,
} from "./archive.js";

const STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entry_overlays (
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace_path TEXT,
  archive_signature TEXT,
  mutation_token TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path)
);

CREATE TABLE IF NOT EXISTS entry_locks (
  archive_key TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path, owner_id)
);

CREATE TABLE IF NOT EXISTS archive_owners (
  archive_key TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, owner_id)
);

CREATE TABLE IF NOT EXISTS entry_sqlite_leases (
  archive_key TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'read',
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path, owner_id)
);

CREATE TABLE IF NOT EXISTS archive_commit_locks (
  archive_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`;

const DATABASE_ENTRY_PATH = "database.db";
const SEARCH_INDEX_DATABASE_ENTRY_PATH = "fts.db";
const LOCK_POLL_INTERVAL_MS = 100;
const LOCK_STALE_TIMEOUT_MS = 60_000;
const OWNER_HEARTBEAT_INTERVAL_MS = 20_000;
const SQLITE_CACHE_TTL_MS = 60 * 60 * 1000;
const STATE_DATABASE_SEMAPHORE = new AsyncSemaphore(1);
const ARCHIVE_SESSION_CONSTRUCTOR_TOKEN = Symbol(
  "WikgArchiveSession constructor token",
);

type EntryLockMode = "read" | "state" | "write";
type SqliteLeaseMode = "read" | "write";
type WorkspaceWritebackPolicy = "archive" | "cache";

export class WikgCoordinator {
  public createFileStore(
    archivePath: string,
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
      readonly session?: WikgArchiveSession;
    } = {},
  ): DocumentFileStore {
    return new WikgDocumentFileStore(resolve(archivePath), options);
  }

  public async withArchiveSession<T>(
    archivePath: string,
    operation: (session: WikgArchiveSession) => Promise<T> | T,
  ): Promise<T> {
    const session = await WikgArchiveSession.open(resolve(archivePath));

    try {
      return await operation(session);
    } finally {
      await session.close();
    }
  }

  public async withReadWorkspace<T>(
    archivePath: string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
    } = {},
  ): Promise<T> {
    const directoryPath =
      options.documentDirPath === undefined
        ? await createWikiGraphTempDirectory("archive-open")
        : resolve(options.documentDirPath);

    try {
      await extractWikgArchive(resolve(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      if (options.documentDirPath === undefined) {
        await rm(directoryPath, { force: true, recursive: true });
      }
    }
  }

  public async withWriteWorkspace<T>(
    archivePath: string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
  ): Promise<T> {
    const directoryPath = await createWikiGraphTempDirectory("archive-write");

    try {
      await extractWikgArchive(resolve(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  }
}

export class WikgArchiveSession {
  readonly #archiveKey: string;
  readonly #archivePath: string;
  readonly #ownerId = createOwnerId();
  readonly #heartbeat: NodeJS.Timeout;
  readonly #observedDirtyEntryPaths = new Set<string>();
  readonly #modifiedEntryPaths = new Set<string>();
  #closed = false;

  public constructor(archivePath: string, token?: symbol) {
    if (token !== ARCHIVE_SESSION_CONSTRUCTOR_TOKEN) {
      throw new Error("Use WikgCoordinator.withArchiveSession().");
    }

    this.#archivePath = resolve(archivePath);
    this.#archiveKey = createArchiveKey(this.#archivePath);
    this.#heartbeat = setInterval(() => {
      void heartbeatArchiveOwner({
        archiveKey: this.#archiveKey,
        ownerId: this.#ownerId,
      }).catch(() => undefined);
    }, OWNER_HEARTBEAT_INTERVAL_MS);
  }

  public static async open(archivePath: string): Promise<WikgArchiveSession> {
    const session = new WikgArchiveSession(
      archivePath,
      ARCHIVE_SESSION_CONSTRUCTOR_TOKEN,
    );

    try {
      await registerArchiveOwner({
        archiveKey: session.#archiveKey,
        ownerId: session.#ownerId,
      });
      return session;
    } catch (error) {
      clearInterval(session.#heartbeat);
      throw error;
    }
  }

  public get archiveKey(): string {
    return this.#archiveKey;
  }

  public get archivePath(): string {
    return this.#archivePath;
  }

  public get ownerId(): string {
    return this.#ownerId;
  }

  public observeDirtyEntry(entryPath: string): void {
    this.#observedDirtyEntryPaths.add(entryPath);
  }

  public modifyEntry(entryPath: string): void {
    this.#modifiedEntryPaths.add(entryPath);
  }

  public createFileStore(
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
    } = {},
  ): DocumentFileStore {
    return new WikgDocumentFileStore(this.#archivePath, {
      ...options,
      session: this,
    });
  }

  public async materializeReadWorkspace<T>(
    directoryPath: string | undefined,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
  ): Promise<T> {
    const ownsDirectoryPath = directoryPath === undefined;
    const resolvedDirectoryPath = ownsDirectoryPath
      ? await createWikiGraphTempDirectory("archive-open")
      : resolve(directoryPath);

    if (!ownsDirectoryPath) {
      await ensureEmptyDirectory(resolvedDirectoryPath);
    }

    const fileStore = this.createFileStore({ readonlyDatabase: true });
    const entries = await listVisibleEntryPaths(
      await listWikgArchiveEntries(this.#archivePath),
      {
        archiveKey: this.#archiveKey,
        prefix: "",
      },
    );

    try {
      for (const entryPath of entries) {
        const content = await fileStore.readFile(entryPath);

        if (content === undefined) {
          continue;
        }

        const targetPath = resolve(resolvedDirectoryPath, entryPath);
        const relativeTargetPath = relative(resolvedDirectoryPath, targetPath);

        if (
          relativeTargetPath.startsWith("..") ||
          isAbsolute(relativeTargetPath)
        ) {
          throw new Error(`Archive entry escapes read workspace: ${entryPath}`);
        }

        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content);
      }

      return await operation(resolvedDirectoryPath);
    } finally {
      await fileStore.close();
      if (ownsDirectoryPath) {
        await rm(resolvedDirectoryPath, { force: true, recursive: true });
      }
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    clearInterval(this.#heartbeat);

    try {
      await this.#settle();
      await reapArchive(this.#archiveKey);
    } finally {
      await unregisterArchiveOwner({
        archiveKey: this.#archiveKey,
        ownerId: this.#ownerId,
      });
    }

    await import("../gc/index.js")
      .then(async ({ tryRunWikiGraphGc }) => {
        await tryRunWikiGraphGc({ opportunistic: true });
      })
      .catch(() => undefined);
  }

  async #settle(): Promise<void> {
    const entryPaths = new Set([
      ...this.#observedDirtyEntryPaths,
      ...this.#modifiedEntryPaths,
    ]);

    if (entryPaths.size === 0) {
      return;
    }

    await flushArchiveOverlays(this.#archiveKey, entryPaths);
  }
}

export async function tryStartWikgFlusher(archivePath?: string): Promise<void> {
  if (archivePath !== undefined) {
    await flushArchiveOverlays(createArchiveKey(resolve(archivePath)));
    return;
  }

  const archiveKeys = await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    return await state.queryAll(
      `
SELECT DISTINCT archive_key
FROM entry_overlays
ORDER BY archive_key
`,
      undefined,
      (row) => getString(row, "archive_key"),
    );
  });

  for (const archiveKey of archiveKeys) {
    await flushArchiveOverlays(archiveKey);
  }
}

export async function runWikgCoordinatorGc(
  context: GcContext,
): Promise<GcJobResult> {
  const candidates = await listSqliteCacheGcCandidates();
  let removed = 0;
  let freedBytes = 0;

  for (const candidate of candidates) {
    const result = await tryRemoveSqliteCacheCandidate(candidate, context);

    if (result.removed) {
      removed += 1;
      freedBytes += result.freedBytes;
    }
  }

  const orphanedFiles = await removeOrphanedWorkspaceFiles(context);
  const childDirectories = context.dryRun
    ? { freedBytes: 0, removed: 0, scanned: 0 }
    : await removeDisposableChildDirectories(getCoordinatorWorkspaceRootPath());

  return {
    freedBytes:
      freedBytes + orphanedFiles.freedBytes + childDirectories.freedBytes,
    removed: removed + orphanedFiles.removed + childDirectories.removed,
    scanned:
      candidates.length + orphanedFiles.scanned + childDirectories.scanned,
  };
}

async function listSqliteCacheGcCandidates(): Promise<readonly EntryOverlay[]> {
  return await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    return await state.queryAll(
      `
SELECT overlay.*
FROM entry_overlays AS overlay
WHERE overlay.entry_path IN (?, ?)
  AND overlay.kind = 'file'
  AND overlay.workspace_path IS NOT NULL
ORDER BY overlay.updated_at ASC
`,
      [DATABASE_ENTRY_PATH, SEARCH_INDEX_DATABASE_ENTRY_PATH],
      mapEntryOverlay,
    );
  });
}

async function tryRemoveSqliteCacheCandidate(
  candidate: EntryOverlay,
  context: GcContext,
): Promise<{ readonly freedBytes: number; readonly removed: boolean }> {
  const releaseWriteLock = await acquireEntryLock(
    candidate.archiveKey,
    candidate.entryPath,
    "write",
  );

  try {
    const releaseStateLock = await acquireEntryLock(
      candidate.archiveKey,
      candidate.entryPath,
      "state",
    );

    try {
      const overlay = await readOverlay(
        candidate.archiveKey,
        candidate.entryPath,
      );

      if (
        overlay?.workspacePath === undefined ||
        overlay.workspacePath !== candidate.workspacePath ||
        !(await canRemoveSqliteCacheOverlay(overlay, context))
      ) {
        return { freedBytes: 0, removed: false };
      }

      let freedBytes = await readPathSize(overlay.workspacePath);

      if (!context.dryRun) {
        await deleteOverlay(overlay.archiveKey, overlay.entryPath);
        await rm(overlay.workspacePath, { force: true });
        freedBytes += await removeDisposableDirectory(
          dirname(overlay.workspacePath),
        );
      }

      return { freedBytes, removed: true };
    } finally {
      await releaseStateLock();
    }
  } finally {
    await releaseWriteLock();
  }
}

async function canRemoveSqliteCacheOverlay(
  overlay: EntryOverlay,
  context: GcContext,
): Promise<boolean> {
  if (
    await hasActiveArchiveOwnerOrSqliteLease(
      overlay.archiveKey,
      overlay.entryPath,
    )
  ) {
    return false;
  }
  if (
    overlay.entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH &&
    !context.force
  ) {
    return false;
  }
  if (!context.force && context.now - overlay.updatedAt < SQLITE_CACHE_TTL_MS) {
    return false;
  }
  if (overlay.workspacePath === undefined) {
    return false;
  }

  const workspaceExists = await pathExists(overlay.workspacePath);

  if (!workspaceExists) {
    return true;
  }

  await createArchiveSignature(overlay.archivePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  return true;
}

async function hasActiveArchiveOwnerOrSqliteLease(
  archiveKey: string,
  entryPath: string,
): Promise<boolean> {
  return await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    const ownerCount = await state.queryOne(
      "SELECT COUNT(*) AS count FROM archive_owners WHERE archive_key = ?",
      [archiveKey],
      (row) => getNumber(row, "count"),
    );
    const leaseCount = await state.queryOne(
      `
SELECT COUNT(*) AS count
FROM entry_sqlite_leases
WHERE archive_key = ?
  AND entry_path = ?
`,
      [archiveKey, entryPath],
      (row) => getNumber(row, "count"),
    );

    return (ownerCount ?? 0) > 0 || (leaseCount ?? 0) > 0;
  });
}

async function hasActiveWorkspaceUse(archiveKey: string): Promise<boolean> {
  return await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    const ownerCount = await state.queryOne(
      "SELECT COUNT(*) AS count FROM archive_owners WHERE archive_key = ?",
      [archiveKey],
      (row) => getNumber(row, "count"),
    );
    const leaseCount = await state.queryOne(
      "SELECT COUNT(*) AS count FROM entry_sqlite_leases WHERE archive_key = ?",
      [archiveKey],
      (row) => getNumber(row, "count"),
    );
    const lockCount = await state.queryOne(
      "SELECT COUNT(*) AS count FROM entry_locks WHERE archive_key = ?",
      [archiveKey],
      (row) => getNumber(row, "count"),
    );

    return (
      (ownerCount ?? 0) > 0 || (leaseCount ?? 0) > 0 || (lockCount ?? 0) > 0
    );
  });
}

async function removeOrphanedWorkspaceFiles(
  context: GcContext,
): Promise<Pick<GcJobResult, "freedBytes" | "removed" | "scanned">> {
  const rootPath = getCoordinatorWorkspaceRootPath();
  let archiveKeyEntries: readonly WorkspaceDirectoryEntry[];

  try {
    archiveKeyEntries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { freedBytes: 0, removed: 0, scanned: 0 };
    }

    throw error;
  }

  let freedBytes = 0;
  let removed = 0;
  let scanned = 0;

  for (const archiveKeyEntry of archiveKeyEntries) {
    if (!archiveKeyEntry.isDirectory()) {
      continue;
    }

    const archiveKey = archiveKeyEntry.name;

    if (await hasActiveWorkspaceUse(archiveKey)) {
      continue;
    }

    const referencedWorkspacePaths = new Set(
      (await listOverlays(archiveKey))
        .map((overlay) => overlay.workspacePath)
        .filter((path): path is string => path !== undefined),
    );

    for (const workspacePath of await listWorkspaceFiles(
      join(rootPath, archiveKey),
    )) {
      scanned += 1;

      if (isDisposableDirectoryEntry(basename(workspacePath))) {
        continue;
      }
      if (referencedWorkspacePaths.has(workspacePath)) {
        continue;
      }

      const size = await readPathSize(workspacePath);

      if (!context.dryRun) {
        await rm(workspacePath, { force: true });
      }

      freedBytes += size;
      removed += 1;
    }

    if (!context.dryRun) {
      const disposableDirectories = await removeDisposableDescendantDirectories(
        join(rootPath, archiveKey),
      );

      freedBytes += disposableDirectories.freedBytes;
      removed += disposableDirectories.removed;
      scanned += disposableDirectories.scanned;
    }
  }

  return { freedBytes, removed, scanned };
}

class WikgDocumentFileStore implements DocumentFileStore {
  readonly #archiveKey: string;
  readonly #archivePath: string;
  #archiveReader: Promise<WikgArchiveReader> | undefined;
  #entrySourceByPath:
    | Map<
        string,
        | { readonly kind: "archive" }
        | { readonly kind: "deleted" }
        | { readonly kind: "workspace"; readonly path: string }
      >
    | undefined;
  readonly #readonlyDatabase: boolean;
  readonly #searchIndexWritebackPolicy: WorkspaceWritebackPolicy;
  readonly #sqliteLeaseOwnerId = createOwnerId();

  public constructor(
    archivePath: string,
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
      readonly session?: WikgArchiveSession;
    },
  ) {
    this.#archivePath = resolve(archivePath);
    this.#archiveKey = createArchiveKey(this.#archivePath);
    this.#readonlyDatabase = options.readonlyDatabase === true;
    this.#searchIndexWritebackPolicy =
      options.searchIndexWritebackPolicy ?? "archive";
    this.#session = options.session;
  }

  async #readOverlay(entryPath: string): Promise<EntryOverlay | undefined> {
    const overlay = await readOverlay(this.#archiveKey, entryPath);

    if (overlay === undefined) {
      return undefined;
    }

    const signature = await createArchiveSignature(this.#archivePath);

    if (overlay.archiveSignature === signature) {
      return overlay;
    }

    await deleteOverlay(this.#archiveKey, entryPath);
    if (overlay.workspacePath !== undefined) {
      await rm(overlay.workspacePath, { force: true }).catch(() => undefined);
    }
    this.#entrySourceByPath?.delete(entryPath);
    return undefined;
  }

  readonly #session: WikgArchiveSession | undefined;

  public async close(): Promise<void> {
    if (this.#archiveReader !== undefined) {
      (await this.#archiveReader).close();
      this.#archiveReader = undefined;
    }
    await releaseSqliteLease({
      archiveKey: this.#archiveKey,
      entryPath: DATABASE_ENTRY_PATH,
      ownerId: this.#sqliteLeaseOwnerId,
    });
    await releaseSqliteLease({
      archiveKey: this.#archiveKey,
      entryPath: SEARCH_INDEX_DATABASE_ENTRY_PATH,
      ownerId: this.#sqliteLeaseOwnerId,
    });
  }

  public async deleteFile(path: string): Promise<void> {
    const entryPath = this.#toEntryPath(path);

    await withEntryLock(this.#archiveKey, entryPath, "write", async () => {
      await withEntryLock(this.#archiveKey, entryPath, "state", async () => {
        const overlay = await this.#readOverlay(entryPath);

        await upsertOverlay({
          archiveKey: this.#archiveKey,
          archivePath: this.#archivePath,
          entryPath,
          kind: "deleted",
        });
        if (overlay?.workspacePath !== undefined) {
          await rm(overlay.workspacePath, { force: true }).catch(
            () => undefined,
          );
        }
        this.#entrySourceByPath?.set(entryPath, { kind: "deleted" });
        this.#session?.modifyEntry(entryPath);
      });
    });
  }

  public async deleteTree(path: string): Promise<void> {
    const rootEntryPath = this.#toEntryPath(path);
    const entries = await listVisibleEntryPaths(
      await this.#listArchiveEntries(),
      {
        archiveKey: this.#archiveKey,
        prefix: `${rootEntryPath}/`,
      },
    );

    for (const entryPath of entries) {
      await this.deleteFile(entryPath);
    }
  }

  public ensureDirectory(): Promise<void> {
    return Promise.resolve();
  }

  public initializeDatabaseSchema(): boolean {
    return false;
  }

  public markDatabaseDirty(): void {
    if (!this.#readonlyDatabase) {
      this.#session?.observeDirtyEntry(DATABASE_ENTRY_PATH);
    }
  }

  public markSearchIndexDatabaseDirty(): void {
    if (
      !this.#readonlyDatabase &&
      this.#searchIndexWritebackPolicy === "archive"
    ) {
      this.#session?.observeDirtyEntry(SEARCH_INDEX_DATABASE_ENTRY_PATH);
    }
  }

  public openDatabaseReadonly(): boolean {
    return this.#readonlyDatabase;
  }

  public async listFiles(path: string): Promise<readonly string[]> {
    const directoryEntryPath = this.#toEntryPath(path);
    const prefix = directoryEntryPath === "" ? "" : `${directoryEntryPath}/`;
    const entries = (await this.#listDirectoryEntryPaths(prefix)).map(
      ([entryPath]) => entryPath,
    );

    return entries
      .map((entryPath) => entryPath.slice(prefix.length))
      .filter((entryPath) => !entryPath.includes("/"))
      .map((entryPath) => posix.basename(entryPath))
      .sort((left, right) => left.localeCompare(right));
  }

  public async listFileContents(
    path: string,
  ): Promise<ReadonlyMap<string, Uint8Array>> {
    const directoryEntryPath = this.#toEntryPath(path);
    const prefix = directoryEntryPath === "" ? "" : `${directoryEntryPath}/`;
    return await withEntryLock(
      this.#archiveKey,
      normalizeEntryDirectoryPrefix(prefix),
      "read",
      async () => {
        const contents = new Map<string, Uint8Array>();

        for (const [entryPath, source] of await this.#listDirectoryEntryPaths(
          prefix,
        )) {
          const name = entryPath.slice(prefix.length);

          if (name.includes("/")) {
            continue;
          }
          if (source.kind === "workspace") {
            contents.set(name, await readFile(source.path));
            continue;
          }

          const content = await this.#readArchiveEntry(entryPath);

          if (content !== undefined) {
            contents.set(name, content);
          }
        }

        return contents;
      },
    );
  }

  public async readFile(path: string): Promise<Uint8Array | undefined> {
    const entryPath = this.#toEntryPath(path);

    return await withEntryLock(
      this.#archiveKey,
      entryPath,
      "read",
      async () => {
        const source =
          (await this.#getEntrySources()).get(entryPath) ??
          (await withEntryLock(
            this.#archiveKey,
            entryPath,
            "state",
            async () =>
              await resolveEntrySource({
                archiveKey: this.#archiveKey,
                entryPath,
              }),
          ));

        if (source.kind === "deleted") {
          this.#session?.observeDirtyEntry(entryPath);
          return undefined;
        }
        if (source.kind === "workspace") {
          this.#session?.observeDirtyEntry(entryPath);
          return await readFile(source.path);
        }

        return await this.#readArchiveEntry(entryPath);
      },
    );
  }

  public async resolveDatabasePath(): Promise<string> {
    return await this.#resolveSqliteDatabasePath(DATABASE_ENTRY_PATH, {
      createIfMissing: true,
      readonly: this.#readonlyDatabase,
    });
  }

  public async resolveSearchIndexDatabasePath(): Promise<string> {
    return await this.#resolveSqliteDatabasePath(
      SEARCH_INDEX_DATABASE_ENTRY_PATH,
      {
        createIfMissing: !this.#readonlyDatabase,
        readonly: this.#readonlyDatabase,
      },
    );
  }

  async #resolveSqliteDatabasePath(
    entryPath: string,
    options: { readonly createIfMissing: boolean; readonly readonly: boolean },
  ): Promise<string> {
    return await withEntryLock(
      this.#archiveKey,
      entryPath,
      "state",
      async () => {
        let overlay = await this.#readOverlay(entryPath);

        if (
          entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH &&
          overlay?.kind !== "file"
        ) {
          await tryAdoptSearchIndexCacheOverlay({
            targetArchiveKey: this.#archiveKey,
            targetArchivePath: this.#archivePath,
          });
          overlay = await this.#readOverlay(entryPath);
        }

        if (overlay?.kind !== "file") {
          const content = await readWikgArchiveEntry(
            this.#archivePath,
            entryPath,
          );

          if (content === undefined && !options.createIfMissing) {
            throw new Error(`Archive SQLite entry is missing: ${entryPath}`);
          }
          const workspacePath = await createWorkspaceFilePath(
            this.#archiveKey,
            entryPath,
          );

          await mkdir(dirname(workspacePath), { recursive: true });
          await writeFile(workspacePath, content ?? new Uint8Array());
          await upsertOverlay({
            archiveKey: this.#archiveKey,
            archivePath: this.#archivePath,
            entryPath,
            kind: "file",
            workspacePath,
          });
          overlay = await this.#readOverlay(entryPath);
        }

        if (overlay?.workspacePath === undefined) {
          throw new Error("Could not materialize SQLite database.");
        }

        await acquireSqliteLease({
          archiveKey: this.#archiveKey,
          entryPath,
          mode: options.readonly ? "read" : "write",
          ownerId: this.#sqliteLeaseOwnerId,
        });
        return overlay.workspacePath;
      },
    );
  }

  public async writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean },
  ): Promise<void> {
    const entryPath = this.#toEntryPath(path);

    await withEntryLock(this.#archiveKey, entryPath, "write", async () => {
      const source = await withEntryLock(
        this.#archiveKey,
        entryPath,
        "state",
        async () =>
          await resolveEntrySource({
            archiveKey: this.#archiveKey,
            entryPath,
          }),
      );
      const archiveEntryExists =
        source.kind === "archive" &&
        (await this.#readArchiveEntry(entryPath)) !== undefined;

      if (
        options.overwrite !== true &&
        (source.kind === "workspace" || archiveEntryExists)
      ) {
        throw new Error(`File already exists: ${path}`);
      }

      await withEntryLock(this.#archiveKey, entryPath, "state", async () => {
        const workspacePath = await createWorkspaceFilePath(
          this.#archiveKey,
          entryPath,
        );

        await mkdir(dirname(workspacePath), { recursive: true });
        const temporaryWorkspacePath = `${workspacePath}.${process.pid}.${Date.now()}.tmp`;

        try {
          await writeFile(temporaryWorkspacePath, content);
          await rename(temporaryWorkspacePath, workspacePath);
        } finally {
          await rm(temporaryWorkspacePath, { force: true }).catch(
            () => undefined,
          );
        }
        await upsertOverlay({
          archiveKey: this.#archiveKey,
          archivePath: this.#archivePath,
          entryPath,
          kind: "file",
          workspacePath,
        });
        this.#entrySourceByPath?.set(entryPath, {
          kind: "workspace",
          path: workspacePath,
        });
        if (source.kind === "workspace" && source.path !== workspacePath) {
          await rm(source.path, { force: true }).catch(() => undefined);
        }
        this.#session?.modifyEntry(entryPath);
      });
    });
  }

  #toEntryPath(path: string): string {
    const resolvedPath = resolve(path);
    const rootPrefix = this.#archivePath.endsWith("/")
      ? this.#archivePath
      : `${this.#archivePath}/`;

    if (resolvedPath.startsWith(rootPrefix)) {
      return normalizeEntryPath(resolvedPath.slice(rootPrefix.length));
    }

    return normalizeEntryPath(path);
  }

  async #listArchiveEntries(): Promise<readonly string[]> {
    return (await this.#getArchiveReader()).listEntries();
  }

  async #readArchiveEntry(entryPath: string): Promise<Buffer | undefined> {
    return await (await this.#getArchiveReader()).readEntry(entryPath);
  }

  async #getArchiveReader(): Promise<WikgArchiveReader> {
    this.#archiveReader ??= WikgArchiveReader.open(this.#archivePath);
    return await this.#archiveReader;
  }

  async #getEntrySources(): Promise<
    Map<
      string,
      | { readonly kind: "archive" }
      | { readonly kind: "deleted" }
      | { readonly kind: "workspace"; readonly path: string }
    >
  > {
    if (this.#entrySourceByPath !== undefined) {
      return this.#entrySourceByPath;
    }

    const entries = new Map<
      string,
      | { readonly kind: "archive" }
      | { readonly kind: "deleted" }
      | { readonly kind: "workspace"; readonly path: string }
    >();

    for (const entryPath of await this.#listArchiveEntries()) {
      entries.set(entryPath, { kind: "archive" });
    }
    for (const overlay of await listOverlays(this.#archiveKey)) {
      if (overlay.kind === "deleted") {
        entries.set(overlay.entryPath, { kind: "deleted" });
      } else if (overlay.workspacePath !== undefined) {
        entries.set(overlay.entryPath, {
          kind: "workspace",
          path: overlay.workspacePath,
        });
      }
    }

    this.#entrySourceByPath = entries;
    return entries;
  }

  async #listDirectoryEntryPaths(
    prefix: string,
  ): Promise<
    Array<
      readonly [
        string,
        (
          | { readonly kind: "archive" }
          | { readonly kind: "workspace"; readonly path: string }
        ),
      ]
    >
  > {
    const entries: Array<
      readonly [
        string,
        (
          | { readonly kind: "archive" }
          | { readonly kind: "workspace"; readonly path: string }
        ),
      ]
    > = [];

    for (const [entryPath, source] of await this.#getEntrySources()) {
      if (source.kind === "deleted" || !entryPath.startsWith(prefix)) {
        continue;
      }

      entries.push([entryPath, source]);
    }

    return entries.sort(([left], [right]) => left.localeCompare(right));
  }
}

async function flushArchiveOverlays(
  archiveKey: string,
  requestedEntryPaths?: ReadonlySet<string>,
): Promise<void> {
  const overlays = (await listOverlays(archiveKey)).filter(
    (overlay) =>
      requestedEntryPaths === undefined ||
      requestedEntryPaths.has(overlay.entryPath),
  );
  const archivePath = await resolveArchivePathFromKey(archiveKey);

  if (overlays.length === 0 || archivePath === undefined) {
    return;
  }

  const entryPaths = overlays
    .map((overlay) => overlay.entryPath)
    .sort((left, right) => left.localeCompare(right));
  const lockedEntryPaths = new Set(entryPaths);
  const releaseLocks: Array<() => Promise<void>> = [];

  try {
    for (const entryPath of entryPaths) {
      releaseLocks.push(await acquireEntryLock(archiveKey, entryPath, "write"));
    }
    for (const entryPath of entryPaths) {
      releaseLocks.push(await acquireEntryLock(archiveKey, entryPath, "state"));
    }

    if (entryPaths.includes(DATABASE_ENTRY_PATH)) {
      await waitForSqliteLeasesToDrain(archiveKey, DATABASE_ENTRY_PATH);
    }
    if (entryPaths.includes(SEARCH_INDEX_DATABASE_ENTRY_PATH)) {
      await waitForSqliteLeasesToDrain(
        archiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
      );
    }

    const currentOverlays = (await listOverlays(archiveKey)).filter((overlay) =>
      lockedEntryPaths.has(overlay.entryPath),
    );

    if (currentOverlays.length === 0) {
      return;
    }

    const releaseCommit = await acquireArchiveCommitLock(archiveKey);

    try {
      const temporaryDirectoryPath = await mkdtemp(
        join(tmpdir(), "wikigraph-flush-"),
      );
      const temporaryArchivePath = join(
        temporaryDirectoryPath,
        basename(archivePath),
      );

      try {
        await writeWikgArchiveWithOverlays(
          archivePath,
          temporaryArchivePath,
          currentOverlays.map(toArchiveOverlay),
        );
        await mkdir(dirname(archivePath), { recursive: true });
        await rename(temporaryArchivePath, archivePath);
      } finally {
        await rm(temporaryDirectoryPath, { force: true, recursive: true });
      }
    } finally {
      await releaseCommit();
    }

    for (const overlay of currentOverlays) {
      await deleteOverlay(archiveKey, overlay.entryPath);
      if (overlay.workspacePath !== undefined) {
        await rm(overlay.workspacePath, { force: true });
      }
    }
  } finally {
    for (const release of releaseLocks.reverse()) {
      await release();
    }
  }
}

async function acquireArchiveCommitLock(
  archiveKey: string,
): Promise<() => Promise<void>> {
  const ownerId = createOwnerId();

  while (true) {
    const acquired = await withStateDatabase(async (state) => {
      await cleanupStaleState(state);
      return await state.transaction(async () => {
        const existing = await state.queryOne(
          "SELECT * FROM archive_commit_locks WHERE archive_key = ?",
          [archiveKey],
          mapArchiveCommitLock,
        );

        if (existing !== undefined) {
          return false;
        }

        await state.run(
          `
INSERT INTO archive_commit_locks (
  archive_key, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?)
`,
          [archiveKey, ownerId, process.pid, Date.now(), Date.now()],
        );
        return true;
      });
    });

    if (acquired) {
      return async () => {
        await withStateDatabase(async (releaseState) => {
          await releaseState.run(
            "DELETE FROM archive_commit_locks WHERE archive_key = ? AND owner_id = ?",
            [archiveKey, ownerId],
          );
        });
      };
    }

    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

async function registerArchiveOwner(input: {
  readonly archiveKey: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    await state.run(
      `
INSERT OR REPLACE INTO archive_owners (
  archive_key, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?)
`,
      [input.archiveKey, input.ownerId, process.pid, Date.now(), Date.now()],
    );
  });
}

async function heartbeatArchiveOwner(input: {
  readonly archiveKey: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.run(
      `
UPDATE archive_owners
SET heartbeat_at = ?, owner_pid = ?
WHERE archive_key = ? AND owner_id = ?
`,
      [Date.now(), process.pid, input.archiveKey, input.ownerId],
    );
  });
}

async function unregisterArchiveOwner(input: {
  readonly archiveKey: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.transaction(async () => {
      await state.run(
        "DELETE FROM entry_sqlite_leases WHERE archive_key = ? AND owner_id = ?",
        [input.archiveKey, input.ownerId],
      );
      await state.run(
        "DELETE FROM archive_owners WHERE archive_key = ? AND owner_id = ?",
        [input.archiveKey, input.ownerId],
      );
    });
  });
}

async function reapArchive(archiveKey: string): Promise<void> {
  await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
  });

  const staleOwnerIds = await withStateDatabase(
    async (state) =>
      await state.queryAll(
        `
SELECT owner_id
FROM archive_owners
WHERE archive_key = ?
  AND heartbeat_at <= ?
`,
        [archiveKey, Date.now() - LOCK_STALE_TIMEOUT_MS],
        (row) => getString(row, "owner_id"),
      ),
  );

  if (staleOwnerIds.length === 0) {
    return;
  }

  await withStateDatabase(async (state) => {
    await state.transaction(async () => {
      await state.run(
        `
DELETE FROM entry_sqlite_leases
WHERE archive_key = ?
  AND owner_id IN (${createPlaceholders(staleOwnerIds.length)})
`,
        [archiveKey, ...staleOwnerIds],
      );
      await state.run(
        `
DELETE FROM archive_owners
WHERE archive_key = ?
  AND owner_id IN (${createPlaceholders(staleOwnerIds.length)})
`,
        [archiveKey, ...staleOwnerIds],
      );
    });
  });

  await flushArchiveOverlays(archiveKey);
}

async function acquireEntryLock(
  archiveKey: string,
  entryPath: string,
  mode: EntryLockMode,
): Promise<() => Promise<void>> {
  const ownerId = createOwnerId();

  while (true) {
    const acquired = await withStateDatabase(async (state) => {
      await cleanupStaleState(state);
      return await state.transaction(async () => {
        const conflicts = await state.queryAll(
          `
SELECT *
FROM entry_locks
WHERE archive_key = ?
`,
          [archiveKey],
          mapEntryLock,
        );

        if (
          conflicts.some(
            (lock) =>
              lock.ownerId !== ownerId &&
              lockPathsConflict(entryPath, lock.entryPath) &&
              locksConflict(mode, lock.mode),
          )
        ) {
          return false;
        }

        await state.run(
          `
INSERT INTO entry_locks (
  archive_key, entry_path, mode, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`,
          [
            archiveKey,
            entryPath,
            mode,
            ownerId,
            process.pid,
            Date.now(),
            Date.now(),
          ],
        );
        return true;
      });
    });

    if (acquired) {
      return async () => {
        await withStateDatabase(async (releaseState) => {
          await releaseState.run(
            `
DELETE FROM entry_locks
WHERE archive_key = ? AND entry_path = ? AND owner_id = ?
`,
            [archiveKey, entryPath, ownerId],
          );
        });
      };
    }

    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

async function withEntryLock<T>(
  archiveKey: string,
  entryPath: string,
  mode: EntryLockMode,
  operation: () => Promise<T> | T,
): Promise<T> {
  const release = await acquireEntryLock(archiveKey, entryPath, mode);

  try {
    return await operation();
  } finally {
    await release();
  }
}

function locksConflict(requested: EntryLockMode, existing: EntryLockMode) {
  if (requested === "state" || existing === "state") {
    return requested === "state" && existing === "state";
  }
  if (requested === "read" && existing === "read") {
    return false;
  }

  return true;
}

function lockPathsConflict(requested: string, existing: string): boolean {
  return (
    requested === existing ||
    lockPathContains(requested, existing) ||
    lockPathContains(existing, requested)
  );
}

function lockPathContains(parent: string, child: string): boolean {
  return parent.endsWith("/") && child.startsWith(parent);
}

async function acquireSqliteLease(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
  readonly mode: SqliteLeaseMode;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    await state.run(
      `
INSERT OR REPLACE INTO entry_sqlite_leases (
  archive_key, entry_path, mode, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`,
      [
        input.archiveKey,
        input.entryPath,
        input.mode,
        input.ownerId,
        process.pid,
        Date.now(),
        Date.now(),
      ],
    );
  });
}

async function releaseSqliteLease(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.run(
      `
DELETE FROM entry_sqlite_leases
WHERE archive_key = ? AND entry_path = ? AND owner_id = ?
`,
      [input.archiveKey, input.entryPath, input.ownerId],
    );
  });
}

async function waitForSqliteLeasesToDrain(
  archiveKey: string,
  entryPath: string,
): Promise<void> {
  while (true) {
    const count = await withStateDatabase(async (state) => {
      await cleanupStaleState(state);
      return await state.queryOne(
        `
SELECT COUNT(*) AS count
FROM entry_sqlite_leases AS lease
LEFT JOIN archive_owners AS owner
  ON owner.archive_key = lease.archive_key
 AND owner.owner_id = lease.owner_id
WHERE lease.archive_key = ?
  AND lease.entry_path = ?
  AND (
    owner.owner_id IS NULL
    OR owner.heartbeat_at > ?
  )
`,
        [archiveKey, entryPath, Date.now() - LOCK_STALE_TIMEOUT_MS],
        (row) => getNumber(row, "count"),
      );
    });

    if (count === 0) {
      return;
    }

    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

async function listVisibleEntryPaths(
  archiveEntries: readonly string[],
  input: { readonly archiveKey: string; readonly prefix: string },
): Promise<readonly string[]> {
  const matchingArchiveEntries = archiveEntries.filter((entryPath) =>
    entryPath.startsWith(input.prefix),
  );
  const overlays = await withStateDatabase(
    async (state) =>
      await state.queryAll(
        `
SELECT *
FROM entry_overlays
WHERE archive_key = ?
`,
        [input.archiveKey],
        mapEntryOverlay,
      ),
  );
  const entries = new Set(matchingArchiveEntries);

  for (const overlay of overlays) {
    if (!overlay.entryPath.startsWith(input.prefix)) {
      continue;
    }
    if (overlay.kind === "deleted") {
      entries.delete(overlay.entryPath);
    } else {
      entries.add(overlay.entryPath);
    }
  }

  return [...entries].sort((left, right) => left.localeCompare(right));
}

async function resolveEntrySource(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
}): Promise<
  | { readonly kind: "archive" }
  | { readonly kind: "deleted" }
  | { readonly kind: "workspace"; readonly path: string }
> {
  const overlay = await readOverlay(input.archiveKey, input.entryPath);

  if (overlay?.kind === "deleted") {
    return { kind: "deleted" };
  }
  if (overlay?.workspacePath !== undefined) {
    return { kind: "workspace", path: overlay.workspacePath };
  }
  return { kind: "archive" };
}

async function readOverlay(
  archiveKey: string,
  entryPath: string,
): Promise<EntryOverlay | undefined> {
  return await withStateDatabase(
    async (state) =>
      await state.queryOne(
        "SELECT * FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
        [archiveKey, entryPath],
        mapEntryOverlay,
      ),
  );
}

async function listOverlays(
  archiveKey: string,
): Promise<readonly EntryOverlay[]> {
  return await withStateDatabase(
    async (state) =>
      await state.queryAll(
        `
SELECT *
FROM entry_overlays
WHERE archive_key = ?
ORDER BY entry_path ASC
`,
        [archiveKey],
        mapEntryOverlay,
      ),
  );
}

async function upsertOverlay(input: {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly entryPath: string;
  readonly kind: "deleted" | "file";
  readonly workspacePath?: string;
}): Promise<void> {
  const mutationToken =
    input.entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH
      ? await readWikgArchiveMutationToken(input.archivePath)
      : undefined;

  await withStateDatabase(async (state) => {
    await state.run(
      `
INSERT INTO entry_overlays (
  archive_key, archive_path, entry_path, kind, workspace_path,
  archive_signature, mutation_token, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(archive_key, entry_path)
DO UPDATE SET kind = excluded.kind,
              archive_path = excluded.archive_path,
              workspace_path = excluded.workspace_path,
              archive_signature = excluded.archive_signature,
              mutation_token = excluded.mutation_token,
              updated_at = excluded.updated_at
`,
      [
        input.archiveKey,
        input.archivePath,
        input.entryPath,
        input.kind,
        input.workspacePath ?? null,
        await createArchiveSignature(input.archivePath),
        mutationToken ?? null,
        Date.now(),
      ],
    );
  });
}

async function tryAdoptSearchIndexCacheOverlay(input: {
  readonly targetArchiveKey: string;
  readonly targetArchivePath: string;
}): Promise<void> {
  const mutationToken = await readWikgArchiveMutationToken(
    input.targetArchivePath,
  );
  const candidates = await listSearchIndexAdoptionCandidates({
    mutationToken,
    targetArchiveKey: input.targetArchiveKey,
  });
  const adoptable: EntryOverlay[] = [];

  for (const candidate of candidates) {
    if (
      candidate.workspacePath === undefined ||
      (await pathExists(candidate.archivePath)) ||
      (await hasActiveWorkspaceUse(candidate.archiveKey))
    ) {
      continue;
    }

    adoptable.push(candidate);
  }

  if (adoptable.length !== 1) {
    return;
  }

  const candidate = adoptable[0]!;
  const releaseWriteLock = await acquireEntryLock(
    candidate.archiveKey,
    SEARCH_INDEX_DATABASE_ENTRY_PATH,
    "write",
  );

  try {
    const releaseStateLock = await acquireEntryLock(
      candidate.archiveKey,
      SEARCH_INDEX_DATABASE_ENTRY_PATH,
      "state",
    );

    try {
      const current = await readOverlay(
        candidate.archiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
      );
      const target = await readOverlay(
        input.targetArchiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
      );

      if (
        current?.workspacePath === undefined ||
        current.workspacePath !== candidate.workspacePath ||
        current.mutationToken !== mutationToken ||
        target !== undefined ||
        (await pathExists(candidate.archivePath)) ||
        (await hasActiveArchiveOwnerOrSqliteLease(
          candidate.archiveKey,
          SEARCH_INDEX_DATABASE_ENTRY_PATH,
        ))
      ) {
        return;
      }

      const targetWorkspacePath = await createWorkspaceFilePath(
        input.targetArchiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
      );

      await rm(targetWorkspacePath, { force: true }).catch(() => undefined);
      await mkdir(dirname(targetWorkspacePath), { recursive: true });
      await rename(current.workspacePath, targetWorkspacePath);
      await withStateDatabase(async (state) => {
        await state.run(
          `
UPDATE entry_overlays
SET archive_key = ?,
    archive_path = ?,
    workspace_path = ?,
    archive_signature = ?,
    updated_at = ?
WHERE archive_key = ?
  AND entry_path = ?
`,
          [
            input.targetArchiveKey,
            input.targetArchivePath,
            targetWorkspacePath,
            await createArchiveSignature(input.targetArchivePath),
            Date.now(),
            candidate.archiveKey,
            SEARCH_INDEX_DATABASE_ENTRY_PATH,
          ],
        );
      });
    } finally {
      await releaseStateLock();
    }
  } finally {
    await releaseWriteLock();
  }
}

async function listSearchIndexAdoptionCandidates(input: {
  readonly mutationToken: string;
  readonly targetArchiveKey: string;
}): Promise<readonly EntryOverlay[]> {
  return await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    return await state.queryAll(
      `
SELECT *
FROM entry_overlays
WHERE entry_path = ?
  AND kind = 'file'
  AND workspace_path IS NOT NULL
  AND mutation_token = ?
  AND archive_key <> ?
ORDER BY updated_at ASC
`,
      [
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
        input.mutationToken,
        input.targetArchiveKey,
      ],
      mapEntryOverlay,
    );
  });
}

async function deleteOverlay(
  archiveKey: string,
  entryPath: string,
): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.run(
      "DELETE FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
      [archiveKey, entryPath],
    );
  });
}

async function resolveArchivePathFromKey(
  archiveKey: string,
): Promise<string | undefined> {
  return await withStateDatabase(
    async (state) =>
      await state.queryOne(
        "SELECT archive_path FROM entry_overlays WHERE archive_key = ? LIMIT 1",
        [archiveKey],
        (row) => getString(row, "archive_path"),
      ),
  );
}

async function cleanupStaleState(state: Database): Promise<void> {
  const now = Date.now();
  const staleOwnerPids = new Set<number>();

  for (const tableName of [
    "archive_owners",
    "entry_locks",
    "entry_sqlite_leases",
    "archive_commit_locks",
  ]) {
    const rows = await state.queryAll(
      `
SELECT DISTINCT owner_pid
FROM ${tableName}
WHERE owner_pid IS NOT NULL
  AND heartbeat_at <= ?
`,
      [now - LOCK_STALE_TIMEOUT_MS],
      (row) => getNumber(row, "owner_pid"),
    );

    for (const ownerPid of rows) {
      if (!isProcessAlive(ownerPid)) {
        staleOwnerPids.add(ownerPid);
      }
    }
  }

  if (staleOwnerPids.size === 0) {
    return;
  }

  await state.run(
    `
DELETE FROM archive_owners
WHERE owner_pid IN (${createPlaceholders(staleOwnerPids.size)})
`,
    [...staleOwnerPids],
  );
  await state.run(
    `
DELETE FROM entry_locks
WHERE owner_pid IN (${createPlaceholders(staleOwnerPids.size)})
`,
    [...staleOwnerPids],
  );
  await state.run(
    `
DELETE FROM entry_sqlite_leases
WHERE owner_pid IN (${createPlaceholders(staleOwnerPids.size)})
`,
    [...staleOwnerPids],
  );
  await state.run(
    `
DELETE FROM archive_commit_locks
WHERE owner_pid IN (${createPlaceholders(staleOwnerPids.size)})
`,
    [...staleOwnerPids],
  );
}

function createPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }

    return true;
  }
}

async function withStateDatabase<T>(
  operation: (state: Database) => Promise<T> | T,
): Promise<T> {
  return await STATE_DATABASE_SEMAPHORE.use(async () => {
    const state = await openStateDatabase();

    try {
      return await operation(state);
    } finally {
      await state.close();
    }
  });
}

async function openStateDatabase(): Promise<Database> {
  const database = await openSharedStateDatabase(
    join(getCoordinatorStateDirectoryPath(), "staging.sqlite"),
    STATE_SCHEMA_SQL,
  );

  await migrateStateDatabase(database);
  return database;
}

async function migrateStateDatabase(database: Database): Promise<void> {
  const overlayColumns = await database.queryAll(
    "PRAGMA table_info(entry_overlays)",
    undefined,
    (row) => getString(row, "name"),
  );

  if (!overlayColumns.includes("archive_signature")) {
    await database.run(`
      ALTER TABLE entry_overlays
      ADD COLUMN archive_signature TEXT
    `);
  }

  if (!overlayColumns.includes("mutation_token")) {
    await database.run(`
      ALTER TABLE entry_overlays
      ADD COLUMN mutation_token TEXT
    `);
  }

  const sqliteLeaseColumns = await database.queryAll(
    "PRAGMA table_info(entry_sqlite_leases)",
    undefined,
    (row) => getString(row, "name"),
  );

  if (!sqliteLeaseColumns.includes("mode")) {
    await database.run(`
      ALTER TABLE entry_sqlite_leases
      ADD COLUMN mode TEXT NOT NULL DEFAULT 'read'
    `);
  }
}

async function createWorkspaceFilePath(
  archiveKey: string,
  entryPath: string,
): Promise<string> {
  const directoryPath = join(
    getCoordinatorWorkspaceRootPath(),
    archiveKey,
    dirname(entryPath),
  );

  await mkdir(directoryPath, { recursive: true });
  return join(directoryPath, basename(entryPath));
}

function getCoordinatorWorkspaceRootPath(): string {
  return join(getCoordinatorStateDirectoryPath(), "work");
}

async function ensureEmptyDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });

  const entries = await readdir(directoryPath);

  if (entries.length > 0) {
    throw new Error(`Read workspace directory is not empty: ${directoryPath}`);
  }
}

async function listWorkspaceFiles(directoryPath: string): Promise<string[]> {
  let entries: readonly WorkspaceDirectoryEntry[];

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listWorkspaceFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

function toArchiveOverlay(overlay: EntryOverlay): WikgArchiveOverlay {
  if (overlay.kind === "deleted") {
    return {
      entryPath: overlay.entryPath,
      kind: "deleted",
    };
  }
  if (overlay.workspacePath === undefined) {
    throw new Error(`Missing workspace path for ${overlay.entryPath}.`);
  }

  return {
    entryPath: overlay.entryPath,
    kind: "file",
    workspacePath: overlay.workspacePath,
  };
}

function normalizeEntryPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/u, "");
}

function normalizeEntryDirectoryPrefix(path: string): string {
  const entryPath = normalizeEntryPath(path);

  return entryPath === "" || entryPath.endsWith("/")
    ? entryPath
    : `${entryPath}/`;
}

function getCoordinatorStateDirectoryPath(): string {
  return resolveWikiGraphStagingDirectoryPath();
}

function createArchiveKey(archivePath: string): string {
  return createHash("sha256").update(resolve(archivePath)).digest("hex");
}

async function createArchiveSignature(archivePath: string): Promise<string> {
  const stats = await stat(archivePath);

  return `${stats.size}:${stats.mtimeMs}`;
}

function createOwnerId(): string {
  return `${process.pid}-${randomUUID()}`;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
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

interface EntryOverlay {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly archiveSignature?: string;
  readonly entryPath: string;
  readonly kind: "deleted" | "file";
  readonly mutationToken?: string;
  readonly updatedAt: number;
  readonly workspacePath?: string;
}

interface EntryLock {
  readonly entryPath: string;
  readonly mode: EntryLockMode;
  readonly ownerId: string;
}

interface ArchiveCommitLock {
  readonly ownerId: string;
}

interface WorkspaceDirectoryEntry {
  isDirectory(): boolean;
  isFile(): boolean;
  readonly name: string;
}

function mapEntryOverlay(row: Record<string, unknown>): EntryOverlay {
  const workspacePath = getOptionalString(row, "workspace_path");
  const archiveSignature = getOptionalString(row, "archive_signature");
  const mutationToken = getOptionalString(row, "mutation_token");

  return {
    archiveKey: getString(row, "archive_key"),
    archivePath: getString(row, "archive_path"),
    ...(archiveSignature === undefined ? {} : { archiveSignature }),
    entryPath: getString(row, "entry_path"),
    kind: getOverlayKind(row),
    ...(mutationToken === undefined ? {} : { mutationToken }),
    updatedAt: getNumber(row, "updated_at"),
    ...(workspacePath === undefined ? {} : { workspacePath }),
  };
}

function mapEntryLock(row: Record<string, unknown>): EntryLock {
  return {
    entryPath: getString(row, "entry_path"),
    mode: getEntryLockMode(row),
    ownerId: getString(row, "owner_id"),
  };
}

function mapArchiveCommitLock(row: Record<string, unknown>): ArchiveCommitLock {
  return {
    ownerId: getString(row, "owner_id"),
  };
}

function getEntryLockMode(row: Record<string, unknown>): EntryLockMode {
  const mode = getString(row, "mode");

  if (mode === "read" || mode === "state" || mode === "write") {
    return mode;
  }

  throw new Error(`Unsupported entry lock mode: ${mode}.`);
}

function getOverlayKind(row: Record<string, unknown>): "deleted" | "file" {
  const kind = getString(row, "kind");

  if (kind === "deleted" || kind === "file") {
    return kind;
  }

  throw new Error(`Unsupported entry overlay kind: ${kind}.`);
}

function getString(row: Record<string, unknown>, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

function getNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}

function getOptionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

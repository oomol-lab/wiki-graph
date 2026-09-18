import type {
  File,
  FileReader,
  FileWriter,
} from "../../../runtime/platform/index.js";
import {
  ensureRelativeDirectory,
  ensureRelativeFile,
  getRelativeDirectory,
  getWikiGraphStorage,
} from "../../../runtime/platform/index.js";
import type { DocumentFileStore } from "../../../document/directory/index.js";
import { createPortableHash } from "../../../utils/crypto.js";

import {
  readWikgArchiveMutationToken,
  WikgArchiveReader,
} from "../archive/reader.js";
import { parseWikgMutationToken } from "../archive/manifest.js";
import { normalizeArchivePath } from "../archive/paths.js";
import {
  DATABASE_ENTRY_PATH,
  LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH,
  OWNER_HEARTBEAT_INTERVAL_MS,
  SEARCH_INDEX_DATABASE_ENTRY_PATH,
} from "./constants.js";
import { flushArchiveOverlays, reapArchive } from "./flusher.js";
import { HostWikgDocumentFileStore } from "./host-file-store.js";
import {
  acquireSqliteLease,
  releaseSqliteLease,
  waitForSqliteLeasesToDrain,
  withEntryLock,
} from "./locks.js";
import {
  createCoordinatorOwner,
  heartbeatArchiveOwner,
  registerArchiveOwner,
  unregisterArchiveOwner,
} from "./owners.js";
import {
  isDirtyOverlay,
  deleteCleanOverlayIfUnused,
  listOverlays,
  publishDeleteOverlay,
  publishFileOverlay,
  readOverlay,
  resolveOverlayFile,
  restoreOverlay,
} from "./overlays.js";
import type {
  CoordinatorOwner,
  EntryOverlay,
  SqliteLeaseMode,
  WorkspaceWritebackPolicy,
} from "./types.js";
import {
  createWorkspaceSnapshot,
  removeWorkspaceSnapshot,
} from "./workspace.js";

interface SessionChange {
  current: EntryOverlay;
  readonly previous: EntryOverlay | undefined;
}

/** Run one archive operation within a durable, host-neutral session. */
export async function withHostArchiveSession<T>(
  archive: File,
  operation: (session: HostWikgArchiveSession) => Promise<T> | T,
): Promise<T> {
  const session = await HostWikgArchiveSession.open(archive);
  try {
    return await operation(session);
  } catch (error) {
    await session.abort();
    throw error;
  } finally {
    await session.close();
  }
}

/** Coordinates logical archive state without observing host locations. */
export class HostWikgArchiveSession {
  readonly #archive: File;
  readonly #archiveKey: string;
  readonly #owner: CoordinatorOwner;
  readonly #heartbeat: ReturnType<typeof globalThis.setInterval>;
  readonly #changes = new Map<string, SessionChange>();
  readonly #modifiedEntryPaths = new Set<string>();
  readonly #observedDirtyEntryPaths = new Set<string>();
  readonly #materializedEntryPaths = new Set<string>();
  readonly #leasedEntryPaths = new Set<string>();
  readonly #initialSearchCacheKey: string;
  #searchCacheKey: string;
  #searchCacheFile: File | undefined;
  #searchCacheWorkspacePath: string | undefined;
  #searchCacheDirty = false;
  #searchCacheDelete = false;
  #closed = false;
  #aborted = false;

  // eslint-disable-next-line no-restricted-syntax -- constructors cannot use JavaScript #private syntax.
  private constructor(input: {
    readonly archive: File;
    readonly archiveKey: string;
    readonly initialSearchCacheKey: string;
    readonly owner: CoordinatorOwner;
  }) {
    this.#archive = input.archive;
    this.#archiveKey = input.archiveKey;
    this.#initialSearchCacheKey = input.initialSearchCacheKey;
    this.#searchCacheKey = input.initialSearchCacheKey;
    this.#owner = input.owner;
    this.#heartbeat = globalThis.setInterval(() => {
      void heartbeatArchiveOwner(this.#archiveKey, this.#owner).catch(
        () => undefined,
      );
    }, OWNER_HEARTBEAT_INTERVAL_MS);
  }

  public static async open(archive: File): Promise<HostWikgArchiveSession> {
    const validationReader = await WikgArchiveReader.open(archive);
    await validationReader.close();
    const archiveKey = createPortableHash("sha256")
      .update(archive.identity)
      .digest("hex");
    const owner = createCoordinatorOwner();
    await registerArchiveOwner(archiveKey, owner);
    try {
      await reapArchive(archiveKey, owner, archive);
      const mutationToken = await readWikgArchiveMutationToken(archive);
      return new HostWikgArchiveSession({
        archive,
        archiveKey,
        initialSearchCacheKey: createPortableHash("sha256")
          .update(mutationToken)
          .digest("hex"),
        owner,
      });
    } catch (error) {
      await unregisterArchiveOwner(archiveKey, owner.ownerId);
      throw error;
    }
  }

  public createFileStore(
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
    } = {},
  ): DocumentFileStore {
    return new HostWikgDocumentFileStore(this, options);
  }

  public get archiveIdentity(): string {
    return this.#archive.identity;
  }

  public get searchCacheIdentity(): string {
    return `wikg-search-cache:${this.#searchCacheKey}`;
  }

  public async listEntries(): Promise<readonly string[]> {
    const reader = await WikgArchiveReader.open(this.#archive);
    try {
      const entries = new Set(reader.listEntries());
      for (const overlay of await listOverlays(this.#archiveKey)) {
        if (overlay.kind === "deleted") entries.delete(overlay.entryPath);
        else entries.add(overlay.entryPath);
      }
      return [...entries].sort((left, right) => left.localeCompare(right));
    } finally {
      await reader.close();
    }
  }

  public async readEntry(path: string): Promise<Uint8Array | undefined> {
    const entryPath = normalizeArchivePath(path);
    return await withEntryLock(
      this.#archiveKey,
      entryPath,
      "read",
      this.#owner,
      async () => await this.#readEntryUnlocked(entryPath),
    );
  }

  public async getEntrySize(path: string): Promise<number | undefined> {
    const entryPath = normalizeArchivePath(path);
    return await withEntryLock(
      this.#archiveKey,
      entryPath,
      "read",
      this.#owner,
      async () => {
        const overlay = await readOverlay(this.#archiveKey, entryPath);
        if (overlay?.kind === "deleted") {
          this.#observedDirtyEntryPaths.add(entryPath);
          return undefined;
        }
        if (overlay?.kind === "file") {
          if (await isDirtyOverlay(overlay)) {
            this.#observedDirtyEntryPaths.add(entryPath);
          }
          const file = await resolveOverlayFile(overlay);
          const reader = await file.openReader();
          try {
            return reader.size;
          } finally {
            await reader.close();
          }
        }
        const reader = await WikgArchiveReader.open(this.#archive);
        try {
          return await reader.getEntrySize(entryPath);
        } finally {
          await reader.close();
        }
      },
    );
  }

  public async readEntryRange(
    path: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array | undefined> {
    const entryPath = normalizeArchivePath(path);
    return await withEntryLock(
      this.#archiveKey,
      entryPath,
      "read",
      this.#owner,
      async () => {
        const overlay = await readOverlay(this.#archiveKey, entryPath);
        if (overlay?.kind === "deleted") {
          this.#observedDirtyEntryPaths.add(entryPath);
          return undefined;
        }
        if (overlay?.kind === "file") {
          if (await isDirtyOverlay(overlay)) {
            this.#observedDirtyEntryPaths.add(entryPath);
          }
          const reader = await (await resolveOverlayFile(overlay)).openReader();
          try {
            return await reader.read(offset, length);
          } finally {
            await reader.close();
          }
        }
        const reader = await WikgArchiveReader.open(this.#archive);
        try {
          return await reader.readEntryRange(entryPath, offset, length);
        } finally {
          await reader.close();
        }
      },
    );
  }

  public async appendEntry(path: string, content: Uint8Array): Promise<void> {
    const entryPath = normalizeArchivePath(path);
    await withEntryLock(
      this.#archiveKey,
      entryPath,
      "write",
      this.#owner,
      async () => {
        const previous = await readOverlay(this.#archiveKey, entryPath);
        const snapshot = await createWorkspaceSnapshot(
          this.#archiveKey,
          entryPath,
        );
        try {
          const writer = await snapshot.file.openWriter();
          try {
            await this.#copyEntryToWriter(entryPath, previous, writer);
            await writer.write(content);
            await writer.commit();
          } catch (error) {
            await writer.abort().catch(() => undefined);
            throw error;
          }
          await publishFileOverlay({
            archiveIdentity: this.#archive.identity,
            archiveKey: this.#archiveKey,
            entryPath,
            owner: this.#owner,
            workspaceFile: snapshot.file,
            workspacePath: snapshot.relativePath,
          });
        } catch (error) {
          await removeWorkspaceSnapshot(snapshot.relativePath);
          throw error;
        }
        await this.#recordChange(entryPath, previous);
        this.#modifiedEntryPaths.add(entryPath);
      },
    );
  }

  public async writeEntry(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean } = {},
  ): Promise<void> {
    const entryPath = normalizeArchivePath(path);
    await withEntryLock(
      this.#archiveKey,
      entryPath,
      "write",
      this.#owner,
      async () => {
        if (isSqliteEntry(entryPath)) {
          await waitForSqliteLeasesToDrain(
            this.#archiveKey,
            entryPath,
            this.#owner,
          );
        }
        const previous = await readOverlay(this.#archiveKey, entryPath);
        if (
          options.overwrite !== true &&
          previous?.kind !== "deleted" &&
          (previous !== undefined ||
            (await this.#readArchiveEntry(entryPath)) !== undefined)
        ) {
          throw new Error(`File already exists: ${path}`);
        }
        const snapshot = await createWorkspaceSnapshot(
          this.#archiveKey,
          entryPath,
        );
        try {
          await replaceFile(snapshot.file, content);
          await publishFileOverlay({
            archiveIdentity: this.#archive.identity,
            archiveKey: this.#archiveKey,
            entryPath,
            owner: this.#owner,
            workspaceFile: snapshot.file,
            workspacePath: snapshot.relativePath,
          });
        } catch (error) {
          await removeWorkspaceSnapshot(snapshot.relativePath);
          throw error;
        }
        await this.#recordChange(entryPath, previous);
        this.#modifiedEntryPaths.add(entryPath);
      },
    );
  }

  public async deleteEntry(path: string): Promise<void> {
    const entryPath = normalizeArchivePath(path);
    await withEntryLock(
      this.#archiveKey,
      entryPath,
      "write",
      this.#owner,
      async () => {
        if (isSqliteEntry(entryPath)) {
          await waitForSqliteLeasesToDrain(
            this.#archiveKey,
            entryPath,
            this.#owner,
          );
        }
        const previous = await readOverlay(this.#archiveKey, entryPath);
        await publishDeleteOverlay({
          archiveIdentity: this.#archive.identity,
          archiveKey: this.#archiveKey,
          entryPath,
          owner: this.#owner,
        });
        await this.#recordChange(entryPath, previous);
        this.#modifiedEntryPaths.add(entryPath);
      },
    );
  }

  public async materializeDatabase(
    path: string,
    options: {
      readonly createIfMissing: boolean;
      readonly mode: SqliteLeaseMode;
    },
  ): Promise<File> {
    const entryPath = normalizeArchivePath(path);
    await acquireSqliteLease({
      archiveKey: this.#archiveKey,
      entryPath,
      mode: options.mode,
      owner: this.#owner,
    });
    this.#leasedEntryPaths.add(entryPath);
    try {
      return await withEntryLock(
        this.#archiveKey,
        entryPath,
        "state",
        this.#owner,
        async () => {
          const existing = await readOverlay(this.#archiveKey, entryPath);
          if (existing?.kind === "file") {
            if (await isDirtyOverlay(existing)) {
              this.#observedDirtyEntryPaths.add(entryPath);
            }
            this.#materializedEntryPaths.add(entryPath);
            return await resolveOverlayFile(existing);
          }

          const content = await this.#readArchiveEntry(entryPath);
          if (content === undefined && !options.createIfMissing) {
            throw new Error(`Archive SQLite entry is missing: ${entryPath}`);
          }
          const bytes = content ?? new Uint8Array();
          const snapshot = await createWorkspaceSnapshot(
            this.#archiveKey,
            entryPath,
          );
          try {
            await replaceFile(snapshot.file, bytes);
            await publishFileOverlay({
              archiveIdentity: this.#archive.identity,
              archiveKey: this.#archiveKey,
              baseDigest: createPortableHash("sha256")
                .update(bytes)
                .digest("hex"),
              entryPath,
              owner: this.#owner,
              workspaceFile: snapshot.file,
              workspacePath: snapshot.relativePath,
            });
          } catch (error) {
            await removeWorkspaceSnapshot(snapshot.relativePath);
            throw error;
          }
          await this.#recordChange(entryPath, existing);
          this.#materializedEntryPaths.add(entryPath);
          return snapshot.file;
        },
      );
    } catch (error) {
      await this.releaseDatabaseLease(entryPath);
      throw error;
    }
  }

  public async materializeSearchIndexCache(options: {
    readonly createIfMissing: boolean;
  }): Promise<File> {
    if (this.#searchCacheFile !== undefined) return this.#searchCacheFile;
    const persistent = this.#searchCacheDelete
      ? undefined
      : await this.#getPersistentSearchIndexCache(
          this.#initialSearchCacheKey,
          false,
        );
    const content =
      (persistent === undefined ? undefined : await readBytes(persistent)) ??
      (await this.readEntry(SEARCH_INDEX_DATABASE_ENTRY_PATH)) ??
      (await this.readEntry(LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH));
    if (content === undefined && !options.createIfMissing) {
      throw new Error(
        `Archive SQLite entry is missing: ${SEARCH_INDEX_DATABASE_ENTRY_PATH}`,
      );
    }
    const snapshot = await createWorkspaceSnapshot(
      this.#archiveKey,
      SEARCH_INDEX_DATABASE_ENTRY_PATH,
    );
    await replaceFile(snapshot.file, content ?? new Uint8Array());
    this.#searchCacheFile = snapshot.file;
    this.#searchCacheWorkspacePath = snapshot.relativePath;
    if (persistent === undefined && content !== undefined) {
      this.#searchCacheDirty = true;
    }
    return snapshot.file;
  }

  public markDatabaseDirty(path: string): void {
    this.#modifiedEntryPaths.add(normalizeArchivePath(path));
  }

  public markSearchIndexCacheDirty(file: File): void {
    this.#searchCacheFile = file;
    this.#searchCacheDirty = true;
    this.#searchCacheDelete = false;
  }

  public deleteSearchIndexCache(): void {
    this.#searchCacheDirty = false;
    this.#searchCacheDelete = true;
  }

  public async releaseDatabaseLease(path: string): Promise<void> {
    const entryPath = normalizeArchivePath(path);
    if (!this.#leasedEntryPaths.delete(entryPath)) return;
    await releaseSqliteLease({
      archiveKey: this.#archiveKey,
      entryPath,
      ownerId: this.#owner.ownerId,
    });
  }

  public async abort(): Promise<void> {
    if (this.#aborted) return;
    this.#aborted = true;
    await this.#rollbackChanges();
    await this.#cleanupSearchCacheWorkspace();
  }

  public async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    globalThis.clearInterval(this.#heartbeat);
    try {
      for (const entryPath of [...this.#leasedEntryPaths]) {
        await this.releaseDatabaseLease(entryPath);
      }
      if (!this.#aborted) {
        for (const entryPath of this.#materializedEntryPaths) {
          const overlay = await readOverlay(this.#archiveKey, entryPath);
          if (overlay !== undefined && (await isDirtyOverlay(overlay))) {
            this.#modifiedEntryPaths.add(entryPath);
          }
        }
        const requested = new Set([
          ...this.#observedDirtyEntryPaths,
          ...this.#modifiedEntryPaths,
        ]);
        if (requested.size > 0) {
          const mutationToken = await flushArchiveOverlays(
            this.#archiveKey,
            this.#owner,
            requested,
            this.#archive,
          );
          if (mutationToken !== undefined) {
            this.#searchCacheKey = createSearchCacheKey(mutationToken);
          }
        }
        await reapArchive(this.#archiveKey, this.#owner, this.#archive);
        await this.#settleSearchIndexCache();
        for (const entryPath of this.#materializedEntryPaths) {
          const overlay = await readOverlay(this.#archiveKey, entryPath);
          if (overlay !== undefined) {
            await deleteCleanOverlayIfUnused(overlay);
          }
        }
        await this.#cleanupSupersededSnapshots();
      }
    } catch (error) {
      await this.#rollbackChanges().catch(() => undefined);
      throw error;
    } finally {
      await this.#cleanupSearchCacheWorkspace();
      await unregisterArchiveOwner(this.#archiveKey, this.#owner.ownerId);
    }
  }

  async #readEntryUnlocked(entryPath: string): Promise<Uint8Array | undefined> {
    const overlay = await readOverlay(this.#archiveKey, entryPath);
    if (overlay?.kind === "deleted") {
      this.#observedDirtyEntryPaths.add(entryPath);
      return undefined;
    }
    if (overlay?.kind === "file") {
      if (await isDirtyOverlay(overlay)) {
        this.#observedDirtyEntryPaths.add(entryPath);
      }
      return await readBytes(await resolveOverlayFile(overlay));
    }
    return await this.#readArchiveEntry(entryPath);
  }

  async #copyEntryToWriter(
    entryPath: string,
    overlay: EntryOverlay | undefined,
    writer: FileWriter,
  ): Promise<void> {
    if (overlay?.kind === "deleted") {
      this.#observedDirtyEntryPaths.add(entryPath);
      return;
    }
    if (overlay?.kind === "file") {
      if (await isDirtyOverlay(overlay)) {
        this.#observedDirtyEntryPaths.add(entryPath);
      }
      const source = await resolveOverlayFile(overlay);
      const reader = await source.openReader();
      try {
        await copyReaderToWriter(reader, writer);
      } finally {
        await reader.close();
      }
      return;
    }

    const archiveReader = await WikgArchiveReader.open(this.#archive);
    try {
      const size = await archiveReader.getEntrySize(entryPath);
      if (size === undefined) return;
      await copyRangeToWriter(
        size,
        async (offset, length) => {
          const chunk = await archiveReader.readEntryRange(
            entryPath,
            offset,
            length,
          );
          if (chunk === undefined) {
            throw new Error(`Archive entry disappeared: ${entryPath}.`);
          }
          return chunk;
        },
        writer,
      );
    } finally {
      await archiveReader.close();
    }
  }

  async #readArchiveEntry(entryPath: string): Promise<Uint8Array | undefined> {
    const reader = await WikgArchiveReader.open(this.#archive);
    try {
      return await reader.readEntry(entryPath);
    } finally {
      await reader.close();
    }
  }

  async #recordChange(
    entryPath: string,
    previous: EntryOverlay | undefined,
  ): Promise<void> {
    const current = await readOverlay(this.#archiveKey, entryPath);
    if (current === undefined) {
      throw new Error(`Could not publish archive entry: ${entryPath}.`);
    }
    const existing = this.#changes.get(entryPath);
    this.#changes.set(entryPath, {
      current,
      previous: existing?.previous ?? previous,
    });
  }

  async #rollbackChanges(): Promise<void> {
    for (const change of [...this.#changes.values()].reverse()) {
      await withEntryLock(
        this.#archiveKey,
        change.current.entryPath,
        "write",
        this.#owner,
        async () => {
          await restoreOverlay(change.current, change.previous);
        },
      );
    }
    this.#changes.clear();
    this.#modifiedEntryPaths.clear();
    this.#observedDirtyEntryPaths.clear();
  }

  async #cleanupSupersededSnapshots(): Promise<void> {
    for (const change of this.#changes.values()) {
      if (change.previous?.workspacePath !== change.current.workspacePath) {
        await removeWorkspaceSnapshot(change.previous?.workspacePath);
      }
    }
    this.#changes.clear();
  }

  async #settleSearchIndexCache(): Promise<void> {
    if (
      this.#searchCacheDelete ||
      this.#initialSearchCacheKey !== this.#searchCacheKey
    ) {
      await this.#removePersistentSearchIndexCache(this.#initialSearchCacheKey);
    }
    if (!this.#searchCacheDirty || this.#searchCacheFile === undefined) return;
    const persistent = await this.#getPersistentSearchIndexCache(
      this.#searchCacheKey,
      true,
    );
    if (persistent === undefined) {
      throw new Error("Could not create the persistent search index cache");
    }
    await replaceFile(persistent, await readBytes(this.#searchCacheFile));
  }

  async #getPersistentSearchIndexCache(
    key: string,
    create: boolean,
  ): Promise<File | undefined> {
    const root = getWikiGraphStorage().documentStore;
    const archiveCache = create
      ? await ensureRelativeDirectory(root, `.wikg-cache/${key}`)
      : await getRelativeDirectory(root, `.wikg-cache/${key}`);
    if (archiveCache === undefined) return undefined;
    return create
      ? await ensureRelativeFile(archiveCache, "index.db")
      : await archiveCache.getFile("index.db");
  }

  async #removePersistentSearchIndexCache(key: string): Promise<void> {
    const cacheRoot =
      await getWikiGraphStorage().documentStore.getDirectory(".wikg-cache");
    const archiveCache = await cacheRoot?.getDirectory(key);
    await archiveCache?.remove("index.db").catch(() => undefined);
  }

  async #cleanupSearchCacheWorkspace(): Promise<void> {
    await removeWorkspaceSnapshot(this.#searchCacheWorkspacePath);
    this.#searchCacheWorkspacePath = undefined;
  }
}

async function copyReaderToWriter(
  reader: FileReader,
  writer: FileWriter,
): Promise<void> {
  await copyRangeToWriter(
    reader.size,
    async (offset, length) => await reader.read(offset, length),
    writer,
  );
}

async function copyRangeToWriter(
  size: number,
  read: (offset: number, length: number) => Promise<Uint8Array>,
  writer: FileWriter,
): Promise<void> {
  for (let offset = 0; offset < size; ) {
    const chunk = await read(offset, Math.min(64 * 1024, size - offset));
    if (chunk.byteLength === 0) {
      throw new Error("Range reader made no progress");
    }
    await writer.write(chunk);
    offset += chunk.byteLength;
  }
}

function createSearchCacheKey(token: string | Uint8Array): string {
  const normalized =
    typeof token === "string"
      ? token
      : parseWikgMutationToken(new TextDecoder().decode(token));
  return createPortableHash("sha256").update(normalized).digest("hex");
}

async function replaceFile(
  file: File,
  content: string | Uint8Array,
): Promise<void> {
  const writer = await file.openWriter();
  try {
    await writer.write(content);
    await writer.commit();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}

async function readBytes(file: File): Promise<Uint8Array> {
  const content = await file.read();
  return typeof content === "string"
    ? new TextEncoder().encode(content)
    : content;
}

function isSqliteEntry(entryPath: string): boolean {
  return (
    entryPath === DATABASE_ENTRY_PATH ||
    entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH ||
    entryPath === LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH
  );
}

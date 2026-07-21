import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname, posix, resolve } from "path";

import type { DocumentFileStore } from "../../../document/directory/index.js";

import { readWikgArchiveEntry, WikgArchiveReader } from "../archive/index.js";

import {
  createArchiveKey,
  createArchiveSignature,
  createOwnerId,
} from "./archive-key.js";
import { DATABASE_ENTRY_PATH, SEARCH_INDEX_DATABASE_ENTRY_PATH } from "./constants.js";
import { acquireSqliteLease, releaseSqliteLease, withEntryLock } from "./locks.js";
import {
  deleteOverlay,
  listOverlays,
  listVisibleEntryPaths,
  readOverlay,
  resolveEntrySource,
  upsertOverlay,
} from "./overlays.js";
import { tryAdoptSearchIndexCacheOverlay } from "./search-index-cache.js";
import type { EntryOverlay, WorkspaceWritebackPolicy } from "./types.js";
import { createWorkspaceFilePath, normalizeEntryDirectoryPrefix, normalizeEntryPath } from "./workspace.js";
import type { WikgArchiveSession } from "./session.js";

export class WikgDocumentFileStore implements DocumentFileStore {
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

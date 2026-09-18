import type { File } from "../../../runtime/platform/index.js";
import type { DocumentFileStore } from "../../../document/directory/index.js";

import {
  DATABASE_ENTRY_PATH,
  LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH,
  SEARCH_INDEX_DATABASE_ENTRY_PATH,
} from "./constants.js";
import { normalizeArchivePath } from "../archive/paths.js";
import type { HostWikgArchiveSession } from "./host-session.js";
import type { WorkspaceWritebackPolicy } from "./types.js";

export class HostWikgDocumentFileStore implements DocumentFileStore {
  readonly #readonlyDatabase: boolean;
  readonly #searchIndexWritebackPolicy: WorkspaceWritebackPolicy;
  readonly #session: HostWikgArchiveSession;
  #database: File | undefined;
  #searchIndexDatabase: File | undefined;
  #databaseDirty = false;
  #searchIndexDatabaseDirty = false;

  public constructor(
    session: HostWikgArchiveSession,
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
    },
  ) {
    this.#session = session;
    this.#readonlyDatabase = options.readonlyDatabase === true;
    this.#searchIndexWritebackPolicy =
      options.searchIndexWritebackPolicy ?? "cache";
  }

  public async close(): Promise<void> {
    await this.#session.releaseDatabaseLease(DATABASE_ENTRY_PATH);
    await this.#session.releaseDatabaseLease(SEARCH_INDEX_DATABASE_ENTRY_PATH);
    if (
      this.#databaseDirty ||
      (this.#searchIndexDatabaseDirty &&
        this.#searchIndexWritebackPolicy === "archive")
    ) {
      await this.#session.deleteEntry(LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH);
    }
  }
  public ensureDirectory(): Promise<void> {
    return Promise.resolve();
  }
  public initializeDatabaseSchema(): boolean {
    return false;
  }
  public openDatabaseReadonly(): boolean {
    return this.#readonlyDatabase;
  }
  public documentIdentity(): string {
    return this.#session.archiveIdentity;
  }
  public searchIndexLockKey(): string {
    return this.#session.searchCacheIdentity;
  }

  public async resolveDatabasePath(): Promise<File> {
    this.#database ??= await this.#session.materializeDatabase(
      DATABASE_ENTRY_PATH,
      {
        createIfMissing: !this.#readonlyDatabase,
        mode: this.#readonlyDatabase ? "read" : "write",
      },
    );
    return this.#database;
  }

  public async resolveSearchIndexDatabasePath(): Promise<File> {
    this.#searchIndexDatabase ??=
      this.#searchIndexWritebackPolicy === "cache"
        ? await this.#session.materializeSearchIndexCache({
            createIfMissing: !this.#readonlyDatabase,
          })
        : await this.#session.materializeDatabase(
            SEARCH_INDEX_DATABASE_ENTRY_PATH,
            {
              createIfMissing: !this.#readonlyDatabase,
              mode: this.#readonlyDatabase ? "read" : "write",
            },
          );
    return this.#searchIndexDatabase;
  }

  public markDatabaseDirty(): void {
    if (!this.#readonlyDatabase && this.#database !== undefined) {
      this.#databaseDirty = true;
      this.#session.markDatabaseDirty(DATABASE_ENTRY_PATH);
    }
  }

  public markSearchIndexDatabaseDirty(): void {
    if (!this.#readonlyDatabase && this.#searchIndexDatabase !== undefined) {
      this.#searchIndexDatabaseDirty = true;
      if (this.#searchIndexWritebackPolicy === "archive") {
        this.#session.markDatabaseDirty(SEARCH_INDEX_DATABASE_ENTRY_PATH);
      } else {
        this.#session.markSearchIndexCacheDirty(this.#searchIndexDatabase);
      }
    }
  }

  public async readFile(path: string): Promise<Uint8Array | undefined> {
    return await this.#session.readEntry(toEntryPath(path));
  }

  public async getFileSize(path: string): Promise<number | undefined> {
    return await this.#session.getEntrySize(toEntryPath(path));
  }

  public async readFileRange(
    path: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array | undefined> {
    return await this.#session.readEntryRange(
      toEntryPath(path),
      offset,
      length,
    );
  }

  public async appendFile(path: string, content: Uint8Array): Promise<void> {
    await this.#session.appendEntry(toEntryPath(path), content);
  }

  public async writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean },
  ): Promise<void> {
    const entryPath = toEntryPath(path);
    await this.#session.writeEntry(entryPath, content, options);
  }

  public async deleteFile(path: string): Promise<void> {
    const entryPath = toEntryPath(path);
    if (
      entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH &&
      this.#searchIndexWritebackPolicy === "cache"
    ) {
      this.#searchIndexDatabase = undefined;
      this.#session.deleteSearchIndexCache();
      return;
    }
    await this.#session.deleteEntry(entryPath);
  }

  public async deleteTree(path: string): Promise<void> {
    const root = toEntryPath(path);
    const prefix = root === "" ? "" : `${root}/`;
    for (const entry of await this.#session.listEntries()) {
      if (entry === root || entry.startsWith(prefix)) {
        await this.#session.deleteEntry(entry);
      }
    }
  }

  public async listFiles(path: string): Promise<readonly string[]> {
    const root = toEntryPath(path);
    const prefix = root === "" ? "" : `${root}/`;
    return (await this.#session.listEntries())
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length))
      .filter((entry) => entry !== "" && !entry.includes("/"))
      .sort((left, right) => left.localeCompare(right));
  }

  public async listFileContents(
    path: string,
  ): Promise<ReadonlyMap<string, Uint8Array>> {
    const result = new Map<string, Uint8Array>();
    for (const name of await this.listFiles(path)) {
      const root = toEntryPath(path);
      const content = await this.#session.readEntry(
        root === "" ? name : `${root}/${name}`,
      );
      if (content !== undefined) result.set(name, content);
    }
    return result;
  }
}

function toEntryPath(path: string): string {
  if (path === "" || path === ".") return "";
  return normalizeArchivePath(path);
}

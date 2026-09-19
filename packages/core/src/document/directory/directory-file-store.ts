import type { Directory, File } from "../../runtime/platform/index.js";
import {
  getRelativeFile,
  isDirectory,
  readFileBytes,
  readHostFileSize,
} from "../../runtime/platform/index.js";
import type { DocumentFileStore } from "./types.js";

/** Document file store backed exclusively by a host Directory tree. */
export class DirectoryFileStore implements DocumentFileStore {
  readonly #root: Directory;

  public constructor(root: Directory) {
    this.#root = root;
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
  public documentIdentity(): string {
    return this.#root.identity;
  }
  public searchIndexLockKey(): string {
    return this.#root.identity;
  }
  public initializeDatabaseSchema(): boolean {
    return true;
  }
  public openDatabaseReadonly(): boolean {
    return false;
  }
  public markDatabaseDirty(): void {
    /* host transaction owns durability */
  }
  public markSearchIndexDatabaseDirty(): void {
    /* host transaction owns durability */
  }

  public async resolveDatabasePath(): Promise<File> {
    return await this.#getOrCreateFile("database.db");
  }
  public async resolveSearchIndexDatabasePath(): Promise<File> {
    return await this.#getOrCreateFile("index.db");
  }
  public async readFile(path: string): Promise<Uint8Array | undefined> {
    const file = await getRelativeFile(this.#root, this.#relative(path));
    if (!file) return undefined;
    return await readFileBytes(file);
  }
  public async getFileSize(path: string): Promise<number | undefined> {
    const file = await getRelativeFile(this.#root, this.#relative(path));
    if (!file) return undefined;
    return await readHostFileSize(file);
  }
  public async readFileRange(
    path: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array | undefined> {
    const file = await getRelativeFile(this.#root, this.#relative(path));
    if (!file) return undefined;
    const reader = await file.openReader();
    try {
      return await reader.read(offset, length);
    } finally {
      await reader.close();
    }
  }
  public async appendFile(path: string, content: Uint8Array): Promise<void> {
    const relative = this.#relative(path);
    const existing = await getRelativeFile(this.#root, relative);
    const file = existing ?? (await this.#getOrCreateFile(relative));
    const writer = await file.openWriter();
    try {
      if (existing !== undefined) {
        const reader = await file.openReader();
        try {
          for (let offset = 0; offset < reader.size; ) {
            const chunk = await reader.read(
              offset,
              Math.min(64 * 1024, reader.size - offset),
            );
            await writer.write(chunk);
            offset += chunk.byteLength;
          }
        } finally {
          await reader.close();
        }
      }
      await writer.write(content);
      await writer.commit();
    } catch (error) {
      await writer.abort();
      throw error;
    }
  }
  public async writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean } = {},
  ): Promise<void> {
    const relative = this.#relative(path);
    const existing = await getRelativeFile(this.#root, relative);
    if (existing && options.overwrite !== true) {
      throw new Error(`File already exists: ${path}`);
    }
    const file = existing ?? (await this.#getOrCreateFile(relative));
    const writer = await file.openWriter();
    try {
      await writer.write(content);
      await writer.commit();
    } catch (error) {
      await writer.abort();
      throw error;
    }
  }
  public async deleteFile(path: string): Promise<void> {
    await this.#removePath(this.#relative(path), false);
  }
  public async deleteTree(path: string): Promise<void> {
    await this.#removePath(this.#relative(path), true);
  }
  public async ensureDirectory(path: string): Promise<void> {
    await this.#getOrCreateDirectory(this.#relative(path));
  }
  public async listFiles(path: string): Promise<readonly string[]> {
    const directory = await this.#getOrCreateDirectory(this.#relative(path));
    return (await directory.list())
      .filter((entry): entry is File => !isDirectory(entry))
      .map((entry) => entry.name);
  }

  #relative(path: string): string {
    const relative = path.replaceAll("\\", "/").replace(/^\.\//u, "");
    if (relative.startsWith("/") || relative.split("/").includes("..")) {
      throw new TypeError(`Document path must remain relative: ${path}`);
    }
    return relative;
  }
  async #getOrCreateDirectory(path: string): Promise<Directory> {
    let current = this.#root;
    for (const part of path.split("/").filter(Boolean)) {
      current =
        (await current.getDirectory(part)) ??
        (await current.createDirectory(part));
    }
    return current;
  }
  async #getOrCreateFile(path: string): Promise<File> {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) throw new TypeError("File name must be relative");
    return (
      (await (
        await this.#getOrCreateDirectory(parts.join("/"))
      ).getFile(name)) ??
      (await (
        await this.#getOrCreateDirectory(parts.join("/"))
      ).createFile(name))
    );
  }
  async #removePath(path: string, recursive: boolean): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) return;
    const parent = await this.#getOrCreateDirectory(parts.join("/"));
    await parent.remove(name, { recursive });
  }
}

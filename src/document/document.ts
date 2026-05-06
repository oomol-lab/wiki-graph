import { AsyncLocalStorage } from "async_hooks";
import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { z } from "zod";

import { bookMetaSchema, type BookMeta } from "../source/meta.js";
import { tocFileSchema, type TocFile } from "../source/toc.js";
import type { SourceAsset } from "../source/types.js";
import { isNodeError } from "../utils/node-error.js";
import { Database } from "./database.js";
import {
  Fragments,
  type ReadonlySerialFragments,
  type SerialFragments,
} from "./fragments.js";
import { SCHEMA_SQL } from "./schema.js";
import {
  ChunkStore,
  FragmentGroupStore,
  KnowledgeEdgeStore,
  type ReadonlyChunkStore,
  type ReadonlyFragmentGroupStore,
  type ReadonlyKnowledgeEdgeStore,
  type ReadonlySerialStore,
  type ReadonlySnakeChunkStore,
  type ReadonlySnakeEdgeStore,
  type ReadonlySnakeStore,
  SerialStore,
  SnakeChunkStore,
  SnakeEdgeStore,
  SnakeStore,
} from "./stores.js";
import type { SentenceId } from "./types.js";

const coverFileSchema = z.object({
  mediaType: z.string().min(1),
  path: z.string(),
});

export interface ReadonlyDocument {
  readonly chunks: ReadonlyChunkStore;
  readonly fragmentGroups: ReadonlyFragmentGroupStore;
  readonly knowledgeEdges: ReadonlyKnowledgeEdgeStore;
  readonly serials: ReadonlySerialStore;
  readonly snakeChunks: ReadonlySnakeChunkStore;
  readonly snakeEdges: ReadonlySnakeEdgeStore;
  readonly snakes: ReadonlySnakeStore;

  getSentence(sentenceId: SentenceId): Promise<string>;
  getSerialFragments(serialId: number): ReadonlySerialFragments;
  openSession<T>(
    operation: (document: ReadonlyDocument) => Promise<T> | T,
  ): Promise<T>;
  readBookMeta(): Promise<BookMeta | undefined>;
  readCover(): Promise<SourceAsset | undefined>;
  readSummary(serialId: number): Promise<string | undefined>;
  readToc(): Promise<TocFile | undefined>;
  release(): Promise<void>;
}

export interface DocumentContext {
  complete(): void;
  dispose(): Promise<void>;
  ownSerial(serialId: number): void;
  run<T>(operation: () => Promise<T> | T): Promise<T>;
}

export interface Document extends ReadonlyDocument {
  readonly chunks: ChunkStore;
  readonly fragmentGroups: FragmentGroupStore;
  readonly knowledgeEdges: KnowledgeEdgeStore;
  readonly serials: SerialStore;
  readonly snakeChunks: SnakeChunkStore;
  readonly snakeEdges: SnakeEdgeStore;
  readonly snakes: SnakeStore;

  createContext(): DocumentContext;
  getSerialFragments(serialId: number): SerialFragments;
  createSerial(): Promise<number>;
  flush(): Promise<void>;
  openSession<T>(operation: (document: Document) => Promise<T> | T): Promise<T>;
  peekNextSerialId(): Promise<number>;
  writeBookMeta(meta: BookMeta): Promise<void>;
  writeCover(cover: SourceAsset): Promise<void>;
  writeSummary(serialId: number, summary: string): Promise<void>;
  writeToc(toc: TocFile): Promise<void>;
}

export class DirectoryDocument implements Document {
  public readonly chunks: ChunkStore;
  public readonly fragmentGroups: FragmentGroupStore;
  public readonly knowledgeEdges: KnowledgeEdgeStore;
  public readonly path: string;
  public readonly serials: SerialStore;
  public readonly snakeChunks: SnakeChunkStore;
  public readonly snakeEdges: SnakeEdgeStore;
  public readonly snakes: SnakeStore;

  readonly #database: Database;
  readonly #fragments: Fragments;
  readonly #contextScope = new AsyncLocalStorage<DirectoryDocumentContext>();

  public constructor(database: Database, fragments: Fragments, path: string) {
    this.#database = database;
    this.#fragments = fragments;
    this.chunks = new ChunkStore(database);
    this.fragmentGroups = new FragmentGroupStore(database);
    this.knowledgeEdges = new KnowledgeEdgeStore(database);
    this.path = path;
    this.serials = new SerialStore(database);
    this.snakeChunks = new SnakeChunkStore(database);
    this.snakeEdges = new SnakeEdgeStore(database);
    this.snakes = new SnakeStore(database);
  }

  public static async open(documentPath: string): Promise<DirectoryDocument> {
    const resolvedDocumentPath = resolve(documentPath);
    const databasePath = join(resolvedDocumentPath, "database.db");
    const writer = {
      write: async (path: string, content: string): Promise<void> => {
        await writeFile(path, content, "utf8");
      },
    };
    const fragments = new Fragments(resolvedDocumentPath, writer);

    await mkdir(resolvedDocumentPath, { recursive: true });
    await fragments.ensureCreated();

    const database = await Database.open(databasePath, SCHEMA_SQL);
    const document = new DirectoryDocument(
      database,
      fragments,
      resolvedDocumentPath,
    );

    writer.write = async (path: string, content: string): Promise<void> => {
      await document.#writeNewFile(path, content);
    };

    return document;
  }

  public static async openSession<T>(
    documentPath: string,
    operation: (document: DirectoryDocument) => Promise<T> | T,
  ): Promise<T> {
    const document = await DirectoryDocument.open(documentPath);

    try {
      return await document.openSession(async () => await operation(document));
    } finally {
      await document.release();
    }
  }

  public getSerialFragments(serialId: number): SerialFragments {
    return this.#fragments.getSerial(serialId);
  }

  public createContext(): DocumentContext {
    return new DirectoryDocumentContext(this);
  }

  public async createSerial(): Promise<number> {
    const serialId = await this.serials.create();

    this.#contextScope.getStore()?.ownSerial(serialId);
    return serialId;
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    return await this.#fragments.getSentence(sentenceId);
  }

  public async openSession<T>(
    operation: (document: Document) => Promise<T> | T,
  ): Promise<T> {
    const activeContext = this.#contextScope.getStore();

    if (activeContext !== undefined) {
      return await operation(this);
    }

    const context = new DirectoryDocumentContext(this);

    try {
      const result = await this.#database.transaction(
        async () => await context.run(async () => await operation(this)),
      );

      context.complete();
      return result;
    } finally {
      await context.dispose();
    }
  }

  public async peekNextSerialId(): Promise<number> {
    return (await this.serials.getMaxId()) + 1;
  }

  public async readBookMeta(): Promise<BookMeta | undefined> {
    return await this.#readJsonFile(this.#getBookMetaPath(), (value) =>
      bookMetaSchema.parse(value),
    );
  }

  public async readCover(): Promise<SourceAsset | undefined> {
    const coverFile = await this.#readJsonFile(
      this.#getCoverInfoPath(),
      (value) => coverFileSchema.parse(value),
    );

    if (coverFile === undefined) {
      return undefined;
    }

    const data = await this.#readOptionalFile(this.#getCoverDataPath());

    if (data === undefined) {
      throw new Error("Cover data is missing");
    }

    return {
      data,
      mediaType: coverFile.mediaType,
      path: coverFile.path,
    };
  }

  public async readSummary(serialId: number): Promise<string | undefined> {
    try {
      return await readFile(this.#getSummaryPath(serialId), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  public async readToc(): Promise<TocFile | undefined> {
    return await this.#readJsonFile(this.#getTocPath(), (value) =>
      tocFileSchema.parse(value),
    );
  }

  public async writeBookMeta(meta: BookMeta): Promise<void> {
    await this.#writeJsonFile(this.#getBookMetaPath(), meta);
  }

  public async writeCover(cover: SourceAsset): Promise<void> {
    await mkdir(this.#getCoverDirectoryPath(), { recursive: true });
    await this.#writeJsonFile(this.#getCoverInfoPath(), {
      mediaType: cover.mediaType,
      path: cover.path,
    });
    await this.#writeNewFile(this.#getCoverDataPath(), cover.data);
  }

  public async writeSummary(serialId: number, summary: string): Promise<void> {
    await mkdir(this.#getSummariesPath(), { recursive: true });
    await this.#writeNewFile(this.#getSummaryPath(serialId), summary);
  }

  public async writeToc(toc: TocFile): Promise<void> {
    await this.#writeJsonFile(this.#getTocPath(), toc);
  }

  public async flush(): Promise<void> {
    await this.#database.flush();
  }

  public async release(): Promise<void> {
    await this.flush();
    await this.#database.close();
  }

  public async close(): Promise<void> {
    await this.release();
  }

  async #rollbackContext(context: DirectoryDocumentContext): Promise<void> {
    await this.#rollbackOwnedSerials(context.listOwnedSerialIds());
    await this.#rollbackCreatedFiles(context.listCreatedFilePaths());
  }

  async #rollbackCreatedFiles(
    createdFilePaths: readonly string[],
  ): Promise<void> {
    for (const path of [...createdFilePaths].reverse()) {
      try {
        await unlink(path);
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          continue;
        }

        throw error;
      }
    }
  }

  async #rollbackOwnedSerials(serialIds: readonly number[]): Promise<void> {
    for (const serialId of [...serialIds].sort(compareNumberDescending)) {
      await this.#database.transaction(async () => {
        await this.#database.run(
          `
            DELETE FROM snake_edges
            WHERE from_snake_id IN (
              SELECT id
              FROM snakes
              WHERE serial_id = ?
            ) OR to_snake_id IN (
              SELECT id
              FROM snakes
              WHERE serial_id = ?
            )
          `,
          [serialId, serialId],
        );
        await this.#database.run(
          `
            DELETE FROM snake_chunks
            WHERE snake_id IN (
              SELECT id
              FROM snakes
              WHERE serial_id = ?
            )
          `,
          [serialId],
        );
        await this.#database.run(
          `
            DELETE FROM snakes
            WHERE serial_id = ?
          `,
          [serialId],
        );
        await this.#database.run(
          `
            DELETE FROM fragment_groups
            WHERE serial_id = ?
          `,
          [serialId],
        );
        await this.#database.run(
          `
            DELETE FROM knowledge_edges
            WHERE from_id IN (
              SELECT id
              FROM chunks
              WHERE serial_id = ?
            ) OR to_id IN (
              SELECT id
              FROM chunks
              WHERE serial_id = ?
            )
          `,
          [serialId, serialId],
        );
        await this.#database.run(
          `
            DELETE FROM chunk_sentences
            WHERE serial_id = ?
          `,
          [serialId],
        );
        await this.#database.run(
          `
            DELETE FROM chunks
            WHERE serial_id = ?
          `,
          [serialId],
        );
        await this.#database.run(
          `
            DELETE FROM serial_states
            WHERE serial_id = ?
          `,
          [serialId],
        );
        await this.#database.run(
          `
            DELETE FROM serials
            WHERE id = ?
          `,
          [serialId],
        );
      });

      await rm(this.#fragments.getSerial(serialId).path, {
        force: true,
        recursive: true,
      });

      try {
        await unlink(this.#getSummaryPath(serialId));
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          continue;
        }

        throw error;
      }
    }
  }

  async #readJsonFile<T>(
    path: string,
    parse: (value: unknown) => T,
  ): Promise<T | undefined> {
    const content = await this.#readOptionalTextFile(path);

    if (content === undefined) {
      return undefined;
    }

    return parse(JSON.parse(content));
  }

  async #readOptionalFile(path: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(path);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  async #readOptionalTextFile(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  async #writeJsonFile(path: string, value: unknown): Promise<void> {
    await this.#writeNewFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async #writeNewFile(
    path: string,
    content: string | Uint8Array,
  ): Promise<void> {
    try {
      if (typeof content === "string") {
        await writeFile(path, content, {
          encoding: "utf8",
          flag: "wx",
        });
      } else {
        await writeFile(path, content, {
          flag: "wx",
        });
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new Error(`File already exists: ${path}`);
      }

      throw error;
    }

    this.#contextScope.getStore()?.registerCreatedFile(path);
  }

  #getSummariesPath(): string {
    return join(this.path, "summaries");
  }

  #getBookMetaPath(): string {
    return join(this.path, "book-meta.json");
  }

  #getCoverDataPath(): string {
    return join(this.#getCoverDirectoryPath(), "data.bin");
  }

  #getCoverDirectoryPath(): string {
    return join(this.path, "cover");
  }

  #getCoverInfoPath(): string {
    return join(this.#getCoverDirectoryPath(), "info.json");
  }

  #getSummaryPath(serialId: number): string {
    return join(this.#getSummariesPath(), `serial-${serialId}.txt`);
  }

  #getTocPath(): string {
    return join(this.path, "toc.json");
  }

  public async runWithContext<T>(
    context: DirectoryDocumentContext,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    return await this.#contextScope.run(context, operation);
  }

  public async rollbackContext(
    context: DirectoryDocumentContext,
  ): Promise<void> {
    await this.#rollbackContext(context);
  }
}

class DirectoryDocumentContext implements DocumentContext {
  readonly #createdFilePaths: string[] = [];
  readonly #document: DirectoryDocument;
  readonly #ownedSerialIds = new Set<number>();
  #completed = false;
  #disposed = false;

  public constructor(document: DirectoryDocument) {
    this.#document = document;
  }

  public complete(): void {
    this.#assertActive();
    this.#completed = true;
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;

    if (this.#completed) {
      return;
    }

    await this.#document.rollbackContext(this);
  }

  public ownSerial(serialId: number): void {
    this.#assertActive();
    this.#ownedSerialIds.add(serialId);
  }

  public async run<T>(operation: () => Promise<T> | T): Promise<T> {
    this.#assertActive();
    return await this.#document.runWithContext(this, operation);
  }

  public listCreatedFilePaths(): readonly string[] {
    return [...this.#createdFilePaths];
  }

  public listOwnedSerialIds(): readonly number[] {
    return [...this.#ownedSerialIds];
  }

  public registerCreatedFile(path: string): void {
    this.#createdFilePaths.push(path);
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("DocumentContext is already disposed");
    }
  }
}

function compareNumberDescending(left: number, right: number): number {
  return right - left;
}

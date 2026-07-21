import { AsyncLocalStorage } from "async_hooks";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { z } from "zod";

import { bookMetaSchema, type BookMeta } from "../source/meta.js";
import { tocFileSchema, type TocFile, type TocItem } from "../source/toc.js";
import type { SourceAsset } from "../source/types.js";
import { isNodeError } from "../utils/node-error.js";
import { Database } from "./database.js";
import type { Database as DocumentDatabase } from "./database.js";
import {
  TextStreams,
  type ReadonlySerialTextStream,
  type SerialTextStream,
} from "./text-streams.js";
import {
  initializeDocumentSchema,
  SCHEMA_SQL,
  SEARCH_INDEX_SCHEMA_SQL,
} from "./schema.js";
import {
  ChunkStore,
  FragmentGroupStore,
  GraphBuildParameterStore,
  ReadingEdgeStore,
  MentionLinkStore,
  MentionStore,
  ObjectMetadataStore,
  type ReadonlyChunkStore,
  type ReadonlyFragmentGroupStore,
  type ReadonlyGraphBuildParameterStore,
  type ReadonlyReadingEdgeStore,
  type ReadonlyMentionLinkStore,
  type ReadonlyMentionStore,
  type ReadonlyObjectMetadataStore,
  type ReadonlySerialStore,
  type ReadonlySnakeChunkStore,
  type ReadonlySnakeEdgeStore,
  type ReadonlySnakeStore,
  SerialStore,
  SnakeChunkStore,
  SnakeEdgeStore,
  SnakeStore,
} from "./stores/index.js";
import { ObjectMetadataKind, type SentenceId } from "./types.js";

export interface DocumentFileStore {
  close(): Promise<void>;
  deleteFile(path: string): Promise<void>;
  deleteTree(path: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
  initializeDatabaseSchema(): boolean;
  markDatabaseDirty?(): void;
  markSearchIndexDatabaseDirty?(): void;
  openDatabaseReadonly(): boolean;
  listFileContents?(path: string): Promise<ReadonlyMap<string, Uint8Array>>;
  listFiles(path: string): Promise<readonly string[]>;
  readFile(path: string): Promise<Uint8Array | undefined>;
  resolveDatabasePath(documentPath: string): Promise<string>;
  resolveSearchIndexDatabasePath?(documentPath: string): Promise<string>;
  writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean },
  ): Promise<void>;
}

const LOCAL_DOCUMENT_FILE_STORE: DocumentFileStore = {
  close: () => Promise.resolve(),
  deleteFile: async (path) => {
    await unlink(path);
  },
  deleteTree: async (path) => {
    await rm(path, { force: true, recursive: true });
  },
  ensureDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  initializeDatabaseSchema: () => true,
  markDatabaseDirty: () => undefined,
  markSearchIndexDatabaseDirty: () => undefined,
  openDatabaseReadonly: () => false,
  listFiles: async (path) =>
    (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  readFile: async (path) => {
    try {
      return await readFile(path);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  },
  resolveDatabasePath: (documentPath) =>
    Promise.resolve(join(documentPath, "database.db")),
  resolveSearchIndexDatabasePath: (documentPath) =>
    Promise.resolve(join(documentPath, "fts.db")),
  writeFile: async (path, content, options) => {
    if (typeof content === "string") {
      await writeFile(path, content, {
        encoding: "utf8",
        flag: options.overwrite === true ? "w" : "wx",
      });
    } else {
      await writeFile(path, content, {
        flag: options.overwrite === true ? "w" : "wx",
      });
    }
  },
};

const coverFileSchema = z.object({
  mediaType: z.string().min(1),
  path: z.string(),
});

export interface ReadonlyDocument {
  readonly chunks: ReadonlyChunkStore;
  readonly fragmentGroups: ReadonlyFragmentGroupStore;
  readonly graphBuildParameters: ReadonlyGraphBuildParameterStore;
  readonly readingEdges: ReadonlyReadingEdgeStore;
  readonly mentionLinks: ReadonlyMentionLinkStore;
  readonly mentions: ReadonlyMentionStore;
  readonly metadata: ReadonlyObjectMetadataStore;
  readonly serials: ReadonlySerialStore;
  readonly snakeChunks: ReadonlySnakeChunkStore;
  readonly snakeEdges: ReadonlySnakeEdgeStore;
  readonly snakes: ReadonlySnakeStore;

  getSentence(sentenceId: SentenceId): Promise<string>;
  getSerialFragments(serialId: number): ReadonlySerialTextStream;
  getSummaryFragments(serialId: number): ReadonlySerialTextStream;
  openSession<T>(
    operation: (document: ReadonlyDocument) => Promise<T> | T,
  ): Promise<T>;
  readDatabase<T>(
    operation: (database: DocumentDatabase) => Promise<T> | T,
  ): Promise<T>;
  readSearchIndexDatabase<T>(
    operation: (database: DocumentDatabase) => Promise<T> | T,
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
  readonly graphBuildParameters: GraphBuildParameterStore;
  readonly readingEdges: ReadingEdgeStore;
  readonly mentionLinks: MentionLinkStore;
  readonly mentions: MentionStore;
  readonly metadata: ObjectMetadataStore;
  readonly serials: SerialStore;
  readonly snakeChunks: SnakeChunkStore;
  readonly snakeEdges: SnakeEdgeStore;
  readonly snakes: SnakeStore;

  createContext(): DocumentContext;
  getSerialFragments(serialId: number): SerialTextStream;
  getSummaryFragments(serialId: number): SerialTextStream;
  createSerial(): Promise<number>;
  clearSerialGraph(serialId: number): Promise<void>;
  clearSerialSource(serialId: number): Promise<void>;
  deleteSerial(serialId: number): Promise<void>;
  deleteSearchIndexDatabase(): Promise<void>;
  deleteSummary(serialId: number): Promise<void>;
  flush(): Promise<void>;
  openSession<T>(operation: (document: Document) => Promise<T> | T): Promise<T>;
  peekNextSerialId(): Promise<number>;
  replaceBookMeta(meta: BookMeta): Promise<void>;
  replaceToc(toc: TocFile): Promise<void>;
  writeBookMeta(meta: BookMeta): Promise<void>;
  writeCover(cover: SourceAsset): Promise<void>;
  writeSummary(serialId: number, summary: string): Promise<void>;
  writeToc(toc: TocFile): Promise<void>;
  writeSearchIndexDatabase<T>(
    operation: (database: DocumentDatabase) => Promise<T> | T,
  ): Promise<T>;
}

export class DirectoryDocument implements Document {
  public readonly chunks: ChunkStore;
  public readonly fragmentGroups: FragmentGroupStore;
  public readonly graphBuildParameters: GraphBuildParameterStore;
  public readonly readingEdges: ReadingEdgeStore;
  public readonly mentionLinks: MentionLinkStore;
  public readonly mentions: MentionStore;
  public readonly metadata: ObjectMetadataStore;
  public readonly path: string;
  public readonly serials: SerialStore;
  public readonly snakeChunks: SnakeChunkStore;
  public readonly snakeEdges: SnakeEdgeStore;
  public readonly snakes: SnakeStore;

  readonly #database: Database;
  readonly #fileStore: DocumentFileStore;
  readonly #textStreams: TextStreams;
  readonly #contextScope = new AsyncLocalStorage<DirectoryDocumentContext>();

  public constructor(
    database: Database,
    textStreams: TextStreams,
    path: string,
    fileStore: DocumentFileStore = LOCAL_DOCUMENT_FILE_STORE,
  ) {
    this.#database = database;
    this.#fileStore = fileStore;
    this.#textStreams = textStreams;
    this.chunks = new ChunkStore(database);
    this.fragmentGroups = new FragmentGroupStore(database);
    this.graphBuildParameters = new GraphBuildParameterStore(database);
    this.readingEdges = new ReadingEdgeStore(database);
    this.mentionLinks = new MentionLinkStore(database);
    this.mentions = new MentionStore(database);
    this.metadata = new ObjectMetadataStore(database);
    this.path = path;
    this.serials = new SerialStore(database);
    this.snakeChunks = new SnakeChunkStore(database);
    this.snakeEdges = new SnakeEdgeStore(database);
    this.snakes = new SnakeStore(database);
  }

  public static async open(
    documentPath: string,
    options: { readonly fileStore?: DocumentFileStore } = {},
  ): Promise<DirectoryDocument> {
    const resolvedDocumentPath = resolve(documentPath);
    const fileStore = options.fileStore ?? LOCAL_DOCUMENT_FILE_STORE;
    try {
      const databasePath =
        await fileStore.resolveDatabasePath(resolvedDocumentPath);
      await fileStore.ensureDirectory(resolvedDocumentPath);

      const shouldInitializeDatabaseSchema =
        fileStore.initializeDatabaseSchema();
      const database = await Database.open(
        databasePath,
        shouldInitializeDatabaseSchema ? SCHEMA_SQL : "",
        {
          onWrite: () => {
            fileStore.markDatabaseDirty?.();
          },
          readonly: fileStore.openDatabaseReadonly(),
        },
      );
      if (shouldInitializeDatabaseSchema) {
        await initializeDocumentSchema(database);
      }
      const textStreams = new TextStreams(resolvedDocumentPath, database, {
        deleteTree: async (path) => {
          await fileStore.deleteTree(path);
        },
        ensureDirectory: async (path) => {
          await fileStore.ensureDirectory(path);
        },
        listFiles: async (path) => await fileStore.listFiles(path),
        readFile: async (path) => await fileStore.readFile(path),
        writeFile: async (path, content, options) => {
          await fileStore.writeFile(path, content, options);
        },
      });
      await textStreams.ensureCreated();

      const document = new DirectoryDocument(
        database,
        textStreams,
        resolvedDocumentPath,
        fileStore,
      );

      return document;
    } catch (error) {
      await fileStore.close();
      throw error;
    }
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

  public getSerialFragments(serialId: number): SerialTextStream {
    return this.#textStreams.getSerial(serialId);
  }

  public getSummaryFragments(serialId: number): SerialTextStream {
    return this.#textStreams.getSummarySerial(serialId);
  }

  public createContext(): DocumentContext {
    return new DirectoryDocumentContext(this);
  }

  public async createSerial(): Promise<number> {
    const serialId = await this.serials.create();

    this.#contextScope.getStore()?.ownSerial(serialId);
    return serialId;
  }

  public async clearSerialGraph(serialId: number): Promise<void> {
    await this.deleteSummary(serialId);
    await this.#deleteSerialGraphRecords(serialId);
    await this.serials.setTopologyReady(serialId, false);
    await this.serials.setKnowledgeGraphReady(serialId, false);
    await this.serials.bumpRevision(serialId);
    await this.graphBuildParameters.deleteUnreferenced();
  }

  public async clearSerialSource(serialId: number): Promise<void> {
    await this.clearSerialGraph(serialId);
    await this.#textStreams.getSerial(serialId).delete();
    await this.serials.bumpRevision(serialId);
  }

  public async deleteSerial(serialId: number): Promise<void> {
    await this.#deleteSerialResources(serialId);
  }

  public async deleteSummary(serialId: number): Promise<void> {
    await this.#textStreams.getSummarySerial(serialId).delete();
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    return await this.#textStreams.getSentence(sentenceId);
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

  public async readDatabase<T>(
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T> {
    return await operation(this.#database);
  }

  public async readSearchIndexDatabase<T>(
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T> {
    return await this.#openSearchIndexDatabase(true, operation);
  }

  public async writeSearchIndexDatabase<T>(
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T> {
    return await this.#openSearchIndexDatabase(false, operation);
  }

  public async deleteSearchIndexDatabase(): Promise<void> {
    await this.#fileStore.deleteFile(join(this.path, "fts.db"));
  }

  public async peekNextSerialId(): Promise<number> {
    return (await this.serials.getMaxId()) + 1;
  }

  public async readBookMeta(): Promise<BookMeta | undefined> {
    const map = await this.metadata.getMap("");

    return Object.keys(map).length === 0
      ? undefined
      : bookMetaSchema.parse(map);
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
    return await this.#textStreams.getSummarySerial(serialId).readText();
  }

  public async readToc(): Promise<TocFile | undefined> {
    return await this.#readJsonFile(this.#getTocPath(), (value) =>
      tocFileSchema.parse(value),
    );
  }

  public async writeBookMeta(meta: BookMeta): Promise<void> {
    if (Object.keys(await this.metadata.getMap("")).length > 0) {
      throw new Error("Archive metadata already exists.");
    }

    await this.replaceBookMeta(meta);
  }

  public async replaceBookMeta(meta: BookMeta): Promise<void> {
    await this.metadata.replaceMap(
      {
        kind: ObjectMetadataKind.Archive,
        objectPath: "",
      },
      {
        ...meta,
      },
    );
  }

  public async writeCover(cover: SourceAsset): Promise<void> {
    await this.#fileStore.ensureDirectory(this.#getCoverDirectoryPath());
    await this.#writeJsonFile(this.#getCoverInfoPath(), {
      mediaType: cover.mediaType,
      path: cover.path,
    });
    await this.#writeNewFile(this.#getCoverDataPath(), cover.data);
  }

  public async writeSummary(serialId: number, summary: string): Promise<void> {
    await this.deleteSummary(serialId);
    await this.#textStreams.getSummarySerial(serialId).writeTextStream(summary);
    await this.serials.bumpRevision(serialId);
  }

  public async writeToc(toc: TocFile): Promise<void> {
    await this.#writeJsonFile(this.#getTocPath(), toc);
    await this.#replaceDocumentOrder(toc);
    await this.serials.bumpChaptersRevision();
  }

  public async replaceToc(toc: TocFile): Promise<void> {
    await this.#writeJsonFile(this.#getTocPath(), toc, { overwrite: true });
    await this.#replaceDocumentOrder(toc);
    await this.serials.bumpChaptersRevision();
  }

  public async flush(): Promise<void> {
    await this.#database.flush();
  }

  public async release(): Promise<void> {
    try {
      await this.flush();
      await this.#database.close();
    } finally {
      await this.#fileStore.close();
    }
  }

  public async close(): Promise<void> {
    await this.release();
  }

  async #openSearchIndexDatabase<T>(
    readonly: boolean,
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T> {
    const databasePath =
      this.#fileStore.resolveSearchIndexDatabasePath === undefined
        ? join(this.path, "fts.db")
        : await this.#fileStore.resolveSearchIndexDatabasePath(this.path);
    const database = await Database.open(
      databasePath,
      readonly ? "" : SEARCH_INDEX_SCHEMA_SQL,
      {
        onWrite: () => {
          this.#fileStore.markSearchIndexDatabaseDirty?.();
        },
        readonly,
      },
    );

    try {
      return await operation(database);
    } finally {
      await database.close();
    }
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
        await this.#fileStore.deleteFile(path);
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
      await this.#deleteSerialResources(serialId);
    }
  }

  async #deleteSerialResources(serialId: number): Promise<void> {
    await this.metadata.deleteChapterSubtree(serialId);
    await this.#deleteSerialGraphRecords(serialId);
    await this.#database.transaction(async () => {
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

    await this.#textStreams.getSerial(serialId).delete();
    await this.deleteSummary(serialId);
    await this.serials.bumpChaptersRevision();
    await this.graphBuildParameters.deleteUnreferenced();
  }

  async #deleteSerialGraphRecords(serialId: number): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#database.run(
        `
          DELETE FROM mention_link_evidence_sentences
          WHERE link_id IN (
            SELECT mention_links.id
            FROM mention_links
            INNER JOIN mentions AS source_mentions
              ON source_mentions.id = mention_links.source_mention_id
            INNER JOIN mentions AS target_mentions
              ON target_mentions.id = mention_links.target_mention_id
            WHERE source_mentions.chapter_id = ?
              OR target_mentions.chapter_id = ?
          )
        `,
        [serialId, serialId],
      );
      await this.#database.run(
        `
          DELETE FROM mention_links
          WHERE source_mention_id IN (
            SELECT id
            FROM mentions
            WHERE chapter_id = ?
          ) OR target_mention_id IN (
            SELECT id
            FROM mentions
            WHERE chapter_id = ?
          )
        `,
        [serialId, serialId],
      );
      await this.#database.run(
        `
          DELETE FROM mentions
          WHERE chapter_id = ?
        `,
        [serialId],
      );
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
          DELETE FROM sentence_groups
          WHERE serial_id = ?
        `,
        [serialId],
      );
      await this.#database.run(
        `
          DELETE FROM reading_edges
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
      await this.metadata.deleteDeletedChunks();
      await this.metadata.deleteDeletedEntitiesAndTriples();
    });
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
    return await this.#fileStore.readFile(path);
  }

  async #replaceDocumentOrder(toc: TocFile): Promise<void> {
    await this.serials.setDocumentOrders(
      listTocSerialIds(toc.items).map((serialId, index) => ({
        documentOrder: index,
        serialId,
      })),
    );
  }

  async #readOptionalTextFile(path: string): Promise<string | undefined> {
    const content = await this.#fileStore.readFile(path);

    return content === undefined
      ? undefined
      : Buffer.from(content).toString("utf8");
  }

  async #writeJsonFile(
    path: string,
    value: unknown,
    options: { readonly overwrite?: boolean } = {},
  ): Promise<void> {
    await this.#writeFile(path, `${JSON.stringify(value, null, 2)}\n`, options);
  }

  async #writeNewFile(
    path: string,
    content: string | Uint8Array,
  ): Promise<void> {
    await this.#writeFile(path, content, { overwrite: false });
  }

  async #writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean },
  ): Promise<void> {
    try {
      await this.#fileStore.writeFile(path, content, options);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new Error(`File already exists: ${path}`);
      }

      throw error;
    }

    if (options.overwrite !== true) {
      this.#contextScope.getStore()?.registerCreatedFile(path);
    }
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

function listTocSerialIds(items: readonly TocItem[]): number[] {
  const serialIds: number[] = [];

  for (const item of items) {
    if (item.serialId !== undefined) {
      serialIds.push(item.serialId);
    }

    serialIds.push(...listTocSerialIds(item.children));
  }

  return serialIds;
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

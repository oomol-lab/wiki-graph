import { AsyncLocalStorage } from "async_hooks";
import { join, resolve } from "path";
import { z } from "zod";

import { bookMetaSchema, type BookMeta } from "../../text/source/meta.js";
import { tocFileSchema, type TocFile } from "../../text/source/toc.js";
import type { SourceAsset } from "../../text/source/types.js";
import { Database } from "../database.js";
import { TextStreams, type SerialTextStream } from "../text-streams/index.js";
import { initializeDocumentSchema, SCHEMA_SQL } from "../schema.js";
import {
  ChunkStore,
  FragmentGroupStore,
  GraphBuildParameterStore,
  ReadingEdgeStore,
  MentionLinkStore,
  MentionStore,
  ObjectMetadataStore,
  SerialStore,
  SnakeChunkStore,
  SnakeEdgeStore,
  SnakeStore,
} from "../stores/index.js";
import { ObjectMetadataKind, type SentenceId } from "../types.js";
import { DirectoryDocumentContext } from "./context.js";
import { LOCAL_DOCUMENT_FILE_STORE } from "./file-store.js";
import {
  getCoverDataPath,
  getCoverDirectoryPath,
  getCoverInfoPath,
  getTocPath,
  readJsonFile,
  readOptionalFile,
  writeJsonFile,
  writeNewFile,
} from "./files.js";
import { openSearchIndexDatabase } from "./search-index.js";
import {
  deleteSerialGraphRecords,
  deleteSerialResources,
  rollbackDocumentContext,
} from "./serial-cleanup.js";
import { listTocSerialIds } from "./toc.js";
import type { Document, DocumentContext, DocumentFileStore } from "./types.js";

const coverFileSchema = z.object({
  mediaType: z.string().min(1),
  path: z.string(),
});

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
    await deleteSerialGraphRecords({
      database: this.#database,
      metadata: this.metadata,
      serialId,
    });
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
    return await openSearchIndexDatabase({
      documentPath: this.path,
      fileStore: this.#fileStore,
      operation,
      readonly: true,
    });
  }

  public async writeSearchIndexDatabase<T>(
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T> {
    return await openSearchIndexDatabase({
      documentPath: this.path,
      fileStore: this.#fileStore,
      operation,
      readonly: false,
    });
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
    const coverFile = await readJsonFile({
      fileStore: this.#fileStore,
      parse: (value) => coverFileSchema.parse(value),
      path: getCoverInfoPath(this.path),
    });

    if (coverFile === undefined) {
      return undefined;
    }

    const data = await readOptionalFile(
      this.#fileStore,
      getCoverDataPath(this.path),
    );

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
    return await readJsonFile({
      fileStore: this.#fileStore,
      parse: (value) => tocFileSchema.parse(value),
      path: getTocPath(this.path),
    });
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
    await this.#fileStore.ensureDirectory(getCoverDirectoryPath(this.path));
    await writeJsonFile({
      context: this.#contextScope.getStore(),
      fileStore: this.#fileStore,
      path: getCoverInfoPath(this.path),
      value: {
        mediaType: cover.mediaType,
        path: cover.path,
      },
    });
    await writeNewFile({
      content: cover.data,
      context: this.#contextScope.getStore(),
      fileStore: this.#fileStore,
      path: getCoverDataPath(this.path),
    });
  }

  public async writeSummary(serialId: number, summary: string): Promise<void> {
    await this.deleteSummary(serialId);
    await this.#textStreams.getSummarySerial(serialId).writeTextStream(summary);
    await this.serials.bumpRevision(serialId);
  }

  public async writeToc(toc: TocFile): Promise<void> {
    await writeJsonFile({
      context: this.#contextScope.getStore(),
      fileStore: this.#fileStore,
      path: getTocPath(this.path),
      value: toc,
    });
    await this.#replaceDocumentOrder(toc);
    await this.serials.bumpChaptersRevision();
  }

  public async replaceToc(toc: TocFile): Promise<void> {
    await writeJsonFile({
      context: this.#contextScope.getStore(),
      fileStore: this.#fileStore,
      options: { overwrite: true },
      path: getTocPath(this.path),
      value: toc,
    });
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

  public async runWithContext<T>(
    context: DirectoryDocumentContext,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    return await this.#contextScope.run(context, operation);
  }

  public async rollbackContext(
    context: DirectoryDocumentContext,
  ): Promise<void> {
    await rollbackDocumentContext({
      context,
      deleteSerialResources: async (serialId) => {
        await this.#deleteSerialResources(serialId);
      },
      fileStore: this.#fileStore,
    });
  }

  async #replaceDocumentOrder(toc: TocFile): Promise<void> {
    await this.serials.setDocumentOrders(
      listTocSerialIds(toc.items).map((serialId, index) => ({
        documentOrder: index,
        serialId,
      })),
    );
  }

  async #deleteSerialResources(serialId: number): Promise<void> {
    await deleteSerialResources({
      database: this.#database,
      deleteSummary: async (targetSerialId) => {
        await this.deleteSummary(targetSerialId);
      },
      graphBuildParameters: this.graphBuildParameters,
      metadata: this.metadata,
      serialId,
      serials: this.serials,
      textStreams: this.#textStreams,
    });
  }
}

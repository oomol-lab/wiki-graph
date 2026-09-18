import type { BookMeta } from "../../text/source/meta.js";
import type { TocFile } from "../../text/source/toc.js";
import type { SourceAsset } from "../../text/source/types.js";
import type { Database as DocumentDatabase } from "../database.js";
import type {
  ReadonlySerialTextStream,
  SerialTextStream,
} from "../text-streams/index.js";
import type {
  ChunkStore,
  FragmentGroupStore,
  GraphBuildParameterStore,
  IndexArtifactStore,
  MentionLinkStore,
  MentionStore,
  ObjectMetadataStore,
  ReadingEdgeStore,
  ReadonlyChunkStore,
  ReadonlyFragmentGroupStore,
  ReadonlyGraphBuildParameterStore,
  ReadonlyIndexArtifactStore,
  ReadonlyMentionLinkStore,
  ReadonlyMentionStore,
  ReadonlyObjectMetadataStore,
  ReadonlyReadingEdgeStore,
  ReadonlySerialStore,
  ReadonlySourceProvenanceStore,
  ReadonlySnakeChunkStore,
  ReadonlySnakeEdgeStore,
  ReadonlySnakeStore,
  SerialStore,
  SourceProvenanceStore,
  SnakeChunkStore,
  SnakeEdgeStore,
  SnakeStore,
} from "../stores/index.js";
import type { SentenceId } from "../types.js";

export interface DocumentFileStore {
  close(): Promise<void>;
  deleteFile(path: string): Promise<void>;
  deleteTree(path: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
  documentIdentity?(): string;
  initializeDatabaseSchema(): boolean;
  markDatabaseDirty?(): void;
  markSearchIndexDatabaseDirty?(): void;
  openDatabaseReadonly(): boolean;
  searchIndexLockKey?(): object | string;
  listFileContents?(path: string): Promise<ReadonlyMap<string, Uint8Array>>;
  listFiles(path: string): Promise<readonly string[]>;
  readFile(path: string): Promise<Uint8Array | undefined>;
  getFileSize?(path: string): Promise<number | undefined>;
  readFileRange?(
    path: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array | undefined>;
  appendFile?(path: string, content: Uint8Array): Promise<void>;
  resolveDatabasePath(
    documentPath: string,
  ): Promise<import("../../runtime/platform/index.js").File>;
  resolveSearchIndexDatabasePath?(
    documentPath: string,
  ): Promise<import("../../runtime/platform/index.js").File>;
  writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean },
  ): Promise<void>;
}
export interface ReadonlyDocument {
  readonly chunks: ReadonlyChunkStore;
  readonly fragmentGroups: ReadonlyFragmentGroupStore;
  readonly graphBuildParameters: ReadonlyGraphBuildParameterStore;
  readonly indexArtifacts: ReadonlyIndexArtifactStore;
  readonly readingEdges: ReadonlyReadingEdgeStore;
  readonly mentionLinks: ReadonlyMentionLinkStore;
  readonly mentions: ReadonlyMentionStore;
  readonly metadata: ReadonlyObjectMetadataStore;
  readonly serials: ReadonlySerialStore;
  readonly sourceProvenance: ReadonlySourceProvenanceStore;
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
  readonly indexArtifacts: IndexArtifactStore;
  readonly readingEdges: ReadingEdgeStore;
  readonly mentionLinks: MentionLinkStore;
  readonly mentions: MentionStore;
  readonly metadata: ObjectMetadataStore;
  readonly serials: SerialStore;
  readonly sourceProvenance: SourceProvenanceStore;
  readonly snakeChunks: SnakeChunkStore;
  readonly snakeEdges: SnakeEdgeStore;
  readonly snakes: SnakeStore;

  createContext(): DocumentContext;
  getSerialFragments(serialId: number): SerialTextStream;
  getSummaryFragments(serialId: number): SerialTextStream;
  createSerial(): Promise<number>;
  clearSerialDerivedArtifacts(serialId: number): Promise<void>;
  markSerialDerivedArtifactsStale(serialId: number): Promise<void>;
  clearSerialGraph(serialId: number): Promise<void>;
  clearSerialKnowledgeGraph(serialId: number): Promise<void>;
  clearSerialReadingGraph(serialId: number): Promise<void>;
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

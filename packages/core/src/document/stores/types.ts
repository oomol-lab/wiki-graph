import type {
  ChunkRecord,
  GraphBuildParameterRecord,
  IndexArtifactCoverageRecord,
  IndexArtifactEmbeddingSegment,
  IndexArtifactKind,
  IndexArtifactLexicalRow,
  IndexArtifactRecord,
  MentionLinkRecord,
  MentionRecord,
  ReadingEdgeRecord,
  SentenceGroupRecord,
  SerialRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
  SourceArtifactRecord,
  SourceLocatorRecord,
  SourceTextMapRecord,
} from "../types.js";

export interface ReadonlySourceProvenanceStore {
  getArtifact(reference: string): Promise<SourceArtifactRecord | undefined>;
  getLocator(
    reference: string,
    fragment: string,
  ): Promise<SourceLocatorRecord | undefined>;
  listArtifacts(): Promise<SourceArtifactRecord[]>;
  listMap(serialId: number): Promise<SourceTextMapRecord[]>;
}

export interface ReadonlySerialStore {
  getById(serialId: number): Promise<SerialRecord | undefined>;
  getRevision(serialId: number): Promise<number>;
  getRevisions(
    serialIds: readonly number[],
  ): Promise<ReadonlyMap<number, number>>;
  getMaxId(): Promise<number>;
  getChaptersRevision(): Promise<number>;
  listIds(): Promise<number[]>;
  listDocumentOrders(): Promise<ReadonlyMap<number, number>>;
}

export interface ReadonlyGraphBuildParameterStore {
  getByHash(hash: string): Promise<GraphBuildParameterRecord | undefined>;
}

export interface ReadonlyIndexArtifactStore {
  get(
    serialId: number,
    kind: IndexArtifactKind,
  ): Promise<IndexArtifactRecord | undefined>;
  list(
    kind?: IndexArtifactKind,
    serialIds?: readonly number[],
  ): Promise<IndexArtifactRecord[]>;
  listCoverage(
    kind: IndexArtifactKind,
    serialIds?: readonly number[],
  ): Promise<IndexArtifactCoverageRecord[]>;
  listLexicalRows(
    serialId: number,
    kind?: "fts",
  ): Promise<IndexArtifactLexicalRow[]>;
  listEmbeddingSegments(
    serialId: number,
    kind: "embedding-source" | "embedding-summary",
  ): Promise<IndexArtifactEmbeddingSegment[]>;
}

export interface ReadonlyChunkStore {
  countAll(): Promise<number>;
  getById(chunkId: number): Promise<ChunkRecord | undefined>;
  listAll(): Promise<ChunkRecord[]>;
  listBySentenceStartIndexes(
    serialId: number,
    sentenceStartIndexes: readonly number[],
  ): Promise<ChunkRecord[]>;
  listBySentenceRange(
    serialId: number,
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<ChunkRecord[]>;
  listBySerial(serialId: number): Promise<ChunkRecord[]>;
  getMaxId(): Promise<number>;
  listFragmentPairs(): Promise<ReadonlyArray<readonly [number, number]>>;
}

export interface ReadonlyReadingEdgeStore {
  countAll(): Promise<number>;
  listAll(): Promise<ReadingEdgeRecord[]>;
  listBySerial(serialId: number): Promise<ReadingEdgeRecord[]>;
  listIncoming(chunkId: number): Promise<ReadingEdgeRecord[]>;
  listOutgoing(chunkId: number): Promise<ReadingEdgeRecord[]>;
}

export interface ReadonlyMentionStore {
  countByQid(
    qid: string,
    options?: { readonly chapterId?: number },
  ): Promise<number>;
  getById(mentionId: string): Promise<MentionRecord | undefined>;
  listAll(): Promise<MentionRecord[]>;
  listBySurfaceTerms(terms: readonly string[]): Promise<MentionRecord[]>;
  listBySurfaces(surfaces: readonly string[]): Promise<MentionRecord[]>;
  listByQid(
    qid: string,
    options?: {
      readonly chapterId?: number;
      readonly limit?: number;
      readonly offset?: number;
      readonly order?: "asc" | "desc";
    },
  ): Promise<MentionRecord[]>;
  listLabelsByQid(
    qid: string,
    options?: { readonly chapterId?: number },
  ): Promise<string[]>;
  listByChapter(chapterId: number): Promise<MentionRecord[]>;
}

export interface ReadonlyMentionLinkStore {
  countByTriple(input: {
    readonly chapterId?: number;
    readonly objectQid: string;
    readonly predicate: string;
    readonly subjectQid: string;
  }): Promise<number>;
  getById(linkId: string): Promise<MentionLinkRecord | undefined>;
  listAll(): Promise<MentionLinkRecord[]>;
  listByTriple(input: {
    readonly chapterId?: number;
    readonly limit?: number;
    readonly offset?: number;
    readonly order?: "asc" | "desc";
    readonly objectQid: string;
    readonly predicate: string;
    readonly subjectQid: string;
  }): Promise<MentionLinkRecord[]>;
  listByChapter(chapterId: number): Promise<MentionLinkRecord[]>;
}

export interface ReadonlySnakeStore {
  getById(snakeId: number): Promise<SnakeRecord | undefined>;
  listIdsByGroup(serialId: number, groupId: number): Promise<number[]>;
  listBySerial(serialId: number): Promise<SnakeRecord[]>;
}

export interface ReadonlySnakeChunkStore {
  listChunkIds(snakeId: number): Promise<number[]>;
  listBySnake(snakeId: number): Promise<SnakeChunkRecord[]>;
}

export interface ReadonlySnakeEdgeStore {
  listIncoming(snakeId: number): Promise<SnakeEdgeRecord[]>;
  listOutgoing(snakeId: number): Promise<SnakeEdgeRecord[]>;
  listWithin(snakeIds: readonly number[]): Promise<SnakeEdgeRecord[]>;
  listBySerial(serialId: number): Promise<SnakeEdgeRecord[]>;
}

export interface ReadonlyFragmentGroupStore {
  listBySerial(serialId: number): Promise<SentenceGroupRecord[]>;
  listSerialIds(): Promise<number[]>;
  listGroupIdsForSerial(serialId: number): Promise<number[]>;
}

export interface ReadonlyObjectMetadataStore {
  getMap(objectPath: string): Promise<Readonly<Record<string, unknown>>>;
}

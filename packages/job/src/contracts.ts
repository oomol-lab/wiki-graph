export const CHAPTER_JOB_PROTOCOL = "wiki-graph-job/v1" as const;

export const CHAPTER_JOB_KINDS = [
  "index-embedding-source",
  "index-embedding-summary",
  "index-fts",
  "knowledge-graph",
  "reading-graph",
  "reading-summary",
] as const;

export type ChapterJobKind = (typeof CHAPTER_JOB_KINDS)[number];

export interface JobSentence {
  readonly text: string;
  readonly wordsCount: number;
}

export interface JobSourceFragment {
  readonly fragmentId: number;
  readonly sentences: readonly JobSentence[];
  readonly summary: string;
}

export interface JobReadingChunk {
  readonly content: string;
  readonly generation: number;
  readonly id: string;
  readonly importance?: "context" | "core" | "detail";
  readonly label: string;
  readonly retention?: "archive" | "keep" | "temporary";
  readonly sentenceIndex: number;
  readonly sentenceIndexes: readonly number[];
  readonly weight: number;
  readonly wordsCount: number;
}

export interface JobReadingEdge {
  readonly fromChunkId: string;
  readonly strength?: string;
  readonly toChunkId: string;
  readonly weight: number;
}

export interface JobFragmentGroup {
  readonly endSentenceIndex: number;
  readonly groupId: number;
  readonly startSentenceIndex: number;
}

export interface JobSnake {
  readonly firstLabel: string;
  readonly groupId: number;
  readonly id: string;
  readonly lastLabel: string;
  readonly localSnakeId: number;
  readonly size: number;
  readonly weight: number;
  readonly wordsCount: number;
}

export interface JobSnakeChunk {
  readonly chunkId: string;
  readonly position: number;
  readonly snakeId: string;
}

export interface JobSnakeEdge {
  readonly fromSnakeId: string;
  readonly toSnakeId: string;
  readonly weight: number;
}

export interface JobMention {
  readonly confidence?: number;
  readonly fragmentId?: number;
  readonly id: string;
  readonly note?: string;
  readonly qid: string;
  readonly rangeEnd: number;
  readonly rangeStart: number;
  readonly sentenceIndex?: number;
  readonly surface: string;
}

export interface JobMentionLink {
  readonly confidence?: number;
  readonly evidenceSentenceIndexes: readonly number[];
  readonly id: string;
  readonly note?: string;
  readonly predicate: string;
  readonly sourceMentionId: string;
  readonly targetMentionId: string;
}

export interface JobChapterTitle {
  readonly id: number;
  readonly title: string;
}

export interface JobFtsChunk {
  readonly content: string;
  readonly id: number;
  readonly label: string;
  readonly wordsCount: number;
}

export interface JobFtsMention {
  readonly id: string;
  readonly qid: string;
  readonly surface: string;
}

export interface ReadingGraphSnapshotPayload {
  readonly extractionPrompt?: string;
  readonly language?: string;
  readonly sourceText: readonly string[];
}

export interface ReadingSummarySnapshotPayload {
  readonly language?: string;
  readonly prompt?: string;
  readonly readingGraph: readonly JobObject[];
}

export interface KnowledgeGraphSnapshotPayload {
  readonly fragments: readonly JobSourceFragment[];
  readonly language?: string;
  readonly policyPrompt?: string;
}

export interface FtsSnapshotPayload {
  readonly chapterTitles: readonly JobChapterTitle[];
  readonly chunks: readonly JobFtsChunk[];
  readonly mentions: readonly JobFtsMention[];
  readonly sentences: readonly JobSentence[];
  readonly summarySentences: readonly JobSentence[];
}

export interface EmbeddingSnapshotPayload {
  readonly sentences: readonly JobSentence[];
}

export interface ChapterJobSnapshotPayloads {
  readonly "index-embedding-source": EmbeddingSnapshotPayload;
  readonly "index-embedding-summary": EmbeddingSnapshotPayload;
  readonly "index-fts": FtsSnapshotPayload;
  readonly "knowledge-graph": KnowledgeGraphSnapshotPayload;
  readonly "reading-graph": ReadingGraphSnapshotPayload;
  readonly "reading-summary": ReadingSummarySnapshotPayload;
}

export interface ChapterJobSnapshot<
  K extends ChapterJobKind = ChapterJobKind,
> {
  readonly chapterId: number;
  readonly kind: K;
  readonly payload: ChapterJobSnapshotPayloads[K];
  readonly protocol: typeof CHAPTER_JOB_PROTOCOL;
  readonly revision: number;
}

export interface JobIndexMetadata {
  readonly [key: string]: unknown;
  readonly dimensions?: number;
  readonly identity?: string;
  readonly model?: string;
  readonly source?: string;
  readonly version: number;
}

export interface JobLexicalRow {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly objectId: string;
  readonly objectKind: string;
  readonly rowId: string;
  readonly sentenceIndex?: number;
  readonly text: string;
  readonly tokens: readonly string[];
}

export interface JobEmbeddingSegment {
  readonly endSentenceIndex: number;
  readonly segmentIndex: number;
  readonly startSentenceIndex: number;
  readonly text: string;
  readonly vector: readonly number[];
  readonly wordsCount: number;
}

export interface ReadingGraphArtifactPayload {
  readonly objects: readonly JobObject[];
}

export interface ReadingSummaryArtifactPayload {
  readonly summary: string;
}

export interface KnowledgeGraphArtifactPayload {
  readonly objects: readonly JobObject[];
}

export interface FtsArtifactPayload {
  readonly lexicalRows: readonly JobLexicalRow[];
  readonly metadata: JobIndexMetadata;
}

export interface EmbeddingArtifactPayload {
  readonly kind: "embedding-source" | "embedding-summary";
  readonly metadata: JobIndexMetadata;
  readonly segments: readonly JobEmbeddingSegment[];
}

export interface ChapterJobArtifactPayloads {
  readonly "index-embedding-source": EmbeddingArtifactPayload;
  readonly "index-embedding-summary": EmbeddingArtifactPayload;
  readonly "index-fts": FtsArtifactPayload;
  readonly "knowledge-graph": KnowledgeGraphArtifactPayload;
  readonly "reading-graph": ReadingGraphArtifactPayload;
  readonly "reading-summary": ReadingSummaryArtifactPayload;
}

export interface ChapterJobArtifact<
  K extends ChapterJobKind = ChapterJobKind,
> {
  readonly chapterId: number;
  readonly kind: K;
  readonly payload: ChapterJobArtifactPayloads[K];
  readonly protocol: typeof CHAPTER_JOB_PROTOCOL;
  readonly revision: number;
}

export type JobObject =
  | {
      readonly chapterId: number;
      readonly schemaVersion: 1;
      readonly stream: "knowledge-graph" | "reading-graph" | "summary";
      readonly type: "meta";
    }
  | {
      readonly language?: string;
      readonly prompt: string;
      readonly scope: "knowledge-graph" | "reading-graph" | "summary";
      readonly type: "parameter";
    }
  | (JobSourceFragment & { readonly type: "source-fragment" })
  | (JobReadingChunk & { readonly type: "reading-chunk" })
  | (JobReadingEdge & { readonly type: "reading-edge" })
  | (JobFragmentGroup & { readonly type: "fragment-group" })
  | (JobSnake & { readonly type: "snake" })
  | (JobSnakeChunk & { readonly type: "snake-chunk" })
  | (JobSnakeEdge & { readonly type: "snake-edge" })
  | { readonly text: string; readonly type: "summary" }
  | (JobMention & { readonly type: "mention" })
  | (JobMentionLink & { readonly type: "mention-link" })
  | { readonly type: "end" };

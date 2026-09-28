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
  readonly importance?: "critical" | "helpful" | "important";
  readonly label: string;
  readonly retention?: "detailed" | "focused" | "relevant" | "verbatim";
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

export interface FtsSnapshotPayload {
  readonly chapterId: number;
  readonly chapterTitles: readonly JobChapterTitle[];
  readonly chunks: readonly JobFtsChunk[];
  readonly mentions: readonly JobFtsMention[];
  readonly sentences: readonly JobSentence[];
  readonly summarySentences: readonly JobSentence[];
}

export interface EmbeddingSnapshotPayload {
  readonly sentences: readonly JobSentence[];
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

export interface FtsArtifactPayload {
  readonly lexicalRows: readonly JobLexicalRow[];
  readonly metadata: JobIndexMetadata;
}

export interface EmbeddingArtifactPayload {
  readonly kind: "embedding-source" | "embedding-summary";
  readonly metadata: JobIndexMetadata;
  readonly segments: readonly JobEmbeddingSegment[];
}

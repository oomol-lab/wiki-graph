import type {
  JobEmbeddingSegment,
  JobFragmentGroup,
  JobLexicalRow,
  JobMention,
  JobMentionLink,
  JobReadingChunk,
  JobReadingEdge,
  JobSnake,
  JobSnakeChunk,
  JobSnakeEdge,
} from "./contracts.js";
import type { JobFile } from "./platform.js";

export interface JobOptionsRecord {
  readonly extractionPrompt?: string;
  readonly language?: string;
  readonly policyPrompt?: string;
  readonly prompt?: string;
  readonly type: "job-options";
}

export interface JobSourceTextRecord {
  readonly text: string;
  readonly type: "source-text";
}

export interface JobSourceFragmentRecord {
  readonly fragmentId: number;
  readonly summary: string;
  readonly type: "source-fragment";
}

export interface JobSourceSentenceRecord {
  readonly fragmentId?: number;
  readonly sentenceIndex: number;
  readonly text: string;
  readonly type: "source-sentence";
  readonly wordsCount: number;
}

export interface JobSummarySentenceRecord {
  readonly sentenceIndex: number;
  readonly text: string;
  readonly type: "summary-sentence";
  readonly wordsCount: number;
}

export interface JobChapterTitleRecord {
  readonly chapterId: number;
  readonly title: string;
  readonly type: "chapter-title";
}

export type JobReadingChunkRecord = JobReadingChunk & {
  readonly type: "reading-chunk";
};
export type JobReadingEdgeRecord = JobReadingEdge & {
  readonly type: "reading-edge";
};
export type JobFragmentGroupRecord = JobFragmentGroup & {
  readonly type: "fragment-group";
};
export type JobSnakeRecord = JobSnake & { readonly type: "snake" };
export type JobSnakeChunkRecord = JobSnakeChunk & {
  readonly type: "snake-chunk";
};
export type JobSnakeEdgeRecord = JobSnakeEdge & {
  readonly type: "snake-edge";
};
export type JobMentionRecord = JobMention & { readonly type: "mention" };
export type JobMentionLinkRecord = JobMentionLink & {
  readonly type: "mention-link";
};

export interface JobSummaryPartRecord {
  readonly position: number;
  readonly text: string;
  readonly type: "summary-part";
}

export interface JobParameterRecord {
  readonly language?: string;
  readonly prompt: string;
  readonly scope: "knowledge-graph" | "reading-graph";
  readonly type: "job-parameter";
}

export type JobLexicalRowRecord = JobLexicalRow & {
  readonly type: "lexical-row";
};

export interface JobEmbeddingMetadataRecord {
  readonly dimensions: number;
  readonly identity?: string;
  readonly model: string;
  readonly source: "source" | "summary";
  readonly type: "embedding-metadata";
  readonly version: 1;
}

export type JobEmbeddingSegmentRecord = JobEmbeddingSegment & {
  readonly type: "embedding-segment";
};

export type ChapterJobInputRecord =
  | JobChapterTitleRecord
  | JobFragmentGroupRecord
  | JobMentionRecord
  | JobOptionsRecord
  | JobReadingChunkRecord
  | JobReadingEdgeRecord
  | JobSnakeChunkRecord
  | JobSnakeEdgeRecord
  | JobSnakeRecord
  | JobSourceFragmentRecord
  | JobSourceSentenceRecord
  | JobSourceTextRecord
  | JobSummarySentenceRecord;

export type ChapterJobArtifactRecord =
  | JobEmbeddingMetadataRecord
  | JobEmbeddingSegmentRecord
  | JobFragmentGroupRecord
  | JobLexicalRowRecord
  | JobMentionLinkRecord
  | JobMentionRecord
  | JobParameterRecord
  | JobReadingChunkRecord
  | JobReadingEdgeRecord
  | JobSnakeChunkRecord
  | JobSnakeEdgeRecord
  | JobSnakeRecord
  | JobSummaryPartRecord;

export interface ChapterJobFileResult {
  readonly artifactFile: JobFile;
  readonly revision: number;
}

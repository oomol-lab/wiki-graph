export const TEXT_SENTENCE_KIND = {
  source: 1,
  summary: 2,
} as const;

export const SINGLE_ARCHIVE_INDEX_ID = 0;

export type TextSentenceKind =
  (typeof TEXT_SENTENCE_KIND)[keyof typeof TEXT_SENTENCE_KIND];

export const SEARCH_OBJECT_PROPERTY_OWNER_KIND = {
  chapter: 1,
  chunk: 2,
  entity: 3,
  archive: 4,
} as const;

export type SearchObjectPropertyOwnerKind =
  (typeof SEARCH_OBJECT_PROPERTY_OWNER_KIND)[keyof typeof SEARCH_OBJECT_PROPERTY_OWNER_KIND];

export const SEARCH_OBJECT_PROPERTY_KIND = {
  title: 1,
  label: 1,
  content: 2,
  surface: 1,
} as const;

export type SearchObjectPropertyKind =
  (typeof SEARCH_OBJECT_PROPERTY_KIND)[keyof typeof SEARCH_OBJECT_PROPERTY_KIND];

export interface TextSentenceRecordInput {
  readonly archiveId: number;
  readonly chapterId: number;
  readonly kind: TextSentenceKind;
  readonly sentenceIndex: number;
  readonly text: string;
  readonly wordsCount: number;
}

export interface SearchObjectPropertyRecordInput {
  readonly archiveId: number;
  readonly chapterId?: number;
  readonly ownerId: string;
  readonly ownerKind: SearchObjectPropertyOwnerKind;
  readonly propertyKind: SearchObjectPropertyKind;
  readonly text: string;
}

export interface SearchIndexInput {
  readonly objectProperties: readonly SearchObjectPropertyRecordInput[];
  readonly textSentences: readonly TextSentenceRecordInput[];
}

export type SearchIndexSelection = "auto" | "dense" | "fts" | "fts,dense";

export type SearchIndexQueryMode = "embedding" | "fts" | "hybrid";

export interface SearchIndexEmbeddingProvider {
  readonly dimensions?: number;
  readonly identity?: string;
  readonly model: string;
  embedTexts(
    texts: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<{
    readonly embeddings: readonly (readonly number[])[];
    readonly tokens?: number;
  }>;
}

export interface SearchIndexBuildOptions {
  readonly embeddingProvider?: SearchIndexEmbeddingProvider;
  readonly indexes?: SearchIndexSelection;
}

export interface SearchIndexStoredEmbeddingState {
  readonly dimensions: number;
  readonly identity?: string;
  readonly model: string;
}

export type SearchIndexProgressPhase =
  | "checking"
  | "clearing"
  | "collecting"
  | "finalizing"
  | "indexing-dense"
  | "indexing-objects"
  | "indexing-text";

export interface SearchIndexProgressEvent {
  readonly done?: number;
  readonly phase: SearchIndexProgressPhase;
  readonly total?: number;
  readonly unit?: "chapter" | "object" | "sentence" | "vector";
}

export type SearchIndexProgressReporter = (
  event: SearchIndexProgressEvent,
) => void | Promise<void>;

export type SearchIndexStatus = "current" | "dirty" | "missing";

export interface SearchIndexCapabilityStatus {
  readonly dense: {
    readonly current: boolean;
    readonly dimensions?: number;
    readonly identity?: string;
    readonly model?: string;
  };
  readonly indexes: "dense" | "fts" | "fts,dense" | "missing";
}

export interface SearchIndexTextHit {
  readonly archiveId: number;
  readonly chapterId: number;
  readonly kind: TextSentenceKind;
  readonly rank: number;
  readonly score: number;
  readonly sentenceIndex: number;
  readonly wordsCount: number;
}

export interface SearchIndexObjectHit {
  readonly archiveId: number;
  readonly chapterId?: number;
  readonly ownerId: string;
  readonly ownerKind: SearchObjectPropertyOwnerKind;
  readonly propertyKind: SearchObjectPropertyKind;
  readonly score: number;
}

export interface SearchIndexQueryResult {
  readonly objectHits: readonly SearchIndexObjectHit[];
  readonly terms: readonly string[];
  readonly textHits: readonly SearchIndexTextHit[];
}

export const SEARCH_INDEX_VERSION = "7";
export const SEARCH_INDEX_FTS_HIT_LIMIT = 32_000;
export const SEARCH_INDEX_DENSE_SEGMENT_HIT_LIMIT = 256;
export const SEARCH_INDEX_DENSE_EXPANDED_SENTENCE_LIMIT = 1_024;
export const FTS5_RANK_SCORE_SCALE = 1_000_000;
export const TIER_WEIGHTS = [1, 0.45, 0.08] as const;

export const DENSE_SEGMENT_TARGET_WORDS = 300;
export const DENSE_SEGMENT_MAX_WORDS = 420;
export const DENSE_SEGMENT_OVERLAP_WORDS = 80;
export const DENSE_SEGMENT_MIN_WORDS = 80;

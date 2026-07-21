export const TEXT_SENTENCE_KIND = {
  source: 1,
  summary: 2,
} as const;

export type TextSentenceKind =
  (typeof TEXT_SENTENCE_KIND)[keyof typeof TEXT_SENTENCE_KIND];

export const SEARCH_OBJECT_PROPERTY_OWNER_KIND = {
  chapter: 1,
  chunk: 2,
  entity: 3,
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
  readonly chapterId: number;
  readonly kind: TextSentenceKind;
  readonly sentenceIndex: number;
  readonly text: string;
  readonly wordsCount: number;
}

export interface SearchObjectPropertyRecordInput {
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

export type SearchIndexProgressPhase =
  | "checking"
  | "clearing"
  | "collecting"
  | "finalizing"
  | "indexing-objects"
  | "indexing-text";

export interface SearchIndexProgressEvent {
  readonly done?: number;
  readonly phase: SearchIndexProgressPhase;
  readonly total?: number;
  readonly unit?: "chapter" | "object" | "sentence";
}

export type SearchIndexProgressReporter = (
  event: SearchIndexProgressEvent,
) => void | Promise<void>;

export type SearchIndexStatus = "current" | "dirty" | "missing";

export interface SearchIndexTextHit {
  readonly chapterId: number;
  readonly kind: TextSentenceKind;
  readonly rank: number;
  readonly score: number;
  readonly sentenceIndex: number;
  readonly wordsCount: number;
}

export interface SearchIndexObjectHit {
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

export const SEARCH_INDEX_VERSION = "3";
export const SEARCH_INDEX_FTS_HIT_LIMIT = 32_000;
export const FTS5_RANK_SCORE_SCALE = 1_000_000;
export const TIER_WEIGHTS = [1, 0.45, 0.08] as const;

export interface ArchiveIndexSettings {
  readonly ftsEmbedded: boolean;
}

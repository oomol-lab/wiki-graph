import type { ArchiveFindHit } from "../archive-view.js";

export interface SearchSessionInput {
  readonly archiveKey: string;
  readonly chapters: readonly number[] | null;
  readonly chunkHits?: readonly SearchChunkHitInput[];
  readonly entityHits?: readonly SearchEntityHitInput[];
  readonly evidenceEvents?: readonly SearchEvidenceHitEventInput[];
  readonly items?: readonly ArchiveFindHit[];
  readonly lens: string;
  readonly match: string;
  readonly order: string;
  readonly query: string;
  readonly revisionScope: string;
  readonly terms: readonly string[];
  readonly tripleHits?: readonly SearchTripleHitInput[];
  readonly types: readonly string[] | null;
}

export const SEARCH_EVIDENCE_KIND = {
  mention: 1,
  mentionLink: 2,
  chunk: 3,
} as const;

export type SearchEvidenceKind =
  (typeof SEARCH_EVIDENCE_KIND)[keyof typeof SEARCH_EVIDENCE_KIND];

export interface SearchEvidenceHitEventInput {
  readonly chapterId: number;
  readonly evidenceId: string;
  readonly evidenceKind: SearchEvidenceKind;
  readonly score: number;
  readonly sentenceIndex: number;
}

export interface SearchEntityHitInput {
  readonly evidenceTopScores?: readonly number[];
  readonly propertyTopScores?: readonly number[];
  readonly qid: string;
}

export interface SearchTripleHitInput {
  readonly evidenceTopScores: readonly number[];
  readonly objectQid: string;
  readonly predicate: string;
  readonly subjectQid: string;
}

export interface SearchChunkHitInput {
  readonly chunkId: number;
  readonly evidenceTopScores?: readonly number[];
  readonly propertyTopScores?: readonly number[];
}

export interface EntitySearchSessionInput {
  readonly archiveKey: string;
  readonly chapters: readonly number[] | null;
  readonly chunkHits?: readonly SearchChunkHitInput[];
  readonly entityHits?: readonly SearchEntityHitInput[];
  readonly evidenceEvents?: readonly SearchEvidenceHitEventInput[];
  readonly lens: string;
  readonly match: string;
  readonly order: string;
  readonly query: string;
  readonly revisionScope: string;
  readonly terms: readonly string[];
  readonly tripleHits?: readonly SearchTripleHitInput[];
  readonly types: readonly string[] | null;
}

export interface SearchSessionPage {
  readonly chapters: readonly number[] | null;
  readonly items: readonly ArchiveFindHit[];
  readonly lens: string;
  readonly match: string;
  readonly nextCursor: string | null;
  readonly query: string;
  readonly sessionId: string;
  readonly terms: readonly string[];
  readonly types: readonly string[] | null;
}

export interface EntitySearchSessionPage {
  readonly chapters: readonly number[] | null;
  readonly items: readonly ArchiveFindHit[];
  readonly lens: string;
  readonly match: string;
  readonly nextCursor: string | null;
  readonly query: string;
  readonly sessionId: string;
  readonly terms: readonly string[];
  readonly types: readonly string[] | null;
}

export interface SearchSessionDescriptor {
  readonly chapters: readonly number[] | null;
  readonly createdAt: number;
  readonly lens: string;
  readonly match: string;
  readonly objectCachesPopulated: boolean;
  readonly query: string;
  readonly sessionId: string;
  readonly terms: readonly string[];
  readonly types: readonly string[] | null;
}

export type BucketSearchCursor =
  | {
      readonly bucket: 0;
      readonly key?: SearchChapterTitleCursorKey;
    }
  | {
      readonly bucket: 1;
      readonly key?: SearchObjectCursorKey;
    }
  | {
      readonly bucket: 2;
      readonly key?: SearchChunkCursorKey;
    }
  | {
      readonly bucket: 3;
      readonly key?: SearchTextCursorKey;
    };

export interface SearchChapterTitleCursorKey {
  readonly chapterId: number;
  readonly score: number;
}

export interface SearchObjectCursorKey {
  readonly id: string;
  readonly kind: "entity" | "triple";
  readonly score: number;
}

export interface SearchChunkCursorKey {
  readonly chunkId: number;
  readonly score: number;
}

export interface SearchTextCursorKey {
  readonly chapterId: number;
  readonly kind: number;
  readonly rank: number;
  readonly sentenceIndex: number;
}

export type SearchSessionCacheInput = Omit<SearchSessionInput, "items">;
export type EntitySearchSessionCacheInput = EntitySearchSessionInput;


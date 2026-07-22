import type { SqlBindValue } from "../../../document/database.js";
import type { ArchiveFindObjectType } from "../../query/view.js";
import {
  FTS5_RANK_SCORE_SCALE,
  TEXT_SENTENCE_KIND,
  type SearchIndexObjectHit,
  type SearchIndexTextHit,
  type TextSentenceKind,
} from "./types.js";

export function serializeTokens(
  tokens: readonly {
    readonly encoded: string;
  }[],
): string {
  return tokens.map((token) => token.encoded).join(" ");
}

export function createChapterSql(
  chapters: readonly number[] | undefined,
): string {
  return chapters === undefined || chapters.length === 0
    ? ""
    : `AND r.chapter_id IN (${chapters.map(() => "?").join(", ")})`;
}

export function createChapterParams(
  chapters: readonly number[] | undefined,
): readonly SqlBindValue[] {
  return chapters === undefined ? [] : [...chapters];
}

export function createLimitSql(limit: number | undefined): string {
  return limit === undefined ? "" : "LIMIT ?";
}

export function createLimitParams(
  limit: number | undefined,
): readonly SqlBindValue[] {
  return limit === undefined ? [] : [limit];
}

export function shouldQueryObjects(
  types: readonly ArchiveFindObjectType[] | null | undefined,
): boolean {
  return (
    types === undefined ||
    types === null ||
    types.includes("chapter") ||
    types.includes("chapter-title") ||
    types.includes("node") ||
    types.includes("entity")
  );
}

export function createTextKindFilter(
  types: readonly ArchiveFindObjectType[] | null | undefined,
): readonly TextSentenceKind[] {
  if (types === undefined || types === null) {
    return [TEXT_SENTENCE_KIND.summary, TEXT_SENTENCE_KIND.source];
  }

  const kinds: TextSentenceKind[] = [];

  if (types.includes("summary")) {
    kinds.push(TEXT_SENTENCE_KIND.summary);
  }
  if (types.includes("source")) {
    kinds.push(TEXT_SENTENCE_KIND.source);
  }

  return kinds;
}

export function rankToScore(rank: number): number {
  const relevance = Math.max(0, -rank) * FTS5_RANK_SCORE_SCALE;

  return relevance / (1 + relevance);
}

export function createObjectHitKey(hit: SearchIndexObjectHit): string {
  return [
    hit.archiveId,
    hit.ownerKind,
    hit.ownerId,
    hit.propertyKind,
    hit.chapterId ?? "",
  ].join(":");
}

export function createTextHitKey(hit: SearchIndexTextHit): string {
  return [hit.archiveId, hit.kind, hit.chapterId, hit.sentenceIndex].join(":");
}

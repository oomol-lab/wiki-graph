import type { SqlBindValue } from "../../../document/database.js";
import type { ArchiveFindObjectType } from "../../query/view.js";
import {
  FTS5_RANK_SCORE_SCALE,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  TEXT_SENTENCE_KIND,
  type SearchIndexObjectHit,
  type SearchIndexTextHit,
  type SearchObjectPropertyKind,
  type SearchObjectPropertyOwnerKind,
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
  alias = "r.",
): string {
  return chapters === undefined || chapters.length === 0
    ? ""
    : `AND ${alias}chapter_id IN (${chapters.map(() => "?").join(", ")})`;
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
    types.includes("archive") ||
    types.includes("archive-title") ||
    types.includes("chapter") ||
    types.includes("chapter-title") ||
    types.includes("node") ||
    types.includes("entity")
  );
}

export function createObjectTypeSql(
  types: readonly ArchiveFindObjectType[] | null | undefined,
): string {
  const filters = createObjectTypeFilters(types);

  return filters.length === 0
    ? ""
    : `AND (${filters
        .map(() => "(r.owner_kind = ? AND r.property_kind = ?)")
        .join(" OR ")})`;
}

export function createObjectTypeParams(
  types: readonly ArchiveFindObjectType[] | null | undefined,
): readonly SqlBindValue[] {
  return createObjectTypeFilters(types).flatMap((filter) => [
    filter.ownerKind,
    filter.propertyKind,
  ]);
}

function createObjectTypeFilters(
  types: readonly ArchiveFindObjectType[] | null | undefined,
): readonly {
  readonly ownerKind: SearchObjectPropertyOwnerKind;
  readonly propertyKind: SearchObjectPropertyKind;
}[] {
  if (types === undefined || types === null) {
    return [];
  }

  const filters: {
    readonly ownerKind: SearchObjectPropertyOwnerKind;
    readonly propertyKind: SearchObjectPropertyKind;
  }[] = [];

  if (types.includes("archive") || types.includes("archive-title")) {
    filters.push({
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.archive,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.title,
    });
  }

  if (types.includes("chapter") || types.includes("chapter-title")) {
    filters.push({
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.title,
    });
  }
  if (types.includes("node")) {
    filters.push(
      {
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.label,
      },
      {
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.content,
      },
    );
  }
  if (types.includes("entity")) {
    filters.push({
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.surface,
    });
  }

  return filters;
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

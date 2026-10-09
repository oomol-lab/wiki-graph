import {
  decodeBase64UrlText,
  encodeBase64UrlText,
} from "../../../../utils/bytes.js";
import type {
  ArchiveCollectionType,
  ArchiveFindFilterType,
  ArchiveFindLens,
  ArchiveFindMatch,
  ArchiveFindObjectType,
} from "../types.js";
import type { SearchIndexQueryMode } from "../../../search-index/index.js";

export interface TextSearchCursorContext {
  readonly archiveKey?: string;
  readonly chapters: readonly number[] | null;
  readonly match: ArchiveFindMatch;
  readonly offset: number;
  readonly order: "doc-asc" | "doc-desc";
  readonly query: string;
  readonly queryMode: SearchIndexQueryMode;
  readonly types: readonly ArchiveFindFilterType[] | null;
}

export function createSearchTerms(query: string): readonly string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
}

export function isFindFilterType(type: string): type is ArchiveFindFilterType {
  return (
    type === "archive" ||
    type === "archive-title" ||
    type === "chapter" ||
    type === "chapter-title" ||
    type === "entity" ||
    type === "fragment" ||
    type === "meta" ||
    type === "node" ||
    type === "source" ||
    type === "summary" ||
    type === "triple"
  );
}

export function isCollectionType(
  type: ArchiveFindObjectType,
): type is ArchiveCollectionType {
  return (
    type === "archive" ||
    type === "archive-title" ||
    type === "chapter" ||
    type === "chapter-title" ||
    type === "entity" ||
    type === "fragment" ||
    type === "meta" ||
    type === "node" ||
    type === "source" ||
    type === "summary" ||
    type === "triple"
  );
}

export function parseFindLens(value: string): ArchiveFindLens {
  if (value === "broad" || value === "exact" || value === "typed") {
    return value;
  }

  throw new Error("Invalid cached search session.");
}

export function parseFindMatch(value: string): ArchiveFindMatch {
  if (value === "all" || value === "any") {
    return value;
  }

  throw new Error("Invalid cached search session.");
}

export function parseFindTypes(
  values: readonly string[] | null,
): readonly ArchiveFindFilterType[] | null {
  if (values === null) {
    return null;
  }

  return values.map((value) => {
    if (
      value === "archive" ||
      value === "archive-title" ||
      value === "entity" ||
      value === "fragment" ||
      value === "meta" ||
      value === "node" ||
      value === "source" ||
      value === "summary" ||
      value === "chapter" ||
      value === "chapter-title" ||
      value === "triple"
    ) {
      return value;
    }

    throw new Error("Invalid cached search session.");
  });
}

export function encodeFindCursor(offset: number): string {
  return encodeBase64UrlText(JSON.stringify({ offset, v: 1 }));
}

export function decodeFindCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }

  try {
    const parsed: unknown = JSON.parse(decodeBase64UrlText(cursor));

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "v" in parsed &&
      "offset" in parsed &&
      parsed.v === 1 &&
      Number.isInteger(parsed.offset) &&
      typeof parsed.offset === "number" &&
      parsed.offset >= 0
    ) {
      return parsed.offset;
    }
  } catch {
    throw new Error("Invalid search cursor.");
  }

  throw new Error("Invalid search cursor.");
}

export function isFindCursor(cursor: string): boolean {
  try {
    decodeFindCursor(cursor);
    return true;
  } catch {
    return false;
  }
}

export function encodeTextSearchCursor(
  context: Omit<TextSearchCursorContext, "offset"> & {
    readonly offset: number;
  },
): string {
  return encodeBase64UrlText(JSON.stringify({ ...context, v: 2 }));
}

export function decodeTextSearchCursor(
  cursor: string | undefined,
): TextSearchCursorContext | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(decodeBase64UrlText(cursor));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("v" in parsed) ||
      parsed.v !== 2 ||
      !("offset" in parsed) ||
      typeof parsed.offset !== "number" ||
      !Number.isInteger(parsed.offset) ||
      parsed.offset < 0 ||
      ("archiveKey" in parsed && typeof parsed.archiveKey !== "string") ||
      !("chapters" in parsed) ||
      (parsed.chapters !== null &&
        (!Array.isArray(parsed.chapters) ||
          !parsed.chapters.every(
            (chapter) =>
              typeof chapter === "number" && Number.isInteger(chapter),
          ))) ||
      !("match" in parsed) ||
      (parsed.match !== "all" && parsed.match !== "any") ||
      !("order" in parsed) ||
      (parsed.order !== "doc-asc" && parsed.order !== "doc-desc") ||
      !("query" in parsed) ||
      typeof parsed.query !== "string" ||
      !("queryMode" in parsed) ||
      (parsed.queryMode !== "fts" &&
        parsed.queryMode !== "embedding" &&
        parsed.queryMode !== "hybrid") ||
      !("types" in parsed) ||
      (parsed.types !== null &&
        (!Array.isArray(parsed.types) ||
          !parsed.types.every(
            (type) => typeof type === "string" && isFindFilterType(type),
          )))
    ) {
      return undefined;
    }
    return parsed as TextSearchCursorContext;
  } catch {
    return undefined;
  }
}

export function isTextSearchCursor(cursor: string | undefined): boolean {
  return decodeTextSearchCursor(cursor) !== undefined;
}

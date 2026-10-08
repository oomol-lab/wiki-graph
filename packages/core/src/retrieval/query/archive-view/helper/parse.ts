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

export function createSearchTerms(query: string): readonly string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
}

export function isFindFilterType(
  type: ArchiveFindObjectType,
): type is ArchiveFindFilterType {
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

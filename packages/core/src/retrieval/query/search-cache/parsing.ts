import type { ArchiveFindHit } from "../view.js";

export function parseSearchResultItem(value: string): ArchiveFindHit {
  const parsed: unknown = JSON.parse(value);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid cached search result.");
  }

  return parsed as ArchiveFindHit;
}

export function parseSessionOptions(value: string): {
  readonly chapters: readonly number[] | null;
  readonly types: readonly string[] | null;
} {
  const parsed: unknown = JSON.parse(value);

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "chapters" in parsed &&
    "types" in parsed &&
    (parsed.chapters === null ||
      (Array.isArray(parsed.chapters) &&
        parsed.chapters.every((chapter) => typeof chapter === "number"))) &&
    (parsed.types === null ||
      (Array.isArray(parsed.types) &&
        parsed.types.every((type) => typeof type === "string")))
  ) {
    return {
      chapters: parsed.chapters,
      types: parsed.types,
    };
  }

  throw new Error("Invalid cached search session.");
}

export function parseStringArray(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);

  if (
    Array.isArray(parsed) &&
    parsed.every((item) => typeof item === "string")
  ) {
    return parsed;
  }

  throw new Error("Invalid cached search session.");
}

export function parseNumberArray(value: string): readonly number[] {
  const parsed: unknown = JSON.parse(value);

  if (
    Array.isArray(parsed) &&
    parsed.every((item) => typeof item === "number" && Number.isFinite(item))
  ) {
    return parsed.map((item) => Number(item));
  }

  return [];
}

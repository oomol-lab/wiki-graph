import { parseChapterPath, type ArchiveTriplePattern } from "wiki-graph-core";

import type { ArchiveUriLens, ChapterStateUriTarget } from "../../types.js";
import {
  parseArchiveUriLensObjectUri,
  parseTriplePatternObjectUri,
  parseTriplePatternSuffix,
} from "../triple-pattern.js";

export type ChapterUriTarget =
  | { readonly kind: "collection" }
  | { readonly kind: "lens"; readonly lens: ArchiveUriLens }
  | {
      readonly kind: "triple-pattern-lens";
      readonly pattern: ArchiveTriplePattern;
    }
  | { readonly kind: "tree" }
  | { readonly chapterPath: string; readonly kind: "chapter" }
  | {
      readonly chapterPath: string;
      readonly kind: "chapter-lens";
      readonly lens: ArchiveUriLens;
    }
  | {
      readonly chapterPath: string;
      readonly kind: "chapter-triple-pattern-lens";
      readonly pattern: ArchiveTriplePattern;
    }
  | {
      readonly chapterPath: string;
      readonly kind: "chapter-state";
      readonly target?: ChapterStateUriTarget;
    }
  | {
      readonly chapterPath: string;
      readonly kind: "chapter-resource";
      readonly resource: "source" | "summary" | "title";
    };

export function parseChapterTarget(
  objectUri: string,
): ChapterUriTarget | undefined {
  if (objectUri === "wikg://chapter") {
    return { kind: "collection" };
  }

  if (objectUri === "wikg://chapter/tree") {
    return { kind: "tree" };
  }

  const archiveLens = parseArchiveUriLensObjectUri(objectUri);
  if (archiveLens !== undefined) {
    return { kind: "lens", lens: archiveLens };
  }

  const archiveTriplePattern = parseTriplePatternObjectUri(objectUri);
  if (archiveTriplePattern !== undefined) {
    return {
      kind: "triple-pattern-lens",
      pattern: archiveTriplePattern,
    };
  }

  const match = /^wikg:\/\/chapter\/(.+)$/u.exec(objectUri);

  if (match?.[1] === undefined) {
    return undefined;
  }

  const parsed = parseChapterPathAndSuffix(match[1]);
  if (parsed === undefined) {
    return undefined;
  }
  const { chapterPath, suffix } = parsed;
  const chapterTriplePattern =
    suffix === undefined ? undefined : parseTriplePatternSuffix(suffix);

  if (chapterTriplePattern !== undefined) {
    return {
      chapterPath,
      kind: "chapter-triple-pattern-lens",
      pattern: chapterTriplePattern,
    };
  }

  const chapterStateTarget = parseChapterStateSuffix(suffix);

  if (chapterStateTarget !== undefined) {
    return {
      chapterPath,
      kind: "chapter-state",
      ...(chapterStateTarget === "all" ? {} : { target: chapterStateTarget }),
    };
  }

  const resource = parseChapterResourceSuffix(suffix);

  if (suffix !== undefined && resource === undefined) {
    return undefined;
  }

  if (resource === undefined) {
    return { chapterPath, kind: "chapter" };
  }
  if (resource === "state") {
    return { chapterPath, kind: "chapter-state" };
  }
  if (resource === "chunk" || resource === "entity" || resource === "triple") {
    return { chapterPath, kind: "chapter-lens", lens: resource };
  }
  if (resource === "source" || resource === "summary") {
    return { chapterPath, kind: "chapter-resource", resource };
  }

  return { chapterPath, kind: "chapter-resource", resource };
}

function parseChapterPathAndSuffix(
  value: string,
): { readonly chapterPath: string; readonly suffix?: string } | undefined {
  const parts = value.replace(/\/+$/u, "").split("/");
  const suffixStart = parts.findIndex((part) =>
    [
      "chunk",
      "entity",
      "source",
      "state",
      "summary",
      "title",
      "triple",
    ].includes(part),
  );
  const pathParts = suffixStart === -1 ? parts : parts.slice(0, suffixStart);
  const suffixParts = suffixStart === -1 ? [] : parts.slice(suffixStart);

  try {
    const chapterPath = parseChapterPath(pathParts.join("/"), "chapter URI");
    return {
      chapterPath,
      ...(suffixParts.length === 0 ? {} : { suffix: suffixParts.join("/") }),
    };
  } catch {
    return undefined;
  }
}

function parseChapterStateSuffix(
  suffix: string | undefined,
): ChapterStateUriTarget | "all" | undefined {
  if (suffix === "state") {
    return "all";
  }

  switch (suffix) {
    case "state/source":
      return "source";
    case "state/reading-graph":
      return "reading-graph";
    case "state/reading-summary":
      return "reading-summary";
    case "state/knowledge-graph":
      return "knowledge-graph";
    default:
      return undefined;
  }
}

function parseChapterResourceSuffix(
  suffix: string | undefined,
):
  | "chunk"
  | "entity"
  | "source"
  | "state"
  | "summary"
  | "title"
  | "triple"
  | undefined {
  switch (suffix) {
    case undefined:
    case "chunk":
    case "entity":
    case "source":
    case "state":
    case "summary":
    case "title":
    case "triple":
      return suffix;
    default:
      return undefined;
  }
}

import type { ArchiveTriplePattern } from "wiki-graph-core";

import type { ArchiveUriLens, ChapterStateUriTarget } from "../types.js";
import { parseArchiveUriLensObjectUri, parseTriplePatternObjectUri, parseTriplePatternSuffix } from "./triple-pattern.js";

export type ChapterUriTarget =
  | { readonly kind: "collection" }
  | { readonly kind: "lens"; readonly lens: ArchiveUriLens }
  | {
      readonly kind: "triple-pattern-lens";
      readonly pattern: ArchiveTriplePattern;
    }
  | { readonly kind: "tree" }
  | { readonly chapterId: number; readonly kind: "chapter" }
  | {
      readonly chapterId: number;
      readonly kind: "chapter-lens";
      readonly lens: ArchiveUriLens;
    }
  | {
      readonly chapterId: number;
      readonly kind: "chapter-triple-pattern-lens";
      readonly pattern: ArchiveTriplePattern;
    }
  | {
      readonly chapterId: number;
      readonly kind: "chapter-state";
      readonly target?: ChapterStateUriTarget;
    }
  | {
      readonly chapterId: number;
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

  const match = /^wikg:\/\/chapter\/([1-9][0-9]*)(?:\/(.*))?\/?$/u.exec(
    objectUri,
  );

  if (match?.[1] === undefined) {
    return undefined;
  }

  const chapterId = Number(match[1]);
  const suffix = match[2] === "" ? undefined : match[2];
  const chapterTriplePattern =
    suffix === undefined ? undefined : parseTriplePatternSuffix(suffix);

  if (chapterTriplePattern !== undefined) {
    return {
      chapterId,
      kind: "chapter-triple-pattern-lens",
      pattern: chapterTriplePattern,
    };
  }

  const chapterStateTarget = parseChapterStateSuffix(suffix);

  if (chapterStateTarget !== undefined) {
    return {
      chapterId,
      kind: "chapter-state",
      ...(chapterStateTarget === "all" ? {} : { target: chapterStateTarget }),
    };
  }

  const resource = parseChapterResourceSuffix(suffix);

  if (suffix !== undefined && resource === undefined) {
    return undefined;
  }

  if (resource === undefined) {
    return { chapterId, kind: "chapter" };
  }
  if (resource === "state") {
    return { chapterId, kind: "chapter-state" };
  }
  if (resource === "chunk" || resource === "entity" || resource === "triple") {
    return { chapterId, kind: "chapter-lens", lens: resource };
  }
  if (resource === "source" || resource === "summary") {
    return { chapterId, kind: "chapter-resource", resource };
  }

  return { chapterId, kind: "chapter-resource", resource };
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

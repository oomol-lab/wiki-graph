import type { ArchiveTriplePattern } from "wiki-graph-core";

import type { ArchiveUriLens } from "../types.js";

export function parseTriplePatternObjectUri(
  objectUri: string,
): ArchiveTriplePattern | undefined {
  if (!objectUri.startsWith("wikg://triple/")) {
    return undefined;
  }

  return parseTriplePatternSuffix(objectUri.slice("wikg://".length));
}

export function parseTriplePatternSuffix(
  suffix: string,
): ArchiveTriplePattern | undefined {
  const parts = suffix.split("/");

  if (parts[0] !== "triple" || parts.length < 2 || parts.length > 4) {
    return undefined;
  }

  const [subject = "_", predicate = "_", object = "_"] = parts.slice(1);
  const hasPlaceholder = parts.slice(1).includes("_");
  const hasOmittedTrailingPlaceholder = parts.length < 4;

  if (!hasPlaceholder && !hasOmittedTrailingPlaceholder) {
    return undefined;
  }

  if (
    !isTriplePatternQidSegment(subject) ||
    !isTriplePatternPredicateSegment(predicate) ||
    !isTriplePatternQidSegment(object)
  ) {
    return undefined;
  }

  return {
    ...(object === "_" ? {} : { objectQid: object }),
    ...(predicate === "_" ? {} : { predicate: decodeURIComponent(predicate) }),
    ...(subject === "_" ? {} : { subjectQid: subject }),
  };
}

export function isTripleScopePath(path: string): boolean {
  if (path === "triple" || /^chapter\/[1-9][0-9]*\/triple$/u.test(path)) {
    return true;
  }

  const suffix = path.startsWith("chapter/")
    ? /^chapter\/[1-9][0-9]*\/(.+)$/u.exec(path)?.[1]
    : path;

  return suffix === undefined
    ? false
    : parseTriplePatternSuffix(suffix) !== undefined;
}

function isTriplePatternQidSegment(value: string): boolean {
  return value === "_" || /^Q[1-9][0-9]*$/u.test(value);
}

function isTriplePatternPredicateSegment(value: string): boolean {
  return value === "_" || (value !== "" && !value.includes("/"));
}

export function parseArchiveUriLensObjectUri(
  objectUri: string,
): ArchiveUriLens | undefined {
  switch (objectUri) {
    case "wikg://chapter":
      return "chapter";
    case "wikg://chunk":
      return "chunk";
    case "wikg://entity":
      return "entity";
    case "wikg://triple":
      return "triple";
    default:
      return undefined;
  }
}

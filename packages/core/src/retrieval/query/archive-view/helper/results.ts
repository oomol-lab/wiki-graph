import type {
  ArchiveCollectionOptions,
  ArchiveCollectionResult,
  ArchiveCollectionType,
  ArchiveFindFilterType,
  ArchiveFindHit,
  ArchiveFindLens,
  ArchiveFindOptions,
  ArchiveFindResult,
  ArchiveTriplePattern,
} from "../types.js";
import { BROAD_FIND_LENS_HINT, DEFAULT_FIND_LIMIT } from "./constants.js";
import {
  decodeFindCursor,
  encodeFindCursor,
  createSearchTerms,
  isCollectionType,
  isFindFilterType,
} from "./parse.js";
import { compareListHits, compareSearchHits } from "./sort.js";
import { aggregateEvidenceScores, compareFindEvidenceHits } from "./text.js";

export function createFindResult(
  query: string,
  hits: readonly ArchiveFindHit[],
  options: ArchiveFindOptions,
  terms = createSearchTerms(query),
  lens: ArchiveFindLens = options.types === undefined ? "broad" : "typed",
): ArchiveFindResult {
  const ranked = createRankedFindResult(query, hits, options, terms, lens);
  const start = decodeFindCursor(options.cursor);
  const items = ranked.items.slice(start, start + ranked.limit);
  const nextOffset = start + items.length;

  return {
    ...ranked,
    items,
    nextCursor:
      nextOffset < ranked.items.length ? encodeFindCursor(nextOffset) : null,
  };
}

export function createRankedFindResult(
  query: string,
  hits: readonly ArchiveFindHit[],
  options: ArchiveFindOptions,
  terms = createSearchTerms(query),
  lens: ArchiveFindLens = options.types === undefined ? "broad" : "typed",
): ArchiveFindResult {
  const order = options.order ?? "doc-asc";
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const chapters = options.chapters ?? null;
  const match = options.match ?? "any";
  const types = options.types ?? null;
  const ids = options.ids ?? null;
  const filtered = groupFindHitsByObject(hits)
    .filter((hit) => matchesFindId(hit, ids))
    .filter((hit) => matchesFindChapter(hit, chapters))
    .filter((hit) => matchesFindType(hit, types))
    .filter((hit) => matchesTriplePattern(hit, options.triplePattern))
    .sort((left, right) => compareSearchHits(left, right, order));

  return {
    chapters,
    items: filtered,
    lens,
    lensHint: lens === "broad" ? BROAD_FIND_LENS_HINT : null,
    limit,
    match,
    nextCursor: null,
    order,
    query,
    terms,
    types,
  };
}

export function groupFindHitsByObject(
  hits: readonly ArchiveFindHit[],
): readonly ArchiveFindHit[] {
  const hitsById = new Map<string, ArchiveFindHit[]>();

  for (const hit of hits) {
    const values = hitsById.get(hit.id) ?? [];

    values.push(hit);
    hitsById.set(hit.id, values);
  }

  return [...hitsById.values()].map(groupObjectEvidenceHits);
}

export function groupObjectEvidenceHits(
  evidenceHits: readonly ArchiveFindHit[],
): ArchiveFindHit {
  const rankedHits = [...evidenceHits].sort(compareFindEvidenceHits);
  const [best] = rankedHits;

  if (best === undefined) {
    throw new Error("Internal error: search result candidate is empty.");
  }
  if (rankedHits.length === 1) {
    return best;
  }

  return {
    ...best,
    matchCount: Math.max(...rankedHits.map((hit) => hit.matchCount ?? 0)),
    matchedTerms: mergeStringLists(
      rankedHits.flatMap((hit) => hit.matchedTerms ?? []),
    ),
    missingTerms: mergeStringLists(
      rankedHits.flatMap((hit) => hit.missingTerms ?? []),
    ),
    score: aggregateEvidenceScores(rankedHits.map((hit) => hit.score ?? 0)),
  };
}

export function mergeStringLists(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export function createCollectionResult(
  hits: readonly ArchiveFindHit[],
  options: ArchiveCollectionOptions,
): ArchiveCollectionResult {
  const order = options.order ?? "doc-asc";
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const chapters = options.chapters ?? null;
  const ids = options.ids ?? null;
  const types = options.types ?? null;
  const start = decodeFindCursor(options.cursor);
  const filtered = hits
    .filter((hit) => matchesFindId(hit, ids))
    .filter((hit) => matchesFindChapter(hit, chapters))
    .filter((hit) => matchesCollectionType(hit, types))
    .filter((hit) => matchesTriplePattern(hit, options.triplePattern))
    .sort((left, right) => compareListHits(left, right, order));
  const items = filtered.slice(start, start + limit);
  const nextOffset = start + items.length;

  return {
    chapters,
    ids,
    items,
    limit,
    nextCursor:
      nextOffset < filtered.length ? encodeFindCursor(nextOffset) : null,
    order,
    types,
  };
}

export function matchesFindId(
  hit: ArchiveFindHit,
  ids: readonly string[] | null,
): boolean {
  return ids === null || ids.includes(hit.id);
}

export function matchesFindChapter(
  hit: ArchiveFindHit,
  chapters: readonly number[] | null,
): boolean {
  if (chapters === null) {
    return true;
  }

  return hit.chapter !== undefined && chapters.includes(hit.chapter);
}

export function matchesFindType(
  hit: ArchiveFindHit,
  types: readonly ArchiveFindFilterType[] | null,
): boolean {
  if (types === null) {
    return true;
  }

  if (hit.type === "chapter-title" && types.includes("chapter")) {
    return true;
  }

  return isFindFilterType(hit.type) && types.includes(hit.type);
}

export function matchesCollectionType(
  hit: ArchiveFindHit,
  types: readonly ArchiveCollectionType[] | null,
): boolean {
  return (
    types === null || (isCollectionType(hit.type) && types.includes(hit.type))
  );
}

export function matchesTriplePattern(
  hit: ArchiveFindHit,
  pattern: ArchiveTriplePattern | undefined,
): boolean {
  if (pattern === undefined || hit.type !== "triple") {
    return true;
  }

  const triple = parseTripleHitUri(hit.id);

  if (triple === undefined) {
    return false;
  }

  return (
    (pattern.subjectQid === undefined ||
      pattern.subjectQid === triple.subjectQid) &&
    (pattern.predicate === undefined ||
      pattern.predicate === triple.predicate) &&
    (pattern.objectQid === undefined || pattern.objectQid === triple.objectQid)
  );
}

export function parseTripleHitUri(uri: string):
  | {
      readonly objectQid: string;
      readonly predicate: string;
      readonly subjectQid: string;
    }
  | undefined {
  const match =
    /^wikg:\/\/triple\/(Q[1-9][0-9]*)\/([^/]+)\/(Q[1-9][0-9]*)$/u.exec(uri);

  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return undefined;
  }

  return {
    objectQid: match[3],
    predicate: decodeURIComponent(match[2]),
    subjectQid: match[1],
  };
}

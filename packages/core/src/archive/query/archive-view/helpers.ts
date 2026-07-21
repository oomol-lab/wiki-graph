import type { SentenceId } from "../../../document/index.js";
import type { BookMeta } from "../../../source/index.js";
import { WIKI_GRAPH_URI_PREFIX } from "../../../common/wiki-graph-uri.js";

import type {
  ArchiveCollectionOptions,
  ArchiveCollectionResult,
  ArchiveCollectionType,
  ArchiveFindFilterType,
  ArchiveFindHit,
  ArchiveFindLens,
  ArchiveFindLensHint,
  ArchiveFindMatch,
  ArchiveFindObjectType,
  ArchiveFindOptions,
  ArchiveFindOrder,
  ArchiveFindPosition,
  ArchiveFindResult,
  ArchiveTriplePattern,
} from "./types.js";

export interface ArchiveTextSearch {
  readonly match: ArchiveFindMatch;
  readonly terms: readonly string[];
}

export interface ArchiveTextMatch {
  readonly matchCount: number;
  readonly matchedTerms: readonly string[];
  readonly missingTerms: readonly string[];
  readonly score: number;
}

export const DEFAULT_FIND_LIMIT = 20;
const GROUP_SCORE_EVIDENCE_LIMIT = 10;
export const TEXT_ONLY_SEARCH_CACHE_WINDOW = 100;
const GROUP_SCORE_MAX_EQUAL_EVIDENCE_BONUS = 0.3;
export const ARCHIVE_ROOT_ID = "meta:root";

export function isWikiGraphObjectUri(uri: string): boolean {
  return uri.startsWith(WIKI_GRAPH_URI_PREFIX);
}

export function normalizeWikiGraphObjectUri(uri: string): string {
  return uri;
}

export const BROAD_FIND_LENS_HINT = {
  lenses: {
    chapter: "book outline and chapter titles",
    chunk: "source text ranges",
    entity: "indexed entities",
    node: "topology / LLM Wiki structure",
    triple: "knowledge graph statements",
  },
  message:
    "Choose scope URI lenses such as /chapter, /chunk, /entity, or /triple for broad search.",
} satisfies ArchiveFindLensHint;

export function createPhraseSearch(query: string): ArchiveTextSearch | undefined {
  const needle = query.trim().toLowerCase();

  if (needle === "") {
    return undefined;
  }

  return {
    match: "all",
    terms: [needle],
  };
}

export function matchText(
  value: string,
  search: ArchiveTextSearch,
): ArchiveTextMatch | undefined {
  const lower = value.toLowerCase();
  const matchedTerms = search.terms.filter((term) => lower.includes(term));
  const missingTerms = search.terms.filter((term) => !lower.includes(term));

  if (search.match === "all" && missingTerms.length > 0) {
    return undefined;
  }
  if (search.match === "any" && matchedTerms.length === 0) {
    return undefined;
  }
  const [snippetNeedle] = matchedTerms;

  if (snippetNeedle === undefined) {
    return undefined;
  }

  return {
    matchCount: matchedTerms.length,
    matchedTerms,
    missingTerms,
    score: matchedTerms.length / search.terms.length,
  };
}

export function createFindMatchFields(
  match: ArchiveTextMatch,
): Pick<
  ArchiveFindHit,
  "matchCount" | "matchedTerms" | "missingTerms" | "score"
> {
  return {
    matchCount: match.matchCount,
    matchedTerms: match.matchedTerms,
    missingTerms: match.missingTerms,
    score: match.score,
  };
}

export function aggregateEvidenceScores(scores: readonly number[]): number {
  const rankedScores = [...scores]
    .filter((score) => score > 0)
    .sort((left, right) => right - left)
    .slice(0, GROUP_SCORE_EVIDENCE_LIMIT);
  const [bestScore] = rankedScores;

  if (bestScore === undefined) {
    return 0;
  }

  const evidenceDecayFactor =
    GROUP_SCORE_MAX_EQUAL_EVIDENCE_BONUS / calculateEvidenceDecayBase();

  return rankedScores.reduce(
    (total, score, index) =>
      total +
      score * (index === 0 ? 1 : evidenceDecayFactor / Math.log2(index + 2)),
    0,
  );
}

export function calculateEvidenceDecayBase(): number {
  let total = 0;

  for (let rank = 2; rank <= GROUP_SCORE_EVIDENCE_LIMIT; rank += 1) {
    total += 1 / Math.log2(rank + 1);
  }

  return total;
}

export function compareFindEvidenceHits(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
): number {
  const scoreComparison = (right.score ?? 0) - (left.score ?? 0);

  if (scoreComparison !== 0) {
    return scoreComparison;
  }
  if (left.position === undefined) {
    return right.position === undefined ? 0 : 1;
  }
  if (right.position === undefined) {
    return -1;
  }
  return compareArchivePositions(left.position, right.position);
}

export function getSnippetNeedle(match: ArchiveTextMatch): string {
  const [needle] = match.matchedTerms;

  if (needle === undefined) {
    throw new Error("Internal error: missing matched search term.");
  }

  return needle;
}

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

export function compareSearchHits(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
  order: ArchiveFindOrder,
): number {
  const direction = order === "doc-asc" ? 1 : -1;
  const relevance =
    compareNumbers(getSearchBucket(left.type), getSearchBucket(right.type)) ||
    compareNumbers(right.score ?? 0, left.score ?? 0) ||
    compareNumbers(right.matchCount ?? 0, left.matchCount ?? 0);
  const position =
    compareNumbers(
      getPositionDocumentOrder(left),
      getPositionDocumentOrder(right),
    ) ||
    compareNumbers(getPositionChapter(left), getPositionChapter(right)) ||
    compareNumbers(getPositionFragment(left), getPositionFragment(right)) ||
    compareNumbers(getPositionSentence(left), getPositionSentence(right)) ||
    compareNumbers(getTypeOrder(left.type), getTypeOrder(right.type)) ||
    left.id.localeCompare(right.id);

  return relevance || position * direction;
}

export function compareListHits(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
  order: ArchiveFindOrder,
): number {
  const direction = order === "doc-asc" ? 1 : -1;
  const bucketComparison =
    compareNumbers(getListBucket(left.type), getListBucket(right.type)) ||
    compareListBucketItems(left, right);

  if (bucketComparison !== 0) {
    return bucketComparison;
  }

  return compareListPosition(left, right) * direction;
}

export function compareListBucketItems(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
): number {
  const leftBucket = getListBucket(left.type);

  if (leftBucket !== getListBucket(right.type)) {
    return 0;
  }
  if (leftBucket === 0) {
    return compareNumbers(right.score ?? 0, left.score ?? 0);
  }

  return 0;
}

export function compareListPosition(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
): number {
  return (
    compareNumbers(
      getPositionDocumentOrder(left),
      getPositionDocumentOrder(right),
    ) ||
    compareNumbers(getPositionChapter(left), getPositionChapter(right)) ||
    compareNumbers(getPositionFragment(left), getPositionFragment(right)) ||
    compareNumbers(getPositionSentence(left), getPositionSentence(right)) ||
    compareNumbers(getTypeOrder(left.type), getTypeOrder(right.type)) ||
    left.id.localeCompare(right.id)
  );
}

export function getListBucket(type: ArchiveFindObjectType): number {
  switch (type) {
    case "entity":
    case "triple":
      return 0;
    case "node":
      return 1;
    case "summary":
      return 2;
    case "source":
    case "fragment":
      return 3;
    case "chapter-title":
    case "chapter":
    case "chapter-tree":
    case "meta":
      return 4;
  }
}

export function getSearchBucket(type: ArchiveFindObjectType): number {
  switch (type) {
    case "chapter-title":
      return 0;
    case "entity":
    case "triple":
      return 1;
    case "node":
      return 2;
    case "source":
    case "summary":
      return 3;
    case "chapter":
    case "chapter-tree":
    case "meta":
    case "fragment":
      throw new Error(`Unsupported search result bucket type: ${type}`);
  }
}

export function createSearchTerms(query: string): readonly string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
}

export function getPositionChapter(hit: ArchiveFindHit): number {
  return hit.position?.chapter ?? Number.MAX_SAFE_INTEGER;
}

export function getPositionDocumentOrder(hit: ArchiveFindHit): number {
  return (
    hit.position?.documentOrder ??
    hit.position?.chapter ??
    Number.MAX_SAFE_INTEGER
  );
}

export function getPositionFragment(hit: ArchiveFindHit): number {
  return hit.position?.fragment ?? 0;
}

export function getPositionSentence(hit: ArchiveFindHit): number {
  return hit.position?.sentence ?? 0;
}

export function getTypeOrder(type: ArchiveFindObjectType): number {
  switch (type) {
    case "chapter-title":
    case "chapter":
      return 0;
    case "chapter-tree":
      return 1;
    case "entity":
      return 2;
    case "triple":
      return 3;
    case "summary":
      return 4;
    case "node":
      return 5;
    case "source":
      return 6;
    case "fragment":
      return 6;
    case "meta":
      return 7;
  }
}

export function createNodePosition(
  sentenceIds: readonly SentenceId[],
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindPosition | undefined {
  const [first] = [...sentenceIds].sort(compareSentenceIds);

  return first === undefined
    ? undefined
    : createSentencePosition(first, documentOrders);
}

export function createSentencePosition(
  sentenceId: SentenceId,
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindPosition {
  return {
    chapter: sentenceId[0],
    documentOrder: documentOrders?.get(sentenceId[0]) ?? sentenceId[0],
    fragment: sentenceId[1],
    sentence: sentenceId[1],
  };
}

export function compareSentenceIds(
  left: SentenceId,
  right: SentenceId,
  documentOrders?: ReadonlyMap<number, number>,
): number {
  return (
    compareNumbers(
      documentOrders?.get(left[0]) ?? left[0],
      documentOrders?.get(right[0]) ?? right[0],
    ) ||
    compareNumbers(left[0], right[0]) ||
    compareNumbers(left[1], right[1])
  );
}

export function compareArchivePositions(
  left: ArchiveFindPosition,
  right: ArchiveFindPosition,
): number {
  return (
    compareNumbers(
      left.documentOrder ?? left.chapter,
      right.documentOrder ?? right.chapter,
    ) ||
    compareNumbers(left.chapter, right.chapter) ||
    compareNumbers(left.fragment ?? 0, right.fragment ?? 0) ||
    compareNumbers(left.sentence ?? 0, right.sentence ?? 0)
  );
}

export function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function isFindFilterType(
  type: ArchiveFindObjectType,
): type is ArchiveFindFilterType {
  return (
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
  return Buffer.from(JSON.stringify({ offset, v: 1 })).toString("base64url");
}

export function decodeFindCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );

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

export function createSnippet(value: string, needle?: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();

  if (needle === undefined) {
    return collapsed.length > 180 ? `${collapsed.slice(0, 177)}...` : collapsed;
  }

  const index = collapsed.toLowerCase().indexOf(needle);

  if (index < 0) {
    return collapsed.length > 180 ? `${collapsed.slice(0, 177)}...` : collapsed;
  }

  const start = Math.max(0, index - 60);
  const end = Math.min(collapsed.length, index + needle.length + 120);
  const prefix = start === 0 ? "" : "...";
  const suffix = end === collapsed.length ? "" : "...";

  return `${prefix}${collapsed.slice(start, end)}${suffix}`;
}

export function formatMetaSummary(meta: BookMeta | undefined): string {
  if (meta === undefined) {
    return "[missing]";
  }

  return [meta.title, meta.authors.join(", "), meta.publisher]
    .filter((value) => value !== null && value !== "")
    .join(" / ");
}

export function formatMetaTitle(meta: BookMeta | undefined): string {
  return meta?.title ?? "Archive metadata";
}

export function createMetaPage(meta: BookMeta | undefined): {
  readonly authors?: readonly string[];
  readonly description?: string;
  readonly publisher?: string;
  readonly title: string;
} {
  return {
    ...(meta?.authors === undefined || meta.authors.length === 0
      ? {}
      : { authors: meta.authors }),
    ...(meta?.description === undefined || meta.description === null
      ? {}
      : { description: meta.description }),
    ...(meta?.publisher === undefined || meta.publisher === null
      ? {}
      : { publisher: meta.publisher }),
    title: formatMetaTitle(meta),
  };
}

export function formatMetaText(meta: BookMeta | undefined): string {
  const page = createMetaPage(meta);

  return [
    `title: ${page.title}`,
    page.authors === undefined
      ? undefined
      : `authors: ${page.authors.join(", ")}`,
    page.publisher === undefined ? undefined : `publisher: ${page.publisher}`,
    page.description === undefined
      ? undefined
      : `description: ${page.description}`,
  ]
    .filter(isDefined)
    .join("\n");
}

export function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(3);
}

export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

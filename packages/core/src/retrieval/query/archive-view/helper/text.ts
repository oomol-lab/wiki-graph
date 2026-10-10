import type { ArchiveFindHit, ArchiveFindMatch } from "../types.js";
import { aggregateTopScores } from "../../score-aggregation.js";
import { compareArchivePositions } from "./position.js";

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

export function createPhraseSearch(
  query: string,
): ArchiveTextSearch | undefined {
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
  return aggregateTopScores(scores);
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

import type { ArchiveFindHit, ArchiveFindMatch } from "../types.js";
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

const GROUP_SCORE_EVIDENCE_LIMIT = 10;
const GROUP_SCORE_MAX_EQUAL_EVIDENCE_BONUS = 0.3;

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

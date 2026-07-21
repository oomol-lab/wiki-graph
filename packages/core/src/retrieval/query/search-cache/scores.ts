import { SEARCH_TOP_SCORE_COUNT } from "./schema.js";

export function mergeTopScores(
  current: readonly number[],
  incoming: readonly number[],
): readonly number[] {
  return [...current, ...incoming]
    .filter((score) => Number.isFinite(score))
    .sort((left, right) => right - left)
    .slice(0, SEARCH_TOP_SCORE_COUNT);
}

export function aggregateCachedScores(scores: readonly number[]): number {
  return scores
    .slice(0, SEARCH_TOP_SCORE_COUNT)
    .reduce((total, score, index) => total + score / Math.log2(index + 2), 0);
}

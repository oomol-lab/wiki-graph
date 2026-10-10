import { SEARCH_TOP_SCORE_COUNT } from "./schema.js";
import { aggregateTopScores } from "../score-aggregation.js";

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
  return aggregateTopScores(scores, SEARCH_TOP_SCORE_COUNT);
}

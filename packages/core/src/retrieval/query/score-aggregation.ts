const DEFAULT_SCORE_LIMIT = 10;
const SCORE_POWER = 4;

export function aggregateTopScores(
  scores: readonly number[],
  limit = DEFAULT_SCORE_LIMIT,
): number {
  const rankedScores = [...scores]
    .filter((score) => Number.isFinite(score) && score > 0)
    .sort((left, right) => right - left)
    .slice(0, limit);

  if (rankedScores.length === 0) {
    return 0;
  }

  let weightedPowers = 0;
  let totalWeight = 0;

  for (const [index, score] of rankedScores.entries()) {
    const weight = 1 / Math.log2(index + 2);
    weightedPowers += weight * score ** SCORE_POWER;
    totalWeight += weight;
  }

  return (weightedPowers / totalWeight) ** (1 / SCORE_POWER);
}

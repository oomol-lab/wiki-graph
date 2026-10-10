const RANK_OFFSET = 60;
const RAW_SCORE_WEIGHT = 0.2;

export function normalizeSearchHitScore(
  rawScore: number,
  rank: number,
  topRawScore: number,
  direction: "ascending" | "descending",
): number {
  if (!Number.isFinite(rawScore) || !Number.isFinite(topRawScore)) return 0;
  if (!Number.isSafeInteger(rank) || rank < 1) return 0;

  const strength = toStrength(rawScore, direction);
  const topStrength = toStrength(topRawScore, direction);
  const relativeRawScore =
    topStrength <= 0 ? 0 : Math.min(1, strength / topStrength);
  const rankScore = (RANK_OFFSET + 1) / (RANK_OFFSET + rank);

  return (
    rankScore * (1 - RAW_SCORE_WEIGHT + RAW_SCORE_WEIGHT * relativeRawScore)
  );
}

function toStrength(
  rawScore: number,
  direction: "ascending" | "descending",
): number {
  return Math.max(0, direction === "ascending" ? -rawScore : rawScore);
}

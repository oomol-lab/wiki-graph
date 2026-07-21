export function formatScoredLines(
  score: number | undefined,
  lines: readonly string[],
): string[] {
  return score === undefined ? [...lines] : [`score: ${score}`, ...lines];
}

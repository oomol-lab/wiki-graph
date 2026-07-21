import type { RankedSentenceCandidate } from "../types.js";

export interface TextMatchScore {
  readonly score: number;
  readonly exactRaw: boolean;
  readonly exactNormalized: boolean;
  readonly exactSubstring: boolean;
  readonly matchStart: number;
  readonly matchEnd: number;
}

export function createEmptyTextMatchScore(): TextMatchScore {
  return {
    exactNormalized: false,
    exactRaw: false,
    exactSubstring: false,
    matchEnd: -1,
    matchStart: -1,
    score: 0,
  };
}

export function charNgramScore(left: string, right: string): number {
  const leftBigrams = charNgrams(left, 2);
  const rightBigrams = charNgrams(right, 2);
  const leftTrigrams = charNgrams(left, 3);
  const rightTrigrams = charNgrams(right, 3);

  return (
    (diceCoefficient(leftBigrams, rightBigrams) +
      diceCoefficient(leftTrigrams, rightTrigrams)) /
    2
  );
}

function charNgrams(text: string, size: number): Set<string> {
  if (text.length <= size) {
    return text === "" ? new Set() : new Set([text]);
  }

  const result = new Set<string>();

  for (let index = 0; index <= text.length - size; index += 1) {
    result.add(text.slice(index, index + size));
  }

  return result;
}

function diceCoefficient(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const value of left) {
    if (right.has(value)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (left.size + right.size);
}

export function levenshteinSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (left === "" || right === "") {
    return 0;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1).fill(0);

  for (const [leftIndex, leftChar] of [...left].entries()) {
    current[0] = leftIndex + 1;

    for (const [rightIndex, rightChar] of [...right].entries()) {
      const insertCost = (current[rightIndex] ?? 0) + 1;
      const deleteCost = (previous[rightIndex + 1] ?? 0) + 1;
      const replaceCost =
        (previous[rightIndex] ?? 0) + (leftChar === rightChar ? 0 : 1);

      current[rightIndex + 1] = Math.min(insertCost, deleteCost, replaceCost);
    }

    [previous, current] = [current, previous];
  }

  const distance =
    previous[right.length] ?? Math.max(left.length, right.length);

  return 1 - distance / Math.max(left.length, right.length);
}

export function lengthPenalty(left: string, right: string): number {
  return (
    1 -
    Math.abs(left.length - right.length) / Math.max(left.length, right.length)
  );
}

export function sequenceSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  const leftLength = left.length;
  const rightLength = right.length;

  if (leftLength === 0 || rightLength === 0) {
    return 0;
  }

  const matrix = Array.from({ length: leftLength + 1 }, () =>
    new Array<number>(rightLength + 1).fill(0),
  );
  let longest = 0;

  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      if (left[leftIndex - 1] !== right[rightIndex - 1]) {
        continue;
      }

      const currentRow = matrix[leftIndex];

      if (currentRow === undefined) {
        continue;
      }

      currentRow[rightIndex] =
        (matrix[leftIndex - 1]?.[rightIndex - 1] ?? 0) + 1;
      longest = Math.max(longest, currentRow[rightIndex] ?? 0);
    }
  }

  return (2 * longest) / (leftLength + rightLength);
}

export function formatCandidate(candidate: RankedSentenceCandidate): string {
  return (
    `  - ${candidate.occurrenceId} score=${candidate.score.toFixed(3)}\n` +
    `    prev: ${truncate(candidate.prevText)}\n` +
    `    text: ${truncate(candidate.text, 120)}\n` +
    `    next: ${truncate(candidate.nextText)}`
  );
}

export function truncate(text: string, limit = 80): string {
  const stripped = text.replace(/\s+/gu, " ").trim();

  if (stripped === "") {
    return "(none)";
  }

  if (stripped.length <= limit) {
    return stripped;
  }

  return `${stripped.slice(0, limit - 3)}...`;
}

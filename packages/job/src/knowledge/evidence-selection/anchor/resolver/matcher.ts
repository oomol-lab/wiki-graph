import { normalizeText } from "../../text.js";

import {
  charNgramScore,
  createEmptyTextMatchScore,
  levenshteinSimilarity,
  lengthPenalty,
  sequenceSimilarity,
  type TextMatchScore,
} from "./scoring.js";
import { MAX_BOUNDARY_BONUS, MIN_BOUNDARY_BONUS_LENGTH } from "./types.js";
import type { AnchorSpec } from "./types.js";

export function scoreAnchor(
  anchor: AnchorSpec,
  candidateText: string,
  label: string,
): TextMatchScore {
  if (anchor.mode === "head_tail") {
    return scoreHeadTail(anchor, candidateText);
  }

  return scoreTextQuery(anchor.text ?? "", candidateText, label);
}

function scoreHeadTail(
  anchor: AnchorSpec,
  candidateText: string,
): TextMatchScore {
  const head = anchor.head ?? "";
  const tail = anchor.tail ?? "";
  const candidateNormalized = normalizeText(candidateText);
  const headNormalized = normalizeText(head);
  const tailNormalized = normalizeText(tail);

  if (headNormalized === "" || tailNormalized === "") {
    return createEmptyTextMatchScore();
  }

  const headPosition = candidateNormalized.indexOf(headNormalized);
  const tailPosition = candidateNormalized.lastIndexOf(tailNormalized);

  if (
    headPosition !== -1 &&
    tailPosition !== -1 &&
    headPosition <= tailPosition
  ) {
    const coveredChars = headNormalized.length + tailNormalized.length;
    const coverage = Math.min(
      1,
      coveredChars / Math.max(1, candidateNormalized.length),
    );

    return {
      exactNormalized: false,
      exactRaw: false,
      exactSubstring: true,
      matchEnd: tailPosition + tailNormalized.length,
      matchStart: headPosition,
      score: 0.82 + 0.18 * coverage,
    };
  }

  const headMatch = scoreTextQuery(head, candidateText, "start_anchor");
  const tailMatch = scoreTextQuery(tail, candidateText, "end_anchor");
  const ordered = headMatch.matchStart <= tailMatch.matchStart ? 1 : 0.85;

  return {
    exactNormalized: false,
    exactRaw: false,
    exactSubstring: false,
    matchEnd: Math.max(headMatch.matchEnd, tailMatch.matchEnd),
    matchStart: Math.min(headMatch.matchStart, tailMatch.matchStart),
    score: ((headMatch.score + tailMatch.score) / 2) * ordered,
  };
}

function scoreTextQuery(
  queryText: string,
  candidateText: string,
  label: string,
): TextMatchScore {
  const queryRaw = queryText.trim();
  const candidateRaw = candidateText.trim();
  const queryNormalized = normalizeText(queryRaw);
  const candidateNormalized = normalizeText(candidateRaw);

  if (queryNormalized === "" || candidateNormalized === "") {
    return createEmptyTextMatchScore();
  }

  if (queryRaw === candidateRaw) {
    return {
      exactNormalized: true,
      exactRaw: true,
      exactSubstring: true,
      matchEnd: candidateNormalized.length,
      matchStart: 0,
      score: 1,
    };
  }

  if (queryNormalized === candidateNormalized) {
    return {
      exactNormalized: true,
      exactRaw: false,
      exactSubstring: false,
      matchEnd: candidateNormalized.length,
      matchStart: 0,
      score: 0.995,
    };
  }

  if (candidateNormalized.includes(queryNormalized)) {
    const matchStart = candidateNormalized.indexOf(queryNormalized);
    const coverage =
      queryNormalized.length / Math.max(1, candidateNormalized.length);
    const boundaryBonus = calculateBoundaryBonus({
      candidateNormalized,
      label,
      matchEnd: matchStart + queryNormalized.length,
      matchStart,
      queryNormalized,
    });

    return {
      exactNormalized: false,
      exactRaw: false,
      exactSubstring: true,
      matchEnd: matchStart + queryNormalized.length,
      matchStart,
      score: Math.min(1, 0.75 + 0.25 * coverage + boundaryBonus),
    };
  }

  if (queryNormalized.includes(candidateNormalized)) {
    const coverage =
      candidateNormalized.length / Math.max(1, queryNormalized.length);

    return {
      exactNormalized: false,
      exactRaw: false,
      exactSubstring: false,
      matchEnd: candidateNormalized.length,
      matchStart: 0,
      score: Math.min(0.92, 0.78 + 0.14 * coverage),
    };
  }

  let bestScore = 0;
  let bestStart = -1;
  let bestEnd = -1;
  const maxWindow = Math.min(
    candidateNormalized.length,
    Math.max(queryNormalized.length, Math.floor(queryNormalized.length * 1.2)),
  );
  const minWindow = Math.min(
    maxWindow,
    Math.max(1, Math.floor(queryNormalized.length * 0.8)),
  );
  const queryChars = new Set(queryNormalized);

  for (let windowSize = minWindow; windowSize <= maxWindow; windowSize += 1) {
    for (
      let start = 0;
      start <= candidateNormalized.length - windowSize;
      start += 1
    ) {
      const window = candidateNormalized.slice(start, start + windowSize);
      const windowChars = new Set(window);
      const unionSize = new Set([...queryChars, ...windowChars]).size;
      const overlapSize = [...queryChars].filter((char) =>
        windowChars.has(char),
      ).length;
      const jaccard = unionSize === 0 ? 0 : overlapSize / unionSize;

      if (jaccard < 0.35) {
        continue;
      }

      const totalScore =
        0.35 * charNgramScore(queryNormalized, window) +
        0.35 * sequenceSimilarity(queryNormalized, window) +
        0.2 * levenshteinSimilarity(queryNormalized, window) +
        0.1 * lengthPenalty(queryNormalized, window) +
        calculateBoundaryBonus({
          candidateNormalized,
          label,
          matchEnd: start + windowSize,
          matchStart: start,
          queryNormalized,
        });

      if (totalScore > bestScore) {
        bestScore = Math.min(1, totalScore);
        bestStart = start;
        bestEnd = start + windowSize;
      }
    }
  }

  return {
    exactNormalized: false,
    exactRaw: false,
    exactSubstring: false,
    matchEnd: bestEnd,
    matchStart: bestStart,
    score: bestScore,
  };
}

function calculateBoundaryBonus(input: {
  label: string;
  queryNormalized: string;
  candidateNormalized: string;
  matchStart: number;
  matchEnd: number;
}): number {
  if (input.matchStart < 0 || input.matchEnd < 0) {
    return 0;
  }

  if (input.queryNormalized.length < MIN_BOUNDARY_BONUS_LENGTH) {
    return 0;
  }

  if (input.label === "start_anchor" && input.matchStart !== 0) {
    return 0;
  }

  if (
    input.label === "end_anchor" &&
    input.matchEnd !== input.candidateNormalized.length
  ) {
    return 0;
  }

  const coverage =
    input.queryNormalized.length /
    Math.max(1, input.candidateNormalized.length);

  return MAX_BOUNDARY_BONUS * (0.5 + 0.5 * Math.min(1, coverage));
}

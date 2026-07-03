const EXACT_SCORE = 1;
const NORMALIZED_EXACT_SCORE = 0.995;
const SUBSTRING_BASE_SCORE = 0.95;
const SUBSTRING_COVERAGE_BONUS = 0.04;
const FUZZY_MIN_WINDOW_RATIO = 0.72;
const FUZZY_MAX_WINDOW_RATIO = 2.25;
const UNORDERED_PENALTY_THRESHOLD = 0.75;
const LOW_ORDERED_PENALTY_THRESHOLD = 0.45;

const CASE_FOLDING_OVERRIDES = new Map<string, string>([
  ["ß", "ss"],
  ["ẞ", "ss"],
  ["ς", "σ"],
]);

export type EvidenceQuoteMatchStrategy =
  | "empty"
  | "exact"
  | "normalized_exact"
  | "normalized_substring"
  | "fuzzy_window";

export interface EvidenceQuoteScore {
  readonly exactRaw: boolean;
  readonly exactNormalized: boolean;
  readonly exactSubstring: boolean;
  readonly matchEnd: number;
  readonly matchStart: number;
  readonly normalizedQuote: string;
  readonly normalizedSentence: string;
  readonly score: number;
  readonly strategy: EvidenceQuoteMatchStrategy;
}

export interface PreparedEvidenceQuote {
  readonly normalizedQuote: string;
  readonly quoteRaw: string;
}

export function normalizeEvidenceDisplayText(text: string): string {
  return text
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeEvidenceText(text: string): string {
  const separated = replaceSeparatorsWithSpace(text);
  const stripped = separated.replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  const compatible = stripped.normalize("NFKC");
  const folded = caseFold(compatible);
  const decomposed = folded.normalize("NFD").replace(/\p{M}/gu, "");
  const reseparated = replaceSeparatorsWithSpace(decomposed);

  return reseparated.replace(/ +/gu, " ").trim();
}

export function scoreEvidenceQuote(input: {
  readonly quote: string;
  readonly sentence: string;
}): EvidenceQuoteScore {
  return scorePreparedEvidenceQuote({
    preparedQuote: prepareEvidenceQuote(input.quote),
    sentence: input.sentence,
  });
}

export function prepareEvidenceQuote(quote: string): PreparedEvidenceQuote {
  const quoteRaw = stripMarkup(quote).trim();

  return {
    normalizedQuote: normalizeEvidenceText(quoteRaw),
    quoteRaw,
  };
}

export function scorePreparedEvidenceQuote(input: {
  readonly preparedQuote: PreparedEvidenceQuote;
  readonly sentence: string;
}): EvidenceQuoteScore {
  const { normalizedQuote, quoteRaw } = input.preparedQuote;
  const sentenceRaw = stripMarkup(input.sentence).trim();
  const normalizedSentence = normalizeEvidenceText(sentenceRaw);

  if (normalizedQuote === "" || normalizedSentence === "") {
    return createEmptyScore(normalizedQuote, normalizedSentence);
  }

  if (quoteRaw === sentenceRaw) {
    return {
      exactNormalized: true,
      exactRaw: true,
      exactSubstring: true,
      matchEnd: normalizedSentence.length,
      matchStart: 0,
      normalizedQuote,
      normalizedSentence,
      score: EXACT_SCORE,
      strategy: "exact",
    };
  }

  if (normalizedQuote === normalizedSentence) {
    return {
      exactNormalized: true,
      exactRaw: false,
      exactSubstring: true,
      matchEnd: normalizedSentence.length,
      matchStart: 0,
      normalizedQuote,
      normalizedSentence,
      score: NORMALIZED_EXACT_SCORE,
      strategy: "normalized_exact",
    };
  }

  const substringStart = normalizedSentence.indexOf(normalizedQuote);

  if (substringStart !== -1) {
    const coverage =
      normalizedQuote.length / Math.max(1, normalizedSentence.length);

    return {
      exactNormalized: false,
      exactRaw: false,
      exactSubstring: true,
      matchEnd: substringStart + normalizedQuote.length,
      matchStart: substringStart,
      normalizedQuote,
      normalizedSentence,
      score: Math.min(
        0.99,
        SUBSTRING_BASE_SCORE + SUBSTRING_COVERAGE_BONUS * coverage,
      ),
      strategy: "normalized_substring",
    };
  }

  return scoreBestFuzzyWindow(normalizedQuote, normalizedSentence);
}

function scoreBestFuzzyWindow(
  normalizedQuote: string,
  normalizedSentence: string,
): EvidenceQuoteScore {
  const minWindow = Math.max(
    1,
    Math.floor(normalizedQuote.length * FUZZY_MIN_WINDOW_RATIO),
  );
  const maxWindow = Math.min(
    normalizedSentence.length,
    Math.max(
      minWindow,
      Math.ceil(normalizedQuote.length * FUZZY_MAX_WINDOW_RATIO),
    ),
  );
  let best: EvidenceQuoteScore = createEmptyScore(
    normalizedQuote,
    normalizedSentence,
  );

  for (let windowSize = minWindow; windowSize <= maxWindow; windowSize += 1) {
    for (
      let start = 0;
      start <= normalizedSentence.length - windowSize;
      start += 1
    ) {
      const window = normalizedSentence.slice(start, start + windowSize);
      const score = scoreWindow(normalizedQuote, window);

      if (score <= best.score) {
        continue;
      }

      best = {
        exactNormalized: false,
        exactRaw: false,
        exactSubstring: false,
        matchEnd: start + windowSize,
        matchStart: start,
        normalizedQuote,
        normalizedSentence,
        score,
        strategy: "fuzzy_window",
      };
    }
  }

  return best;
}

function scoreWindow(quote: string, window: string): number {
  const editScore = levenshteinSimilarity(quote, window);
  const substringScore = longestCommonSubstringScore(quote, window);
  const subsequenceScore = longestCommonSubsequenceScore(quote, window);
  const orderedCoverageScore = orderedCoverage(quote, window);
  const ngramScore = charNgramScore(quote, window);
  const lengthScore = lengthSimilarity(quote, window);
  const unorderedScore = unorderedCharOverlapScore(quote, window);
  const orderedScore = Math.max(
    editScore,
    substringScore,
    subsequenceScore,
    orderedCoverageScore,
  );
  let score =
    0.2 * editScore +
    0.18 * substringScore +
    0.24 * subsequenceScore +
    0.2 * orderedCoverageScore +
    0.08 * ngramScore +
    0.05 * lengthScore +
    0.05 * unorderedScore;

  if (
    unorderedScore >= UNORDERED_PENALTY_THRESHOLD &&
    orderedScore < LOW_ORDERED_PENALTY_THRESHOLD
  ) {
    score *= 0.65;
  }

  return Math.max(0, Math.min(1, score));
}

function normalizeScalar(char: string): string {
  return CASE_FOLDING_OVERRIDES.get(char) ?? char.toLocaleLowerCase("und");
}

function caseFold(text: string): string {
  let folded = "";

  for (const char of text) {
    folded += normalizeScalar(char);
  }

  return folded;
}

function replaceSeparatorsWithSpace(text: string): string {
  let output = "";

  for (const char of text) {
    output += isPreservedSymbol(char) || !isSeparator(char) ? char : " ";
  }

  return output;
}

function isPreservedSymbol(char: string): boolean {
  return char === "+" || char === "#" || char === "&";
}

function isSeparator(char: string): boolean {
  return (
    /\s/u.test(char) ||
    /\p{Separator}/u.test(char) ||
    /[\p{Dash_Punctuation}\p{Connector_Punctuation}\p{Initial_Punctuation}\p{Final_Punctuation}\p{Open_Punctuation}\p{Close_Punctuation}\p{Other_Punctuation}]/u.test(
      char,
    ) ||
    /[\\/.。．｡、，,：:；;！!？?·・•|]/u.test(char)
  );
}

function stripMarkup(text: string): string {
  return text.replace(/<\/?(?:mention|quote)\b[^>]*>/giu, "");
}

function createEmptyScore(
  normalizedQuote: string,
  normalizedSentence: string,
): EvidenceQuoteScore {
  return {
    exactNormalized: false,
    exactRaw: false,
    exactSubstring: false,
    matchEnd: -1,
    matchStart: -1,
    normalizedQuote,
    normalizedSentence,
    score: 0,
    strategy: "empty",
  };
}

function charNgramScore(left: string, right: string): number {
  const bigramScore = diceCoefficient(
    charNgrams(left, 2),
    charNgrams(right, 2),
  );
  const trigramScore = diceCoefficient(
    charNgrams(left, 3),
    charNgrams(right, 3),
  );

  return (bigramScore + trigramScore) / 2;
}

function charNgrams(text: string, size: number): ReadonlySet<string> {
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

function lengthSimilarity(left: string, right: string): number {
  return (
    1 -
    Math.abs(left.length - right.length) / Math.max(left.length, right.length)
  );
}

function levenshteinSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  if (left === "" || right === "") {
    return 0;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1).fill(0);
  const leftChars = [...left];
  const rightChars = [...right];

  for (const [leftIndex, leftChar] of leftChars.entries()) {
    current[0] = leftIndex + 1;

    for (const [rightIndex, rightChar] of rightChars.entries()) {
      const insertCost = (current[rightIndex] ?? 0) + 1;
      const deleteCost = (previous[rightIndex + 1] ?? 0) + 1;
      const replaceCost =
        (previous[rightIndex] ?? 0) + (leftChar === rightChar ? 0 : 1);

      current[rightIndex + 1] = Math.min(insertCost, deleteCost, replaceCost);
    }

    [previous, current] = [current, previous];
  }

  const distance =
    previous[rightChars.length] ?? Math.max(left.length, right.length);

  return 1 - distance / Math.max(left.length, right.length);
}

function longestCommonSubstringScore(left: string, right: string): number {
  if (left === "" || right === "") {
    return 0;
  }

  const leftChars = [...left];
  const rightChars = [...right];
  let previous = new Array<number>(rightChars.length + 1).fill(0);
  let current = new Array<number>(rightChars.length + 1).fill(0);
  let longest = 0;

  for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
      current[rightIndex] =
        leftChars[leftIndex - 1] === rightChars[rightIndex - 1]
          ? (previous[rightIndex - 1] ?? 0) + 1
          : 0;
      longest = Math.max(longest, current[rightIndex] ?? 0);
    }

    [previous, current] = [current, previous];
    current.fill(0);
  }

  return (2 * longest) / (leftChars.length + rightChars.length);
}

function longestCommonSubsequenceScore(left: string, right: string): number {
  if (left === "" || right === "") {
    return 0;
  }

  const leftChars = [...left];
  const rightChars = [...right];
  let previous = new Array<number>(rightChars.length + 1).fill(0);
  let current = new Array<number>(rightChars.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
      current[rightIndex] =
        leftChars[leftIndex - 1] === rightChars[rightIndex - 1]
          ? (previous[rightIndex - 1] ?? 0) + 1
          : Math.max(previous[rightIndex] ?? 0, current[rightIndex - 1] ?? 0);
    }

    [previous, current] = [current, previous];
    current.fill(0);
  }

  const longest = previous[rightChars.length] ?? 0;

  return (2 * longest) / (leftChars.length + rightChars.length);
}

function orderedCoverage(left: string, right: string): number {
  if (left === "" || right === "") {
    return 0;
  }

  const leftChars = [...left];
  const rightChars = [...right];
  let previous = new Array<number>(rightChars.length + 1).fill(0);
  let current = new Array<number>(rightChars.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
      current[rightIndex] =
        leftChars[leftIndex - 1] === rightChars[rightIndex - 1]
          ? (previous[rightIndex - 1] ?? 0) + 1
          : Math.max(previous[rightIndex] ?? 0, current[rightIndex - 1] ?? 0);
    }

    [previous, current] = [current, previous];
    current.fill(0);
  }

  return (previous[rightChars.length] ?? 0) / leftChars.length;
}

function unorderedCharOverlapScore(left: string, right: string): number {
  const leftCounts = countChars(left);
  const rightCounts = countChars(right);
  let overlap = 0;
  let total = 0;

  for (const [char, leftCount] of leftCounts) {
    const rightCount = rightCounts.get(char) ?? 0;

    overlap += Math.min(leftCount, rightCount);
    total += leftCount;
  }

  return total === 0 ? 0 : overlap / total;
}

function countChars(text: string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  return counts;
}

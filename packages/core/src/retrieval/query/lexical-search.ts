export interface LexicalQuery {
  readonly phrases: readonly string[];
  readonly terms: readonly string[];
}

export interface LexicalScore {
  readonly matchCount: number;
  readonly matchedTerms: readonly string[];
  readonly missingTerms: readonly string[];
  readonly score: number;
  readonly snippetNeedle: string;
}

const HAN_RE = /\p{Script=Han}/u;
const LATIN_TOKEN_RE = /[\p{Script=Latin}\p{Number}]+/gu;
const PHRASE_WEIGHT = 2;
const TERM_WEIGHT = 1;

export function createLexicalQuery(query: string): LexicalQuery | undefined {
  const normalizedQuery = query.trim();

  if (normalizedQuery === "") {
    return undefined;
  }

  const phraseTerms = splitQueryPhrases(normalizedQuery);
  const characterTerms = [...normalizedQuery]
    .filter((character) => HAN_RE.test(character))
    .map((character) => character.toLowerCase());
  const latinTerms = normalizeLatinTokens(normalizedQuery);
  const terms = dedupeStrings([
    ...phraseTerms,
    ...latinTerms,
    ...characterTerms,
  ]);

  if (terms.length === 0) {
    return undefined;
  }

  return {
    phrases: phraseTerms,
    terms,
  };
}

export function listLexicalQueryCandidateTerms(
  query: string,
): readonly string[] {
  const normalizedQuery = query.trim();

  return dedupeStrings([
    ...splitQueryPhrases(normalizedQuery),
    ...normalizeLatinTokens(normalizedQuery),
    ...[...normalizedQuery]
      .filter((character) => HAN_RE.test(character))
      .map((character) => character.toLowerCase()),
  ]);
}

export function scoreLexicalText(
  value: string,
  query: LexicalQuery,
): LexicalScore | undefined {
  const normalizedText = value.toLowerCase();
  const matchedTerms: string[] = [];
  const missingTerms: string[] = [];
  let score = 0;

  for (const phrase of query.phrases) {
    const normalizedPhrase = phrase.toLowerCase();

    if (normalizedText.includes(normalizedPhrase)) {
      matchedTerms.push(phrase);
      score +=
        PHRASE_WEIGHT + countOccurrences(normalizedText, normalizedPhrase);
    } else if (!missingTerms.includes(phrase)) {
      missingTerms.push(phrase);
    }
  }

  const latinTokens = new Set(normalizeLatinTokens(value));

  for (const term of query.terms) {
    if (matchedTerms.includes(term)) {
      continue;
    }

    const isHan = [...term].every((character) => HAN_RE.test(character));
    const matched = isHan
      ? normalizedText.includes(term)
      : latinTokens.has(term.toLowerCase());

    if (matched) {
      matchedTerms.push(term);
      score += TERM_WEIGHT;
    } else if (!missingTerms.includes(term)) {
      missingTerms.push(term);
    }
  }

  if (matchedTerms.length === 0 || score <= 0) {
    return undefined;
  }

  score += calculateCoverageBonus(matchedTerms, query);
  score += calculateProximityBonus(normalizedText, matchedTerms);

  return {
    matchCount: matchedTerms.length,
    matchedTerms: dedupeStrings(matchedTerms),
    missingTerms: dedupeStrings(missingTerms).filter(
      (term) => !matchedTerms.includes(term),
    ),
    score,
    snippetNeedle: selectSnippetNeedle(matchedTerms),
  };
}

export function createMentionLexicalHits<
  T extends { readonly surface: string },
>(
  mentions: readonly T[],
  query: LexicalQuery,
): readonly {
  readonly match: LexicalScore;
  readonly mention: T;
}[] {
  return mentions
    .map((mention) => {
      const match = scoreLexicalText(mention.surface, query);

      return match === undefined ? undefined : { match, mention };
    })
    .filter(isDefined);
}

function splitQueryPhrases(query: string): readonly string[] {
  return dedupeStrings(
    query
      .split(/\s+/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 1),
  );
}

function normalizeLatinTokens(value: string): readonly string[] {
  return [...value.toLowerCase().matchAll(LATIN_TOKEN_RE)].map(
    (match) => match[0],
  );
}

function countOccurrences(value: string, needle: string): number {
  if (needle === "") {
    return 0;
  }

  let count = 0;
  let index = value.indexOf(needle);

  while (index >= 0) {
    count += 1;
    index = value.indexOf(needle, index + needle.length);
  }

  return count;
}

function calculateCoverageBonus(
  matchedTerms: readonly string[],
  query: LexicalQuery,
): number {
  const total = query.terms.length;

  if (total === 0) {
    return 0;
  }

  return matchedTerms.length / total;
}

function calculateProximityBonus(
  normalizedText: string,
  matchedTerms: readonly string[],
): number {
  const positions = matchedTerms
    .map((term) => normalizedText.indexOf(term.toLowerCase()))
    .filter((position) => position >= 0)
    .sort((left, right) => left - right);

  if (positions.length < 2) {
    return 0;
  }

  const span = positions.at(-1)! - positions[0]!;

  return span <= 80 ? 1 : span <= 240 ? 0.5 : 0;
}

function selectSnippetNeedle(matchedTerms: readonly string[]): string {
  return [...matchedTerms].sort(
    (left, right) => right.length - left.length,
  )[0]!;
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value !== ""))];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

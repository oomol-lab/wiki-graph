import type { MentionRecord } from "../document/index.js";

export interface LexicalQuery {
  readonly entityTerms: readonly LexicalEntityTerm[];
  readonly phrases: readonly string[];
  readonly terms: readonly string[];
}

export interface LexicalEntityTerm {
  readonly qid: string;
  readonly surface: string;
  readonly weight: number;
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
const ENTITY_TERM_WEIGHT = 3;
const PHRASE_WEIGHT = 2;
const TERM_WEIGHT = 1;

export function createLexicalQuery(
  query: string,
  mentions: readonly MentionRecord[] = [],
): LexicalQuery | undefined {
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
  const entityTerms = dedupeEntityTerms(
    mentions
      .filter((mention) => normalizedQuery.includes(mention.surface))
      .map((mention) => ({
        qid: mention.qid,
        surface: mention.surface,
        weight: ENTITY_TERM_WEIGHT,
      })),
  );

  if (terms.length === 0 && entityTerms.length === 0) {
    return undefined;
  }

  return {
    entityTerms,
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
  options: {
    readonly mentionQids?: readonly string[];
    readonly mentionSurfaces?: readonly string[];
  } = {},
): LexicalScore | undefined {
  const normalizedText = value.toLowerCase();
  const matchedTerms: string[] = [];
  const missingTerms: string[] = [];
  let score = 0;

  for (const entity of query.entityTerms) {
    const surfaceMatched =
      normalizedText.includes(entity.surface.toLowerCase()) ||
      options.mentionSurfaces?.includes(entity.surface) === true;
    const qidMatched = options.mentionQids?.includes(entity.qid) === true;

    if (surfaceMatched || qidMatched) {
      matchedTerms.push(entity.surface);
      score += qidMatched ? entity.weight * 1.5 : entity.weight;
    } else {
      missingTerms.push(entity.surface);
    }
  }

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

export function createMentionLexicalHits(
  mentions: readonly MentionRecord[],
  query: LexicalQuery,
): readonly {
  readonly match: LexicalScore;
  readonly mention: MentionRecord;
}[] {
  return mentions
    .map((mention) => {
      const match = scoreLexicalText(mention.surface, query, {
        mentionQids: [mention.qid],
        mentionSurfaces: [mention.surface],
      });

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
  const total = query.terms.length + query.entityTerms.length;

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

function dedupeEntityTerms(
  values: readonly LexicalEntityTerm[],
): readonly LexicalEntityTerm[] {
  const seen = new Set<string>();
  const terms: LexicalEntityTerm[] = [];

  for (const value of values) {
    const key = `${value.qid}:${value.surface}`;

    if (!seen.has(key)) {
      seen.add(key);
      terms.push(value);
    }
  }

  return terms;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

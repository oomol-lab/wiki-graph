import { createHash } from "crypto";

export interface SearchToken {
  readonly encoded: string;
  readonly raw: string;
  readonly tier: 1 | 2 | 3;
}

export interface SearchTokenPlan {
  readonly tier1: readonly SearchToken[];
  readonly tier2: readonly SearchToken[];
  readonly tier3: readonly SearchToken[];
}

const HAN_RUN_RE = /\p{Script=Han}+/gu;
const LATIN_OR_NUMBER_RE = /[\p{Script=Latin}\p{Number}]+/gu;
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/gu;
const CONTROL_RE = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RE = /\s+/gu;
const HAN_RE = /^\p{Script=Han}+$/u;
const ASCII_ALNUM_RE = /^[a-z0-9]+$/u;

const CHINESE_STOPWORDS = new Set([
  "的",
  "地",
  "得",
  "了",
  "着",
  "过",
  "和",
  "与",
  "及",
  "或",
  "而",
  "在",
  "是",
  "为",
  "以",
  "于",
  "对",
  "中",
  "上",
  "下",
  "等",
]);

const ENGLISH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "is",
  "may",
  "might",
  "of",
  "on",
  "or",
  "should",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
  "would",
]);

const IRREGULAR_LEMMAS = new Map([
  ["am", "be"],
  ["are", "be"],
  ["is", "be"],
  ["was", "be"],
  ["were", "be"],
  ["been", "be"],
  ["being", "be"],
  ["has", "have"],
  ["had", "have"],
  ["does", "do"],
  ["did", "do"],
  ["done", "do"],
]);

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(CONTROL_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

export function createSearchTokenPlan(value: string): SearchTokenPlan {
  const normalized = normalizeSearchText(value);
  const tier1: SearchToken[] = [];
  const tier2: SearchToken[] = [];
  const tier3: SearchToken[] = [];

  for (const raw of createHanTokens(normalized, "phrase")) {
    tier1.push(createToken(raw, "hp", 1));
  }
  for (const raw of createHanTokens(normalized, "bigram")) {
    tier1.push(createToken(raw, "h2", 1));
  }
  for (const raw of createHanTokens(normalized, "trigram")) {
    tier1.push(createToken(raw, "h3", 1));
  }
  for (const raw of createSegmenterTokens(normalized)) {
    tier1.push(createToken(raw, "hw", 1));
  }
  for (const raw of createLatinTokens(normalized)) {
    tier1.push(createToken(raw, "le", 1));
    const stem = stemEnglish(raw);

    if (stem !== raw && !ENGLISH_STOPWORDS.has(stem)) {
      tier2.push(createToken(stem, "ls", 2));
    }
  }
  for (const raw of createHanTokens(normalized, "char")) {
    tier3.push(createToken(raw, "hc", 3));
  }

  return {
    tier1: dedupeTokens(tier1),
    tier2: dedupeTokens(tier2),
    tier3: dedupeTokens(tier3),
  };
}

export function listSearchPlanTerms(plan: SearchTokenPlan): readonly string[] {
  return [
    ...new Set(
      [...plan.tier1, ...plan.tier2, ...plan.tier3].map((token) => token.raw),
    ),
  ];
}

export function hasSearchTokens(plan: SearchTokenPlan): boolean {
  return (
    plan.tier1.length > 0 || plan.tier2.length > 0 || plan.tier3.length > 0
  );
}

function createHanTokens(
  value: string,
  kind: "bigram" | "char" | "phrase" | "trigram",
): readonly string[] {
  const tokens: string[] = [];

  for (const match of value.matchAll(HAN_RUN_RE)) {
    const run = [...match[0]];

    if (kind === "phrase") {
      if (run.length >= 2) {
        tokens.push(run.join(""));
      }
      continue;
    }
    if (kind === "char") {
      tokens.push(...run.filter((token) => !CHINESE_STOPWORDS.has(token)));
      continue;
    }

    const size = kind === "bigram" ? 2 : 3;

    if (run.length < size) {
      continue;
    }
    for (let index = 0; index <= run.length - size; index += 1) {
      tokens.push(run.slice(index, index + size).join(""));
    }
  }

  return tokens;
}

function createLatinTokens(value: string): readonly string[] {
  return [...value.toLowerCase().matchAll(LATIN_OR_NUMBER_RE)]
    .map((match) => match[0])
    .filter((token) => !ENGLISH_STOPWORDS.has(token));
}

function createSegmenterTokens(value: string): readonly string[] {
  if (typeof Intl.Segmenter !== "function") {
    return [];
  }

  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const tokens: string[] = [];

  for (const segment of segmenter.segment(value)) {
    const token = normalizeSearchText(segment.segment).toLowerCase();

    if (
      segment.isWordLike === true &&
      [...token].length >= 2 &&
      HAN_RE.test(token)
    ) {
      tokens.push(token);
    }
  }

  return tokens;
}

function createToken(
  raw: string,
  prefix: string,
  tier: 1 | 2 | 3,
): SearchToken {
  const normalized = normalizeSearchText(raw).toLowerCase();
  const digest = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 20);

  return {
    encoded: `${prefix}${digest}`,
    raw: normalized,
    tier,
  };
}

function dedupeTokens(tokens: readonly SearchToken[]): readonly SearchToken[] {
  const seen = new Set<string>();
  const result: SearchToken[] = [];

  for (const token of tokens) {
    if (seen.has(token.encoded)) {
      continue;
    }

    seen.add(token.encoded);
    result.push(token);
  }

  return result;
}

function stemEnglish(token: string): string {
  const lemma = IRREGULAR_LEMMAS.get(token);

  if (lemma !== undefined) {
    return lemma;
  }
  if (!ASCII_ALNUM_RE.test(token) || /\d/u.test(token) || token.length < 4) {
    return token;
  }

  return porterStem(token);
}

function porterStem(value: string): string {
  // A deliberately small Porter-like stemmer: enough for weak recall tokens,
  // not intended to replace exact Latin tokens or final ranking.
  let token = value;

  if (token.endsWith("ies") && token.length > 4) {
    token = `${token.slice(0, -3)}y`;
  } else if (token.endsWith("ing") && token.length > 5) {
    token = token.slice(0, -3);
  } else if (token.endsWith("ed") && token.length > 4) {
    token = token.slice(0, -2);
  } else if (token.endsWith("es") && token.length > 4) {
    token = token.slice(0, -2);
  } else if (token.endsWith("s") && token.length > 4) {
    token = token.slice(0, -1);
  }

  if (
    token.length > 3 &&
    token.at(-1) === token.at(-2) &&
    /[bcdfghjklmnpqrstvwxyz]/u.test(token.at(-1)!)
  ) {
    token = token.slice(0, -1);
  }

  return token;
}

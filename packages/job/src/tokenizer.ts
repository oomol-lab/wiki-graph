import { sha256 } from "@noble/hashes/sha2.js";

export interface JobSearchToken {
  readonly encoded: string;
  readonly raw: string;
  readonly tier: 1 | 2 | 3;
}

export interface JobSearchTokenPlan {
  readonly tier1: readonly JobSearchToken[];
  readonly tier2: readonly JobSearchToken[];
  readonly tier3: readonly JobSearchToken[];
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

export function normalizeJobSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(CONTROL_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

export function createJobSearchTokenPlan(value: string): JobSearchTokenPlan {
  const normalized = normalizeJobSearchText(value);
  const tier1: JobSearchToken[] = [];
  const tier2: JobSearchToken[] = [];
  const tier3: JobSearchToken[] = [];

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

function createHanTokens(
  value: string,
  kind: "bigram" | "char" | "phrase" | "trigram",
): readonly string[] {
  const tokens: string[] = [];
  for (const match of value.matchAll(HAN_RUN_RE)) {
    const run = [...match[0]];
    if (kind === "phrase") {
      if (run.length >= 2) tokens.push(run.join(""));
      continue;
    }
    if (kind === "char") {
      tokens.push(...run.filter((token) => !CHINESE_STOPWORDS.has(token)));
      continue;
    }
    const size = kind === "bigram" ? 2 : 3;
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
  if (typeof Intl.Segmenter !== "function") return [];
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const tokens: string[] = [];
  for (const segment of segmenter.segment(value)) {
    const token = normalizeJobSearchText(segment.segment).toLowerCase();
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
): JobSearchToken {
  const normalized = normalizeJobSearchText(raw).toLowerCase();
  const digest = bytesToHex(sha256(new TextEncoder().encode(normalized))).slice(
    0,
    20,
  );
  return { encoded: `${prefix}${digest}`, raw: normalized, tier };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function dedupeTokens(
  tokens: readonly JobSearchToken[],
): readonly JobSearchToken[] {
  const seen = new Set<string>();
  return tokens.filter((token) => {
    if (seen.has(token.encoded)) return false;
    seen.add(token.encoded);
    return true;
  });
}

function stemEnglish(token: string): string {
  const lemma = IRREGULAR_LEMMAS.get(token);
  if (lemma !== undefined) return lemma;
  if (!ASCII_ALNUM_RE.test(token) || /\d/u.test(token) || token.length < 4) {
    return token;
  }
  let stem = token;
  if (stem.endsWith("ies") && stem.length > 4) {
    stem = `${stem.slice(0, -3)}y`;
  } else if (stem.endsWith("ing") && stem.length > 5) {
    stem = stem.slice(0, -3);
  } else if (stem.endsWith("ed") && stem.length > 4) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith("es") && stem.length > 4) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith("s") && stem.length > 4) {
    stem = stem.slice(0, -1);
  }
  if (
    stem.length > 3 &&
    stem.at(-1) === stem.at(-2) &&
    /[bcdfghjklmnpqrstvwxyz]/u.test(stem.at(-1)!)
  ) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

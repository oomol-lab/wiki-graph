import type { LLMessage } from "../llm/index.js";

export type GuaranteedResponseIntent =
  | "ambiguous"
  | "malformed_json"
  | "natural_language";

const NATURAL_LANGUAGE_PATTERNS = [
  /\b(?:sorry|apologies)\b/i,
  /\b(?:i\s+can(?:not|'t)|unable\s+to|do\s+not\s+understand)\b/i,
  /\b(?:cannot\s+answer|can't\s+answer|can't\s+help)\b/i,
  /\bno\s+relevant\s+result/i,
  /抱歉/,
  /无法回答/,
  /无法识别/,
  /无法给到/,
  /没有找到相关的结果/,
];

export function buildResponseIntentClassificationMessages(
  response: string,
): readonly LLMessage[] {
  return [
    {
      role: "system",
      content: [
        "Classify the raw assistant reply into exactly one label.",
        "",
        "Labels:",
        "- malformed_json: the reply is trying to provide JSON, but it is broken or truncated",
        "- natural_language: the reply is plain conversational language, apology, refusal, or explanation instead of JSON",
        "- ambiguous: unclear or mixed",
        "",
        "Reply with the label only.",
      ].join("\n"),
    },
    {
      role: "user",
      content: response,
    },
  ];
}

export function classifyResponseIntentLocally(
  response: string,
): GuaranteedResponseIntent {
  const trimmed = response.trim();

  if (trimmed === "") {
    return "ambiguous";
  }

  if (hasStrongMalformedJsonSignal(trimmed)) {
    return "malformed_json";
  }

  if (looksLikeNaturalLanguage(trimmed)) {
    return "natural_language";
  }

  if (hasWeakMalformedJsonSignal(trimmed)) {
    return "ambiguous";
  }

  if (looksLikePlainSentence(trimmed)) {
    return "natural_language";
  }

  return "ambiguous";
}

export function parseResponseIntentClassification(
  response: string,
): GuaranteedResponseIntent {
  const normalized = response.trim().toLowerCase();

  if (normalized.includes("malformed_json")) {
    return "malformed_json";
  }

  if (normalized.includes("natural_language")) {
    return "natural_language";
  }

  if (normalized.includes("ambiguous")) {
    return "ambiguous";
  }

  return "ambiguous";
}

function hasStrongMalformedJsonSignal(text: string): boolean {
  return (
    /^(?:```json\b|```|\{|\[)/i.test(text) ||
    /"[^"\r\n]+"\s*:/.test(text) ||
    (hasWeakMalformedJsonSignal(text) && endsWithLikelyTruncationToken(text))
  );
}

function hasWeakMalformedJsonSignal(text: string): boolean {
  const punctuationCount =
    (text.match(/[\{\}\[\]:,]/g) ?? []).length +
    (text.match(/"/g) ?? []).length;

  return (
    /:\s/.test(text) ||
    punctuationCount >= 3 ||
    hasUnbalancedBrackets(text) ||
    /[:,]\s*$/.test(text)
  );
}

function hasUnbalancedBrackets(text: string): boolean {
  return count(text, "{") !== count(text, "}") ||
    count(text, "[") !== count(text, "]")
    ? true
    : false;
}

function endsWithLikelyTruncationToken(text: string): boolean {
  return /[:,"{\[]\s*$/.test(text);
}

function looksLikeNaturalLanguage(text: string): boolean {
  if (NATURAL_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return !hasWeakMalformedJsonSignal(text) && looksLikePlainSentence(text);
}

function looksLikePlainSentence(text: string): boolean {
  return (
    /[\p{Script=Han}A-Za-z]/u.test(text) &&
    !/^[\[{]/.test(text) &&
    !/"[^"\r\n]+"\s*:/.test(text)
  );
}

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

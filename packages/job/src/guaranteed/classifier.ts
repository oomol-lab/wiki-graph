import type { JobLlmMessage } from "../ports.js";

export const RESPONSE_INTENT_CLASSIFIER_PROMPT = [
  "Classify the raw assistant reply into exactly one label.",
  "Labels:",
  "- malformed_json: the reply is trying to provide JSON, but it is broken or truncated",
  "- natural_language: the reply is plain conversational language, apology, refusal, or explanation instead of JSON",
  "- ambiguous: unclear or mixed",
  "Reply with the label only.",
].join("\n");
export const RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE =
  "guaranteed/response_intent_classifier";

export type GuaranteedResponseIntent =
  | "ambiguous"
  | "malformed_json"
  | "natural_language";

const NATURAL_LANGUAGE_PATTERNS = [
  /\b(?:sorry|apologies)\b/iu,
  /\b(?:i\s+can(?:not|'t)|unable\s+to|do\s+not\s+understand)\b/iu,
  /\b(?:cannot\s+answer|can't\s+answer|can't\s+help)\b/iu,
  /\bno\s+relevant\s+result/iu,
  /抱歉/u,
  /无法回答/u,
  /无法识别/u,
  /无法给到/u,
  /没有找到相关的结果/u,
];

export function buildResponseIntentClassificationMessages(
  systemPrompt: string,
  response: string,
): readonly JobLlmMessage[] {
  return [
    { content: systemPrompt, role: "system" },
    { content: response, role: "user" },
  ];
}

export function classifyResponseIntentLocally(
  response: string,
): GuaranteedResponseIntent {
  const trimmed = response.trim();
  if (trimmed === "") return "ambiguous";
  if (hasStrongMalformedJsonSignal(trimmed)) return "malformed_json";
  if (looksLikeNaturalLanguage(trimmed)) return "natural_language";
  if (hasWeakMalformedJsonSignal(trimmed)) return "ambiguous";
  if (looksLikePlainSentence(trimmed)) return "natural_language";
  return "ambiguous";
}

export function parseResponseIntentClassification(
  response: string,
): GuaranteedResponseIntent {
  const normalized = response.trim().toLowerCase();
  if (normalized.includes("malformed_json")) return "malformed_json";
  if (normalized.includes("natural_language")) return "natural_language";
  return "ambiguous";
}

function hasStrongMalformedJsonSignal(text: string): boolean {
  return (
    /^(?:```json\b|```|\{|\[)/iu.test(text) ||
    /"[^"\r\n]+"\s*:/u.test(text) ||
    (hasWeakMalformedJsonSignal(text) && endsWithLikelyTruncationToken(text))
  );
}

function hasWeakMalformedJsonSignal(text: string): boolean {
  const punctuationCount =
    (text.match(/[{}[\]:,]/gu) ?? []).length + (text.match(/"/gu) ?? []).length;
  return (
    /:\s/u.test(text) ||
    punctuationCount >= 3 ||
    hasUnbalancedBrackets(text) ||
    /[:,]\s*$/u.test(text)
  );
}

function hasUnbalancedBrackets(text: string): boolean {
  return count(text, "{") !== count(text, "}") ||
    count(text, "[") !== count(text, "]")
    ? true
    : false;
}

function endsWithLikelyTruncationToken(text: string): boolean {
  return /[:, "{[]\s*$/u.test(text);
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
    !/^[{[]/u.test(text) &&
    !/"[^"\r\n]+"\s*:/u.test(text)
  );
}

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

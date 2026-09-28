import { detect, validateISO2 } from "tinyld";

import type { Language } from "../model.js";

export function needsTranslation(input: {
  content: string;
  label: string;
  targetLanguage: Language;
}): boolean {
  const targetLanguageCode = normalizeLanguageCode(input.targetLanguage);

  if (targetLanguageCode === undefined) return false;

  return (
    fieldNeedsTranslation(input.label, targetLanguageCode) ||
    fieldNeedsTranslation(input.content, targetLanguageCode)
  );
}

function fieldNeedsTranslation(
  text: string,
  targetLanguageCode: string,
): boolean {
  if (text.trim() === "") {
    return false;
  }

  const detectedLanguageCode = detectLanguageCode(text);

  if (detectedLanguageCode === undefined) {
    return true;
  }

  return detectedLanguageCode !== targetLanguageCode;
}

function detectLanguageCode(text: string): string | undefined {
  try {
    return normalizeLanguageCode(detect(text.trim()));
  } catch {
    return undefined;
  }
}

function normalizeLanguageCode(value: string): string | undefined {
  const aliases: Readonly<Record<string, string>> = {
    chinese: "zh",
    english: "en",
    "simplified chinese": "zh",
    "traditional chinese": "zh",
  };
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  const alias = aliases[normalized];
  if (alias !== undefined) return alias;
  const direct = validateISO2(normalized);
  if (direct !== "") return direct;
  const base = normalized.split("-")[0];
  if (base === undefined) return undefined;
  const validated = validateISO2(base);
  return validated === "" ? undefined : validated;
}

import { detect, validateISO2 } from "tinyld";

import type { Language } from "../../reading/model.js";
import { ReviewSeverity, type ReviewResult } from "./types.js";

export interface LanguageReview {
  readonly detectedLanguageCode: string;
  readonly review: ReviewResult;
  readonly targetLanguageCode: string;
}

export function checkOutputLanguage(input: {
  readonly compressedText: string;
  readonly userLanguage?: Language;
}): LanguageReview | undefined {
  if (input.userLanguage === undefined) return undefined;
  const targetLanguageCode = normalizeLanguageCode(input.userLanguage);
  const detectedLanguageCode = detectLanguageCode(input.compressedText);
  if (
    targetLanguageCode === undefined ||
    detectedLanguageCode === undefined ||
    detectedLanguageCode === targetLanguageCode
  ) {
    return undefined;
  }
  return {
    detectedLanguageCode,
    review: {
      clueId: -1,
      issues: [
        {
          problem: `Output language error: detected ${detectedLanguageCode}, but ${targetLanguageCode} (${input.userLanguage}) is required.`,
          severity: ReviewSeverity.Critical,
          suggestion: `Please translate the entire compressed text to ${input.userLanguage}. Maintain all information integrity and ensure the translation sounds natural and native, not machine-translated.`,
        },
      ],
      weight: 1,
    },
    targetLanguageCode,
  };
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

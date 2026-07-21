import {
  detectLanguageCode,
  getLanguageDetectionCode,
} from "../../runtime/common/tinyld-language.js";
import { type Language } from "../../runtime/common/language.js";
import { ReviewSeverity, type ReviewResult } from "./types.js";

export interface LanguageReview {
  readonly detectedLanguageCode: string;
  readonly review: ReviewResult;
  readonly targetLanguageCode: string;
}

export function checkOutputLanguage(input: {
  compressedText: string;
  userLanguage?: Language;
}): LanguageReview | undefined {
  if (input.userLanguage === undefined) {
    return undefined;
  }

  const targetLanguageCode = getLanguageDetectionCode(input.userLanguage);

  const detectedLanguageCode = detectLanguageCode(input.compressedText);

  if (
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

import { detect, validateISO2 } from "tinyld";

import { getLanguageCode, type Language } from "./language.js";

export function detectLanguageCode(text: string): string | undefined {
  const normalizedText = text.trim();

  if (normalizedText === "") {
    return undefined;
  }

  try {
    return normalizeLanguageCode(detect(normalizedText));
  } catch {
    return undefined;
  }
}

export function getLanguageDetectionCode(language: Language): string {
  return getLanguageCode(language);
}

function normalizeLanguageCode(languageCode: string): string | undefined {
  const normalizedLanguageCode = languageCode.trim().toLowerCase();
  const directLanguageCode = validateISO2(normalizedLanguageCode);

  if (directLanguageCode !== "") {
    return directLanguageCode;
  }

  const baseLanguageCode = normalizedLanguageCode.split("-")[0];

  if (baseLanguageCode === undefined) {
    return undefined;
  }

  const validatedBaseLanguageCode = validateISO2(baseLanguageCode);

  return validatedBaseLanguageCode === ""
    ? undefined
    : validatedBaseLanguageCode;
}

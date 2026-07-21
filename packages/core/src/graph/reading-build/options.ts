import { normalizeLanguageCode } from "../../runtime/common/language.js";
import { resolveExtractionPrompt } from "../../runtime/common/prompts.js";
import type { BuildSerialTopologyOptions } from "../../serial.js";
import type { GraphBuildParameterInput } from "./types.js";

export function createTopologyOptions(options: {
  readonly extractionPrompt?: string;
  readonly userLanguage?: BuildSerialTopologyOptions["userLanguage"];
}): BuildSerialTopologyOptions {
  return {
    extractionPrompt: resolveExtractionPrompt(options.extractionPrompt),
    ...(options.userLanguage === undefined
      ? {}
      : { userLanguage: options.userLanguage }),
  };
}

export function createGraphBuildParameterInput(options: {
  readonly extractionPrompt?: string;
  readonly userLanguage?: BuildSerialTopologyOptions["userLanguage"];
}): GraphBuildParameterInput {
  const language = normalizeLanguageCode(options.userLanguage);

  return {
    ...(language === undefined ? {} : { language }),
    prompt: resolveExtractionPrompt(options.extractionPrompt),
  };
}

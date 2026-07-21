import {
  LanguageCode,
  normalizeLanguageCode,
} from "../../runtime/common/language.js";
import type {
  GenerateChapterKnowledgeGraphArtifactOptions,
  GraphBuildParameterInput,
} from "./types.js";

export function createKnowledgeGraphParameterInput(
  options: Pick<
    GenerateChapterKnowledgeGraphArtifactOptions,
    "policyPrompt" | "resolverOptions"
  > & { readonly policyPrompt: string },
): GraphBuildParameterInput {
  return {
    language:
      normalizeLanguageCode(options.resolverOptions?.language) ??
      LanguageCode.Chinese,
    prompt: options.policyPrompt,
  };
}

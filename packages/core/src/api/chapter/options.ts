import type { Language } from "../../runtime/common/language.js";
import type { WikiGraphScope } from "../../runtime/common/llm-scope.js";
import type { LLM } from "../../external/llm/index.js";
import type {
  BuildSerialTopologyOptions,
  SerialProgressSink,
} from "../../serial.js";
import { resolveExtractionPrompt } from "../../runtime/common/prompts.js";

export interface GenerateChapterGraphOptions {
  readonly extractionPrompt?: string;
  readonly llm: LLM<WikiGraphScope>;
  readonly logDirPath?: string;
  readonly progressTracker?: SerialProgressSink;
  readonly userLanguage?: Language;
}

export interface GenerateChapterSummaryOptions {
  readonly llm: LLM<WikiGraphScope>;
  readonly logDirPath?: string;
  readonly userLanguage?: Language;
}

export function createTopologyOptions(
  options: GenerateChapterGraphOptions,
): BuildSerialTopologyOptions {
  return {
    extractionPrompt: resolveExtractionPrompt(options.extractionPrompt),
    ...(options.userLanguage === undefined
      ? {}
      : { userLanguage: options.userLanguage }),
  };
}

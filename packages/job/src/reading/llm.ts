import type { JobLlm } from "../ports.js";
import type { JobProgressSink } from "../ports.js";
import {
  BOOK_COHERENCE_PROMPT,
  CLUE_REVIEWER_GENERATOR_PROMPT,
  CLUE_REVIEWER_PROMPT,
  EVIDENCE_CHOICE_PROMPT,
  REVISION_FEEDBACK_PROMPT,
  TEXT_COMPRESSOR_PROMPT,
  TRANSLATE_CHUNKS_PROMPT,
  USER_FOCUSED_PROMPT,
} from "../prompt-assets.js";
import { RESPONSE_INTENT_CLASSIFIER_PROMPT } from "../guaranteed/index.js";
import { JOB_LLM_SCOPES } from "../sampling.js";
import { renderJobPrompt } from "../template.js";
import type { ReadingLlm } from "./model.js";

const PROMPTS: Readonly<Record<string, string>> = {
  "guaranteed/response_intent_classifier": RESPONSE_INTENT_CLASSIFIER_PROMPT,
  "editor/clue_reviewer": CLUE_REVIEWER_PROMPT,
  "editor/clue_reviewer_generator": CLUE_REVIEWER_GENERATOR_PROMPT,
  "editor/revision_feedback": REVISION_FEEDBACK_PROMPT,
  "editor/text_compressor": TEXT_COMPRESSOR_PROMPT,
  "topologization/book_coherence_extraction": BOOK_COHERENCE_PROMPT,
  "topologization/evidence_choice": EVIDENCE_CHOICE_PROMPT,
  "topologization/translate_chunks": TRANSLATE_CHUNKS_PROMPT,
  "topologization/user_focused_extraction": USER_FOCUSED_PROMPT,
};

export function createReadingLlm(input: {
  readonly llm: JobLlm;
  readonly progress?: JobProgressSink;
  readonly signal?: AbortSignal;
}): ReadingLlm<string> {
  const context: ReadingLlm<string> = {
    loadSystemPrompt(templateName, values = {}) {
      const template = PROMPTS[templateName];
      if (template === undefined) {
        throw new Error(`Unknown Reading Graph prompt ${templateName}.`);
      }
      return renderJobPrompt(template, values);
    },
    async request(messages, options = {}) {
      const response = await input.llm.request(messages, {
        ...(options.retryIndex === undefined
          ? {}
          : { retryIndex: options.retryIndex }),
        ...(options.retryMax === undefined
          ? {}
          : { retryMax: options.retryMax }),
        scope: options.scope ?? JOB_LLM_SCOPES.readingGraphExtraction,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.progress?.addTokenUsage === undefined
          ? {}
          : {
              onTokenUsage: async (usage) =>
                await input.progress?.addTokenUsage?.(usage),
            }),
      });
      await input.progress?.addOutputCharacters?.(response.length);
      return response;
    },
    async withContext(operation) {
      return await operation(context);
    },
  };
  return context;
}

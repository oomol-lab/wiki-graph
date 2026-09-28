import type { ZodType } from "zod";

import {
  requestGuaranteedJson,
  RESPONSE_INTENT_CLASSIFIER_PROMPT,
} from "./guaranteed/index.js";
import type { JobLlm, JobLlmMessage } from "./ports.js";

export async function requestJobJson<T>(options: {
  readonly llm: JobLlm;
  readonly messages: readonly JobLlmMessage[];
  readonly scope: string;
  readonly schema: ZodType<T>;
  readonly signal?: AbortSignal;
}): Promise<T> {
  return await requestGuaranteedJson({
    messages: options.messages,
    parse: (data) => data,
    request: async (messages, retryIndex, retryMax) =>
      await options.llm.request(messages, {
        retryIndex,
        retryMax,
        scope: options.scope,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    responseIntentClassifierPrompt: RESPONSE_INTENT_CLASSIFIER_PROMPT,
    schema: options.schema,
  });
}

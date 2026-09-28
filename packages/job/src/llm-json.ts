import { jsonrepair } from "jsonrepair";
import type { ZodType } from "zod";

import type { JobLlm, JobLlmMessage } from "./ports.js";

export async function requestJobJson<T>(options: {
  readonly llm: JobLlm;
  readonly messages: readonly JobLlmMessage[];
  readonly scope: string;
  readonly schema: ZodType<T>;
  readonly signal?: AbortSignal;
}): Promise<T> {
  let messages = [...options.messages];
  const retryMax = 2;
  for (let retryIndex = 0; retryIndex <= retryMax; retryIndex += 1) {
    const response = await options.llm.request(messages, {
      retryIndex,
      retryMax,
      scope: options.scope,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    try {
      return options.schema.parse(parseJson(response));
    } catch (error) {
      if (retryIndex >= retryMax) throw error;
      messages = [
        ...messages,
        { content: response, role: "assistant" },
        {
          content:
            "The previous response did not match the required JSON schema. Return only one valid JSON value with every required field and no Markdown fence.",
          role: "user",
        },
      ];
    }
  }
  throw new Error("LLM JSON request failed unexpectedly.");
}

function parseJson(response: string): unknown {
  const trimmed = response
    .trim()
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "");
  return JSON.parse(jsonrepair(trimmed));
}

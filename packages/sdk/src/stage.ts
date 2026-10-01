export {
  DEFAULT_EXTRACTION_PROMPT,
  DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT,
  resolveExtractionPrompt,
  resolveKnowledgeGraphRecallPrompt,
} from "wiki-graph-core";
import type { WikiGraphScope } from "wiki-graph-core";
import { createDefaultWikiGraphSampling } from "wiki-graph-core";
import { LLM } from "wiki-graph-core";
import type {
  Directory,
  LLMStreamProgressCallback,
  LLMTokenUsageCallback,
} from "wiki-graph-core";

import {
  loadWikiGraphRuntimeConfig,
  type WikiGraphRuntimeConfig,
} from "./runtime-config.js";
import { buildWikiGraphLLMOptions } from "./llm.js";

export function createStageLLM(
  config: WikiGraphRuntimeConfig,
  options?: {
    readonly cacheDirectory?: Directory;
    readonly logDirectory?: Directory;
    readonly onStreamProgress?: LLMStreamProgressCallback;
    readonly onTokenUsage?: LLMTokenUsageCallback;
  },
): LLM<WikiGraphScope> {
  const llmOptions = buildWikiGraphLLMOptions(config);

  return new LLM<WikiGraphScope>({
    sampling: createDefaultWikiGraphSampling({
      ...(llmOptions.temperature === undefined
        ? {}
        : { temperature: llmOptions.temperature }),
      ...(llmOptions.topP === undefined ? {} : { topP: llmOptions.topP }),
    }),
    ...llmOptions,
    ...(options?.cacheDirectory === undefined
      ? {}
      : { cacheDirectory: options.cacheDirectory }),
    ...(options?.logDirectory === undefined
      ? {}
      : { logDirectory: options.logDirectory }),
    ...(options?.onStreamProgress === undefined
      ? {}
      : { onStreamProgress: options.onStreamProgress }),
    ...(options?.onTokenUsage === undefined
      ? {}
      : { onTokenUsage: options.onTokenUsage }),
  });
}

export async function loadRequiredStageConfig(options: {
  readonly llmJSON?: string;
}): Promise<WikiGraphRuntimeConfig> {
  const config = await loadWikiGraphRuntimeConfig({
    ...(options.llmJSON === undefined ? {} : { llmJSON: options.llmJSON }),
  });

  if (config.llm?.provider === undefined || config.llm.model === undefined) {
    throw new Error(
      "Missing LLM configuration. Set --llm for one run, or configure `wikg://local/config/llm` with provider and model.",
    );
  }

  return config;
}

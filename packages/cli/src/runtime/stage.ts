export {
  DEFAULT_EXTRACTION_PROMPT,
  DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT,
  resolveExtractionPrompt,
  resolveKnowledgeGraphRecallPrompt,
} from "wiki-graph-sdk";
import type { WikiGraphScope } from "wiki-graph-sdk";
import { createDefaultWikiGraphSampling } from "wiki-graph-sdk";
import { LLM } from "wiki-graph-sdk";
import type {
  Directory,
  LLMStreamProgressCallback,
  LLMTokenUsageCallback,
} from "wiki-graph-sdk";

import { loadCLIConfig, type CLIConfig } from "./config.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";
import { buildLLMOptions } from "./llm.js";

export function createStageLLM(
  config: CLIConfig,
  options?: {
    readonly cacheDirectory?: Directory;
    readonly logDirectory?: Directory;
    readonly onStreamProgress?: LLMStreamProgressCallback;
    readonly onTokenUsage?: LLMTokenUsageCallback;
  },
): LLM<WikiGraphScope> {
  const llmOptions = buildLLMOptions(config);

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
}): Promise<CLIConfig> {
  const config = await loadCLIConfig({
    ...(options.llmJSON === undefined ? {} : { llmJSON: options.llmJSON }),
  });

  if (config.llm?.provider === undefined || config.llm.model === undefined) {
    throw new Error(
      withHelpRoute(
        "Missing LLM configuration. Set --llm for one run, or configure `wikg://local/config/llm` with provider and model.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }

  return config;
}

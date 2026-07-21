import { resolveDataDirPath } from "wiki-graph-core";
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
  LLMStreamProgressCallback,
  LLMTokenUsageCallback,
} from "wiki-graph-core";

import { loadCLIConfig, type CLIConfig } from "./config.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./support/index.js";
import { buildLLMOptions } from "./llm.js";

export function createStageLLM(
  config: CLIConfig,
  options?: {
    readonly cacheDirPath?: string;
    readonly logDirPath?: string;
    readonly onStreamProgress?: LLMStreamProgressCallback;
    readonly onTokenUsage?: LLMTokenUsageCallback;
  },
): LLM<WikiGraphScope> {
  const llmOptions = buildLLMOptions(config);

  return new LLM<WikiGraphScope>({
    dataDirPath: resolveDataDirPath(),
    sampling: createDefaultWikiGraphSampling({
      ...(llmOptions.temperature === undefined
        ? {}
        : { temperature: llmOptions.temperature }),
      ...(llmOptions.topP === undefined ? {} : { topP: llmOptions.topP }),
    }),
    ...llmOptions,
    ...(options?.cacheDirPath === undefined
      ? {}
      : { cacheDirPath: options.cacheDirPath }),
    ...(options?.logDirPath === undefined
      ? {}
      : { logDirPath: options.logDirPath }),
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

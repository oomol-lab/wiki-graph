import { resolveDataDirPath } from "../common/data-dir.js";
import type { SpineDigestScope } from "../common/llm-scope.js";
import { createDefaultSpineDigestSampling } from "../facade/llm-sampling.js";
import { LLM } from "../llm/index.js";
import type { LLMStreamProgressCallback } from "../llm/index.js";

import { loadCLIConfig, type CLIConfig } from "./config.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";
import { buildLLMOptions } from "./llm.js";

export const DEFAULT_EXTRACTION_PROMPT =
  "Focus on the main storyline and key character developments. Preserve important dialogues and critical plot points. Background descriptions and minor details can be compressed significantly.";

export function createStageLLM(
  config: CLIConfig,
  options?: {
    readonly onStreamProgress?: LLMStreamProgressCallback;
  },
): LLM<SpineDigestScope> {
  const llmOptions = buildLLMOptions(config);

  return new LLM<SpineDigestScope>({
    dataDirPath: resolveDataDirPath(),
    sampling: createDefaultSpineDigestSampling({
      ...(llmOptions.temperature === undefined
        ? {}
        : { temperature: llmOptions.temperature }),
      ...(llmOptions.topP === undefined ? {} : { topP: llmOptions.topP }),
    }),
    ...llmOptions,
    ...(options?.onStreamProgress === undefined
      ? {}
      : { onStreamProgress: options.onStreamProgress }),
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
        "Missing LLM configuration. Set --llm, `llm.provider` and `llm.model` in ~/.wikigraph/config.json, or the matching WIKIGRAPH_LLM_* environment variables.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }

  return config;
}

export function resolveExtractionPrompt(prompt: string | undefined): string {
  const normalizedPrompt = prompt?.trim();

  return normalizedPrompt === undefined || normalizedPrompt === ""
    ? DEFAULT_EXTRACTION_PROMPT
    : normalizedPrompt;
}

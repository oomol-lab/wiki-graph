import { resolveDataDirPath } from "wiki-graph-core";
import type { WikiGraphScope } from "wiki-graph-core";
import { createDefaultWikiGraphSampling } from "wiki-graph-core";
import { LLM } from "wiki-graph-core";
import type {
  LLMStreamProgressCallback,
  LLMTokenUsageCallback,
} from "wiki-graph-core";

import { loadCLIConfig, type CLIConfig } from "./config.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";
import { buildLLMOptions } from "./llm.js";

export const DEFAULT_EXTRACTION_PROMPT =
  "Focus on the main storyline and key character developments. Preserve important dialogues and critical plot points. Background descriptions and minor details can be compressed significantly.";

export const DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT = [
  "Recall only source mentions that should become stable searchable knowledge graph objects.",
  "Prefer named entities: historical persons, places, organizations, dynasties, political entities, named works, named events, battles, titles, and explicitly named domain concepts.",
  "Recall a non-named common concept only when it is a central recurring topic of the chapter and would be useful as an entity search result across multiple evidence passages.",
  "Do not recall a surface merely because it is useful for summarizing the story or explaining a detail.",
  "Do not recall pure numbers, standalone dates without a named event role, units of measurement, dimensions, ordinal labels, chapter numbers, punctuation fragments, common function words, generic verbs, generic adjectives, generic roles, generic objects, or incidental attributes.",
  "Measurements, quantities, dimensions, tactical details, and descriptive attributes should remain evidence text, not entity mentions.",
  "When uncertain, skip the mention rather than creating a noisy knowledge graph object.",
].join(" ");

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

export function resolveExtractionPrompt(prompt: string | undefined): string {
  const normalizedPrompt = prompt?.trim();

  return normalizedPrompt === undefined || normalizedPrompt === ""
    ? DEFAULT_EXTRACTION_PROMPT
    : normalizedPrompt;
}

export function resolveKnowledgeGraphRecallPrompt(
  prompt: string | undefined,
): string {
  const normalizedPrompt = prompt?.trim();

  return normalizedPrompt === undefined || normalizedPrompt === ""
    ? DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT
    : normalizedPrompt;
}

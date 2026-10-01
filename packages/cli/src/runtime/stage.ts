export {
  createStageLLM,
  DEFAULT_EXTRACTION_PROMPT,
  DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT,
  resolveExtractionPrompt,
  resolveKnowledgeGraphRecallPrompt,
} from "wiki-graph-sdk";

import {
  loadRequiredStageConfig as loadSDKRequiredStageConfig,
  type WikiGraphRuntimeConfig,
} from "wiki-graph-sdk";

import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";

export async function loadRequiredStageConfig(options: {
  readonly llmJSON?: string;
}): Promise<WikiGraphRuntimeConfig> {
  try {
    return await loadSDKRequiredStageConfig(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(withHelpRoute(message, CLI_HELP_ROUTES.config), {
      cause: error,
    });
  }
}

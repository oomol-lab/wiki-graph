import {
  buildSearchIndexEmbeddingProvider as buildSDKSearchIndexEmbeddingProvider,
  embedQueryText as embedSDKQueryText,
  embedQueryTextWithLocalConfig as embedSDKQueryTextWithLocalConfig,
  readWikiGraphEmbeddingConfig,
  type QueryEmbeddingResult,
  type SearchIndexEmbeddingProvider,
  type WikiGraphEmbeddingConfig,
  type WikiGraphEmbeddingProviderName,
} from "wiki-graph-sdk";

import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";

export type CLIEmbeddingConfig = WikiGraphEmbeddingConfig;
export type CLIEmbeddingProvider = WikiGraphEmbeddingProviderName;
export type { QueryEmbeddingResult };

export async function readEmbeddingConfig(): Promise<CLIEmbeddingConfig> {
  return await readWikiGraphEmbeddingConfig();
}

export async function embedQueryText(
  value: string,
  config: CLIEmbeddingConfig = {},
): Promise<QueryEmbeddingResult> {
  return await withEmbeddingHelp(() => embedSDKQueryText(value, config));
}

export function buildSearchIndexEmbeddingProvider(
  config: CLIEmbeddingConfig,
): SearchIndexEmbeddingProvider {
  try {
    return buildSDKSearchIndexEmbeddingProvider(config);
  } catch (error) {
    throw addEmbeddingHelp(error);
  }
}

export async function embedQueryTextWithLocalConfig(
  value: string,
): Promise<QueryEmbeddingResult> {
  return await withEmbeddingHelp(() => embedSDKQueryTextWithLocalConfig(value));
}

async function withEmbeddingHelp<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw addEmbeddingHelp(error);
  }
}

function addEmbeddingHelp(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(withHelpRoute(message, CLI_HELP_ROUTES.config), {
    cause: error,
  });
}

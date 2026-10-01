import {
  loadWikiGraphRuntimeConfig,
  resolveHostedProviderEndpoint as resolveSDKHostedProviderEndpoint,
  resolveWikispineConfig as resolveSDKWikispineConfig,
  type HostedProviderScope,
  type WikiGraphProvider,
  type WikiGraphRuntimeConfig,
} from "wiki-graph-sdk";

import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";
import { getCLIEnvPolicy } from "./context.js";

export type CLIConfig = WikiGraphRuntimeConfig;
export type CLIProvider = WikiGraphProvider;
export type { HostedProviderScope };

export async function loadCLIConfig(options?: {
  readonly llmJSON?: string;
}): Promise<CLIConfig> {
  try {
    return await loadWikiGraphRuntimeConfig(options);
  } catch (error) {
    throw withConfigHelp(error);
  }
}

export function resolveWikispineConfig(
  value: Record<string, unknown>,
  envPolicy: "development" | "production" = getCLIEnvPolicy(),
): CLIConfig["wikispine"] | undefined {
  try {
    return resolveSDKWikispineConfig(value, envPolicy);
  } catch (error) {
    throw withConfigHelp(error);
  }
}

export function resolveHostedProviderEndpoint(
  scope: HostedProviderScope,
  envPolicy: "development" | "production" = getCLIEnvPolicy(),
): string {
  return resolveSDKHostedProviderEndpoint(scope, envPolicy);
}

function withConfigHelp(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(withHelpRoute(message, CLI_HELP_ROUTES.config), {
    cause: error,
  });
}

import {
  buildWikiGraphLLMOptions,
  type WikiGraphLLMOptions,
} from "wiki-graph-sdk";

import type { CLIConfig } from "./config.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";

export function buildLLMOptions(config: CLIConfig): WikiGraphLLMOptions {
  try {
    return buildWikiGraphLLMOptions(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(withHelpRoute(message, CLI_HELP_ROUTES.config), {
      cause: error,
    });
  }
}

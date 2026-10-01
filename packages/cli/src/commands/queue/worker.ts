import {
  requireKnowledgeGraphWikispineConfig,
  runWikiGraphQueueWorker,
} from "wiki-graph-sdk";

export { requireKnowledgeGraphWikispineConfig };

import { CLI_HELP_ROUTES, withHelpRoute } from "../../support/index.js";

export async function runQueueWorker(): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runWikiGraphQueueWorker({ signal: controller.signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(withHelpRoute(message, CLI_HELP_ROUTES.config), {
      cause: error,
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

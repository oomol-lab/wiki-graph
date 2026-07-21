import type { WikiGraphLLMOptions } from "wiki-graph-core";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { CLIConfig, CLIProvider } from "./config.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./support/index.js";

export function buildLLMOptions(config: CLIConfig): WikiGraphLLMOptions {
  const llm = config.llm;

  if (llm?.provider === undefined || llm.model === undefined) {
    throw new Error(
      withHelpRoute(
        "Missing LLM configuration. Set --llm for one run, or configure `wikg://local/config/llm` with provider and model.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }

  return {
    model: createLanguageModel(llm.provider, llm.model, {
      apiKey: llm.apiKey,
      baseURL: llm.baseURL,
      name: llm.name,
    }),
    ...(config.concurrent?.request === undefined
      ? {}
      : { concurrent: config.concurrent.request }),
  };
}

function createLanguageModel(
  provider: CLIProvider,
  model: string,
  options: {
    readonly apiKey: string | undefined;
    readonly baseURL: string | undefined;
    readonly name: string | undefined;
  },
) {
  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(options.name === undefined ? {} : { name: options.name }),
      });

      return anthropic(model);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(options.name === undefined ? {} : { name: options.name }),
      });

      return google(model);
    }
    case "openai": {
      if (options.baseURL !== undefined) {
        throw new Error(
          withHelpRoute(
            "openai does not accept llm.baseURL or baseURL in --llm JSON. Use openai-compatible for third-party OpenAI-style APIs.",
            CLI_HELP_ROUTES.config,
          ),
        );
      }

      const openai = createOpenAI({
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(options.name === undefined ? {} : { name: options.name }),
      });

      return openai(model);
    }
    case "openai-compatible": {
      if (options.baseURL === undefined) {
        throw new Error(
          withHelpRoute(
            "openai-compatible requires llm.baseURL or baseURL in --llm JSON.",
            CLI_HELP_ROUTES.config,
          ),
        );
      }

      const openaiCompatible = createOpenAICompatible({
        baseURL: options.baseURL,
        name: options.name ?? createOpenAICompatibleName(options.baseURL),
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      });

      return openaiCompatible(model);
    }
  }
}

function createOpenAICompatibleName(baseURL: string): string {
  try {
    return new URL(baseURL).hostname;
  } catch {
    return "openai-compatible";
  }
}

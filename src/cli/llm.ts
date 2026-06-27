import type { SpineDigestLLMOptions } from "../facade/index.js";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { CLIConfig, CLIProvider } from "./config.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";

export function buildLLMOptions(config: CLIConfig): SpineDigestLLMOptions {
  const llm = config.llm;

  if (llm?.provider === undefined || llm.model === undefined) {
    throw new Error(
      withHelpRoute(
        "Missing LLM configuration. Set --llm, `llm.provider` and `llm.model` in ~/.wikigraph/config.json, or the matching WIKIGRAPH_LLM_* environment variables.",
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
    ...(config.paths?.cacheDir === undefined
      ? {}
      : { cacheDirPath: config.paths.cacheDir }),
    ...(config.paths?.debugLogDir === undefined
      ? {}
      : { logDirPath: config.paths.debugLogDir }),
    ...(config.request?.concurrent === undefined
      ? {}
      : { concurrent: config.request.concurrent }),
    ...(config.request?.retryIntervalSeconds === undefined
      ? {}
      : { retryIntervalSeconds: config.request.retryIntervalSeconds }),
    ...(config.request?.retryTimes === undefined
      ? {}
      : { retryTimes: config.request.retryTimes }),
    ...(config.request?.stream === undefined
      ? {}
      : { stream: config.request.stream }),
    ...(config.request?.temperature === undefined
      ? {}
      : { temperature: config.request.temperature }),
    ...(config.request?.timeout === undefined
      ? {}
      : { timeout: config.request.timeout }),
    ...(config.request?.topP === undefined
      ? {}
      : { topP: config.request.topP }),
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
            "openai does not accept llm.baseURL, baseURL in --llm JSON, or WIKIGRAPH_LLM_BASE_URL. Use openai-compatible for third-party OpenAI-style APIs.",
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
            "openai-compatible requires llm.baseURL, baseURL in --llm JSON, or WIKIGRAPH_LLM_BASE_URL.",
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

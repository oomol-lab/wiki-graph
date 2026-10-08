import type { SearchIndexEmbeddingProvider } from "wiki-graph-core";

import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { readLocalConfigSection } from "./local-config.js";

export type WikiGraphEmbeddingProviderName = "openai" | "openai-compatible";

export interface WikiGraphEmbeddingConfig {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly dimensions?: number;
  readonly model?: string;
  readonly name?: string;
  readonly provider?: WikiGraphEmbeddingProviderName;
}

export interface QueryEmbeddingResult {
  readonly dimensions: number;
  readonly embedding: readonly number[];
  readonly model: string;
  readonly provider: WikiGraphEmbeddingProviderName;
  readonly usage?: {
    readonly tokens?: number;
  };
}

const EMBEDDING_BATCH_SIZE = 10;

export async function readWikiGraphEmbeddingConfig(): Promise<WikiGraphEmbeddingConfig> {
  const config = await readLocalConfigSection("embeddings");

  return {
    ...(typeof config.apiKey === "string" ? { apiKey: config.apiKey } : {}),
    ...(typeof config.baseURL === "string" ? { baseURL: config.baseURL } : {}),
    ...(typeof config.dimensions === "number"
      ? { dimensions: config.dimensions }
      : {}),
    ...(typeof config.model === "string" ? { model: config.model } : {}),
    ...(typeof config.name === "string" ? { name: config.name } : {}),
    ...(typeof config.provider === "string"
      ? { provider: parseEmbeddingProvider(config.provider) }
      : {}),
  };
}

export async function embedQueryText(
  value: string,
  config: WikiGraphEmbeddingConfig = {},
): Promise<QueryEmbeddingResult> {
  const normalized = value.trim();

  if (normalized === "") {
    throw new Error("Query text cannot be empty.");
  }

  const provider = requireEmbeddingProvider(config.provider);
  const model = requireEmbeddingModel(config.model);
  const embeddingModel = createEmbeddingModel(provider, model, config);
  const providerOptions = createEmbeddingProviderOptions(provider, config);
  const result = await embed({
    model: embeddingModel,
    ...(providerOptions === undefined ? {} : { providerOptions }),
    value: normalized,
  });

  return {
    dimensions: result.embedding.length,
    embedding: result.embedding,
    model,
    provider,
    ...(result.usage.tokens === undefined
      ? {}
      : { usage: { tokens: result.usage.tokens } }),
  };
}

export function buildSearchIndexEmbeddingProvider(
  config: WikiGraphEmbeddingConfig,
): SearchIndexEmbeddingProvider {
  const provider = requireEmbeddingProvider(config.provider);
  const model = requireEmbeddingModel(config.model);
  const embeddingModel = createEmbeddingModel(provider, model, config);
  const providerOptions = createEmbeddingProviderOptions(provider, config);

  return {
    ...(config.dimensions === undefined
      ? {}
      : { dimensions: config.dimensions }),
    identity: createEmbeddingIdentity(provider, model, config),
    model,
    embedTexts: async (texts, options) => {
      const embeddings: number[][] = [];
      let tokens = 0;

      for (const batch of chunkTexts(texts, EMBEDDING_BATCH_SIZE)) {
        options?.signal?.throwIfAborted();
        const result = await embedMany({
          ...(options?.signal === undefined
            ? {}
            : { abortSignal: options.signal }),
          model: embeddingModel,
          ...(providerOptions === undefined ? {} : { providerOptions }),
          values: [...batch],
        });

        embeddings.push(...result.embeddings);
        tokens += result.usage.tokens ?? 0;
      }
      return {
        embeddings,
        ...(tokens === 0 ? {} : { tokens }),
      };
    },
  };
}

function createEmbeddingIdentity(
  provider: WikiGraphEmbeddingProviderName,
  model: string,
  config: WikiGraphEmbeddingConfig,
): string {
  return JSON.stringify({
    ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
    ...(config.dimensions === undefined
      ? {}
      : { dimensions: config.dimensions }),
    model,
    provider,
  });
}

function* chunkTexts(
  texts: readonly string[],
  size: number,
): Iterable<readonly string[]> {
  for (let index = 0; index < texts.length; index += size) {
    yield texts.slice(index, index + size);
  }
}

export async function embedQueryTextWithLocalConfig(
  value: string,
): Promise<QueryEmbeddingResult> {
  return await embedQueryText(value, await readWikiGraphEmbeddingConfig());
}

function createEmbeddingModel(
  provider: WikiGraphEmbeddingProviderName,
  model: string,
  config: WikiGraphEmbeddingConfig,
) {
  switch (provider) {
    case "openai": {
      if (config.baseURL !== undefined) {
        throw new Error(
          "openai does not accept embeddings.baseURL. Use openai-compatible for third-party OpenAI-style embeddings APIs.",
        );
      }

      return createOpenAI({
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.name === undefined ? {} : { name: config.name }),
      }).embeddingModel(model);
    }
    case "openai-compatible": {
      if (config.baseURL === undefined) {
        throw new Error("openai-compatible requires embeddings.baseURL.");
      }

      return createOpenAICompatible({
        baseURL: config.baseURL,
        name: config.name ?? createOpenAICompatibleName(config.baseURL),
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
      }).embeddingModel(model);
    }
  }
}

function createEmbeddingProviderOptions(
  provider: WikiGraphEmbeddingProviderName,
  config: WikiGraphEmbeddingConfig,
): Record<string, { readonly dimensions: number }> | undefined {
  if (config.dimensions === undefined) {
    return undefined;
  }

  return {
    [getEmbeddingProviderOptionsName(provider, config)]: {
      dimensions: config.dimensions,
    },
  };
}

function getEmbeddingProviderOptionsName(
  provider: WikiGraphEmbeddingProviderName,
  _config: WikiGraphEmbeddingConfig,
): string {
  if (provider === "openai") {
    return "openai";
  }
  return "openaiCompatible";
}

function requireEmbeddingProvider(
  provider: WikiGraphEmbeddingProviderName | undefined,
): WikiGraphEmbeddingProviderName {
  if (provider !== undefined) {
    return provider;
  }

  throw new Error(
    "Missing embeddings configuration. Configure `wikg://local/config/embeddings` with provider and model.",
  );
}

function requireEmbeddingModel(model: string | undefined): string {
  if (model !== undefined) {
    return model;
  }

  throw new Error(
    "Missing embeddings.model. Configure `wikg://local/config/embeddings` before using Dense search.",
  );
}

function parseEmbeddingProvider(value: string): WikiGraphEmbeddingProviderName {
  switch (value) {
    case "openai":
    case "openai-compatible":
      return value;
    default:
      throw new Error(
        `Invalid embeddings.provider: ${value}. Expected openai or openai-compatible.`,
      );
  }
}

function createOpenAICompatibleName(baseURL: string): string {
  try {
    return new URL(baseURL).hostname;
  } catch {
    return "openai-compatible";
  }
}

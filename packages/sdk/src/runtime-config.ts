import { z } from "zod";

import { readLocalConfigSection } from "./local-config.js";
import { getWikiGraphSDKRuntimeContext } from "./runtime-context.js";

const WIKI_GRAPH_PROVIDER_VALUES = [
  "anthropic",
  "google",
  "openai",
  "openai-compatible",
] as const;

const wikiGraphProviderSchema = z.enum(WIKI_GRAPH_PROVIDER_VALUES);
const inlineLLMConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseURL: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  chatCompletionsUrl: z.string().min(1).optional(),
  llm: z
    .object({
      apiKey: z.string().min(1).optional(),
      baseURL: z.string().min(1).optional(),
      baseUrl: z.string().min(1).optional(),
      chatCompletionsUrl: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      provider: wikiGraphProviderSchema.optional(),
    })
    .optional(),
  model: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  provider: wikiGraphProviderSchema.optional(),
});

export type WikiGraphProvider = z.infer<typeof wikiGraphProviderSchema>;

export interface WikiGraphRuntimeConfig {
  readonly embedding?: {
    readonly apiKey?: string;
    readonly baseURL?: string;
    readonly dimensions?: number;
    readonly model?: string;
    readonly name?: string;
    readonly provider?: "openai" | "openai-compatible";
  };
  readonly llm?: {
    readonly apiKey?: string;
    readonly baseURL?: string;
    readonly model?: string;
    readonly name?: string;
    readonly provider?: WikiGraphProvider;
  };
  readonly prompt?: string;
  readonly concurrent?: {
    readonly job?: number;
    readonly request?: number;
  };
  readonly wikispine?:
    | { readonly provider: "cli" }
    | {
        readonly endpoint: string;
        readonly provider: "fetch";
        readonly token: string;
      };
  readonly wikimedia?: {
    readonly endpoint: string;
    readonly token: string;
  };
}

export type HostedProviderScope = "wg-wikimedia" | "wikispine";

type InlineLLMConfig = NonNullable<WikiGraphRuntimeConfig["llm"]>;

export async function loadWikiGraphRuntimeConfig(options?: {
  readonly llmJSON?: string;
}): Promise<WikiGraphRuntimeConfig> {
  const [embedding, localLLM, concurrent, wikimedia, wikispine] =
    await Promise.all([
      readLocalConfigSection("embeddings"),
      readLocalConfigSection("llm"),
      readLocalConfigSection("concurrent"),
      readLocalConfigSection("wikimedia"),
      readLocalConfigSection("wikispine"),
    ]);
  const inlineLLMConfig =
    options?.llmJSON === undefined
      ? undefined
      : parseInlineLLMConfig(options.llmJSON);
  const llm = createLLMConfig({
    apiKey: firstDefined(inlineLLMConfig?.apiKey, readString(localLLM.apiKey)),
    baseURL: firstDefined(
      inlineLLMConfig?.baseURL,
      readString(localLLM.baseURL),
    ),
    model: firstDefined(inlineLLMConfig?.model, readString(localLLM.model)),
    name: firstDefined(inlineLLMConfig?.name, readString(localLLM.name)),
    provider: firstDefined(
      inlineLLMConfig?.provider,
      readProvider(localLLM.provider),
    ),
  });
  const requestConcurrent = readPositiveInteger(concurrent.request);
  const jobConcurrent = readPositiveInteger(concurrent.job);
  const envPolicy = getWikiGraphSDKRuntimeContext().envPolicy;
  const wikispineConfig = resolveWikispineConfig(wikispine, envPolicy);
  const wikimediaConfig = createWikimediaConfig(wikimedia, envPolicy);
  const embeddingConfig = createEmbeddingConfig(embedding);

  return {
    ...(jobConcurrent === undefined && requestConcurrent === undefined
      ? {}
      : {
          concurrent: {
            ...(jobConcurrent === undefined ? {} : { job: jobConcurrent }),
            ...(requestConcurrent === undefined
              ? {}
              : { request: requestConcurrent }),
          },
        }),
    ...(embeddingConfig === undefined ? {} : { embedding: embeddingConfig }),
    ...(llm === undefined ? {} : { llm }),
    ...(wikimediaConfig === undefined ? {} : { wikimedia: wikimediaConfig }),
    ...(wikispineConfig === undefined ? {} : { wikispine: wikispineConfig }),
  };
}

function createWikimediaConfig(
  input: Record<string, unknown> | undefined,
  envPolicy: "development" | "production",
): WikiGraphRuntimeConfig["wikimedia"] | undefined {
  const endpoint = readString(input?.endpoint);
  const token = readString(input?.token);

  if (endpoint === undefined && token === undefined) return undefined;
  if (token === undefined) {
    throw new Error(
      "Remote Wikimedia access requires an API key. Configure `wikg://local/config/wikimedia` token with `put token --secret`.",
    );
  }
  return {
    endpoint:
      endpoint ?? resolveHostedProviderEndpoint("wg-wikimedia", envPolicy),
    token,
  };
}

function createEmbeddingConfig(
  input: Record<string, unknown> | undefined,
): WikiGraphRuntimeConfig["embedding"] | undefined {
  const value = input ?? {};
  const provider = readEmbeddingProvider(value.provider);
  const apiKey = readString(value.apiKey);
  const baseURL = readString(value.baseURL);
  const dimensions =
    typeof value.dimensions === "number" &&
    Number.isInteger(value.dimensions) &&
    value.dimensions > 0
      ? value.dimensions
      : undefined;
  const model = readString(value.model);
  const name = readString(value.name);

  if (
    provider === undefined ||
    model === undefined ||
    (provider === "openai-compatible" && baseURL === undefined) ||
    (provider === "openai" && baseURL !== undefined)
  ) {
    return undefined;
  }

  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(dimensions === undefined ? {} : { dimensions }),
    ...(model === undefined ? {} : { model }),
    ...(name === undefined ? {} : { name }),
    ...(provider === undefined ? {} : { provider }),
  };
}

function parseInlineLLMConfig(value: string): InlineLLMConfig | undefined {
  const normalized = normalizeString(value);

  if (normalized === undefined) {
    throw new Error("--llm must be a non-empty JSON object.");
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(normalized);
  } catch (error) {
    throw new Error(`Invalid --llm JSON: ${formatError(error)}`);
  }

  const parsed = inlineLLMConfigSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error(
      `Invalid --llm config: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const input = parsed.data.llm ?? parsed.data;
  const provider = input.provider ?? inferInlineProvider(input);
  const baseURL = resolveInlineBaseURL(input);
  const config = createLLMConfig({
    apiKey: input.apiKey,
    baseURL,
    model: input.model,
    name: input.name,
    provider,
  });

  if (config === undefined) {
    throw new Error("--llm must contain at least one supported LLM field.");
  }

  return config;
}

function inferInlineProvider(input: {
  readonly baseURL?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly chatCompletionsUrl?: string | undefined;
  readonly provider?: WikiGraphProvider | undefined;
}): WikiGraphProvider | undefined {
  if (
    input.provider === undefined &&
    (input.baseURL !== undefined ||
      input.baseUrl !== undefined ||
      input.chatCompletionsUrl !== undefined)
  ) {
    return "openai-compatible";
  }

  return input.provider;
}

function inferBaseURLFromChatCompletionsURL(input: {
  readonly chatCompletionsUrl?: string | undefined;
}): string | undefined {
  if (input.chatCompletionsUrl === undefined) {
    return undefined;
  }

  const suffix = "/chat/completions";

  if (!input.chatCompletionsUrl.endsWith(suffix)) {
    throw new Error(
      "--llm chatCompletionsUrl must end with /chat/completions when baseURL is not provided.",
    );
  }

  return input.chatCompletionsUrl.slice(0, -suffix.length);
}

function resolveInlineBaseURL(input: {
  readonly baseURL?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly chatCompletionsUrl?: string | undefined;
}): string | undefined {
  if (input.baseURL !== undefined) {
    return input.baseURL;
  }
  if (input.baseUrl !== undefined) {
    return input.baseUrl;
  }

  return inferBaseURLFromChatCompletionsURL(input);
}

function createLLMConfig(input: {
  readonly apiKey: string | undefined;
  readonly baseURL: string | undefined;
  readonly model: string | undefined;
  readonly name: string | undefined;
  readonly provider: WikiGraphProvider | undefined;
}): WikiGraphRuntimeConfig["llm"] {
  if (
    input.apiKey === undefined &&
    input.baseURL === undefined &&
    input.model === undefined &&
    input.name === undefined &&
    input.provider === undefined
  ) {
    return undefined;
  }

  return {
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    ...(input.baseURL === undefined ? {} : { baseURL: input.baseURL }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
  };
}

function readProvider(value: unknown): WikiGraphProvider | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = wikiGraphProviderSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

export function resolveWikispineConfig(
  value: Record<string, unknown>,
  envPolicy: "development" | "production" = getWikiGraphSDKRuntimeContext()
    .envPolicy,
): WikiGraphRuntimeConfig["wikispine"] | undefined {
  const provider = readWikispineProvider(value.provider);
  const endpoint = readString(value.endpoint);
  const token = readString(value.token);

  if (provider === undefined) {
    return undefined;
  }

  if (provider === "cli") return { provider };
  if (token === undefined) {
    throw new Error(
      "Remote WikiSpine access requires an API key. Configure `wikg://local/config/wikispine` token with `put token --secret`.",
    );
  }

  return {
    endpoint: endpoint ?? resolveHostedProviderEndpoint("wikispine", envPolicy),
    provider,
    token,
  };
}

export function resolveHostedProviderEndpoint(
  scope: HostedProviderScope,
  envPolicy: "development" | "production" = getWikiGraphSDKRuntimeContext()
    .envPolicy,
): string {
  const origin =
    envPolicy === "development"
      ? "https://pdf-craft-api.oomol.dev"
      : "https://api.pdfcraft.ai";
  return `${origin}/v1/${scope}`;
}

function readWikispineProvider(value: unknown): "cli" | "fetch" | undefined {
  return value === "cli" || value === "fetch" ? value : undefined;
}

function readEmbeddingProvider(
  value: unknown,
): "openai" | "openai-compatible" | undefined {
  return value === "openai" || value === "openai-compatible"
    ? value
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function firstDefined<T>(
  first: T | undefined,
  second: T | undefined,
): T | undefined {
  return first ?? second;
}

function normalizeString(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

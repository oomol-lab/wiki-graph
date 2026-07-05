import { z } from "zod";

import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";
import { readLocalConfigSection } from "./local-config-store.js";

const CLI_PROVIDER_VALUES = [
  "anthropic",
  "google",
  "openai",
  "openai-compatible",
] as const;

const cliProviderSchema = z.enum(CLI_PROVIDER_VALUES);
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
      provider: cliProviderSchema.optional(),
    })
    .optional(),
  model: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  provider: cliProviderSchema.optional(),
});

export type CLIProvider = z.infer<typeof cliProviderSchema>;

export interface CLIConfig {
  readonly llm?: {
    readonly apiKey?: string;
    readonly baseURL?: string;
    readonly model?: string;
    readonly name?: string;
    readonly provider?: CLIProvider;
  };
  readonly prompt?: string;
  readonly concurrent?: {
    readonly job?: number;
    readonly request?: number;
  };
  readonly wikispine?: {
    readonly command?: string;
    readonly dataDir?: string;
    readonly endpoint?: string;
    readonly provider?: "cli" | "fetch";
  };
}

type InlineLLMConfig = NonNullable<CLIConfig["llm"]>;

export async function loadCLIConfig(options?: {
  readonly llmJSON?: string;
}): Promise<CLIConfig> {
  const [localLLM, concurrent, wikispine] = await Promise.all([
    readLocalConfigSection("llm"),
    readLocalConfigSection("concurrent"),
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
  const wikispineConfig = createWikispineConfig(wikispine);

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
    ...(llm === undefined ? {} : { llm }),
    ...(wikispineConfig === undefined ? {} : { wikispine: wikispineConfig }),
  };
}

function parseInlineLLMConfig(value: string): InlineLLMConfig | undefined {
  const normalized = normalizeString(value);

  if (normalized === undefined) {
    throw new Error(
      withHelpRoute(
        "--llm must be a non-empty JSON object.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(normalized);
  } catch (error) {
    throw new Error(
      withHelpRoute(
        `Invalid --llm JSON: ${formatError(error)}`,
        CLI_HELP_ROUTES.config,
      ),
    );
  }

  const parsed = inlineLLMConfigSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error(
      withHelpRoute(
        `Invalid --llm config: ${parsed.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
          )
          .join("; ")}`,
        CLI_HELP_ROUTES.config,
      ),
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
    throw new Error(
      withHelpRoute(
        "--llm must contain at least one supported LLM field.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }

  return config;
}

function inferInlineProvider(input: {
  readonly baseURL?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly chatCompletionsUrl?: string | undefined;
  readonly provider?: CLIProvider | undefined;
}): CLIProvider | undefined {
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
      withHelpRoute(
        "--llm chatCompletionsUrl must end with /chat/completions when baseURL is not provided.",
        CLI_HELP_ROUTES.config,
      ),
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
  readonly provider: CLIProvider | undefined;
}): CLIConfig["llm"] {
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

function readProvider(value: unknown): CLIProvider | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = cliProviderSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function createWikispineConfig(
  value: Record<string, unknown>,
): CLIConfig["wikispine"] | undefined {
  const provider = readWikispineProvider(value.provider);
  const command = readString(value.command);
  const dataDir = readString(value.dataDir);
  const endpoint = readString(value.endpoint);

  if (
    command === undefined &&
    dataDir === undefined &&
    endpoint === undefined &&
    provider === undefined
  ) {
    return undefined;
  }

  return {
    ...(command === undefined ? {} : { command }),
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(provider === undefined ? {} : { provider }),
  };
}

function readWikispineProvider(value: unknown): "cli" | "fetch" | undefined {
  return value === "cli" || value === "fetch" ? value : undefined;
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

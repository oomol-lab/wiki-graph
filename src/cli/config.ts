import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { dirname, isAbsolute, join, resolve } from "path";

import { z } from "zod";

import { resolveWikiGraphConfigFilePath } from "../common/wiki-graph-dir.js";

import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";

const CLI_PROVIDER_VALUES = [
  "anthropic",
  "google",
  "openai",
  "openai-compatible",
] as const;

const cliProviderSchema = z.enum(CLI_PROVIDER_VALUES);
const samplingSettingSchema = z.union([z.number(), z.array(z.number())]);
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
const cliConfigSchema = z.object({
  llm: z
    .object({
      apiKey: z.string().min(1).optional(),
      baseURL: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      provider: cliProviderSchema.optional(),
    })
    .optional(),
  paths: z
    .object({
      cacheDir: z.string().min(1).optional(),
      debugLogDir: z.string().min(1).optional(),
    })
    .optional(),
  prompt: z.string().min(1).optional(),
  queue: z
    .object({
      concurrent: z.number().int().positive().optional(),
    })
    .optional(),
  request: z
    .object({
      concurrent: z.number().int().positive().optional(),
      retryIntervalSeconds: z.number().positive().optional(),
      retryTimes: z.number().int().min(0).optional(),
      stream: z.boolean().optional(),
      temperature: samplingSettingSchema.optional(),
      timeout: z.number().positive().optional(),
      topP: samplingSettingSchema.optional(),
    })
    .optional(),
});

export type CLIProvider = z.infer<typeof cliProviderSchema>;

export interface CLIConfig {
  readonly configFilePath?: string;
  readonly llm?: {
    readonly apiKey?: string;
    readonly baseURL?: string;
    readonly model?: string;
    readonly name?: string;
    readonly provider?: CLIProvider;
  };
  readonly paths?: {
    readonly cacheDir?: string;
    readonly debugLogDir?: string;
  };
  readonly prompt?: string;
  readonly queue?: {
    readonly concurrent?: number;
  };
  readonly request?: {
    readonly concurrent?: number;
    readonly retryIntervalSeconds?: number;
    readonly retryTimes?: number;
    readonly stream?: boolean;
    readonly temperature?: number | readonly number[];
    readonly timeout?: number;
    readonly topP?: number | readonly number[];
  };
}

type CLIConfigFile = z.infer<typeof cliConfigSchema>;

type InlineLLMConfig = NonNullable<CLIConfig["llm"]>;

export async function loadCLIConfig(options?: {
  readonly llmJSON?: string;
}): Promise<CLIConfig> {
  const configFilePath = resolveCLIConfigFilePath();
  const fileConfig = await readCLIConfigFile(configFilePath);
  const configDirectoryPath = dirname(configFilePath);
  const inlineLLMConfig =
    options?.llmJSON === undefined
      ? undefined
      : parseInlineLLMConfig(options.llmJSON);

  const prompt = firstDefined(
    normalizeString(process.env.WIKIGRAPH_PROMPT),
    fileConfig.prompt,
  );
  const llm = createLLMConfig({
    apiKey: firstDefined(
      inlineLLMConfig?.apiKey,
      firstDefined(
        normalizeString(process.env.WIKIGRAPH_LLM_API_KEY),
        fileConfig.llm?.apiKey,
      ),
    ),
    baseURL: firstDefined(
      inlineLLMConfig?.baseURL,
      firstDefined(
        normalizeString(process.env.WIKIGRAPH_LLM_BASE_URL),
        fileConfig.llm?.baseURL,
      ),
    ),
    model: firstDefined(
      inlineLLMConfig?.model,
      firstDefined(
        normalizeString(process.env.WIKIGRAPH_LLM_MODEL),
        fileConfig.llm?.model,
      ),
    ),
    name: firstDefined(
      inlineLLMConfig?.name,
      firstDefined(
        normalizeString(process.env.WIKIGRAPH_LLM_NAME),
        fileConfig.llm?.name,
      ),
    ),
    provider: firstDefined(
      inlineLLMConfig?.provider,
      firstDefined(
        parseOptionalProvider(process.env.WIKIGRAPH_LLM_PROVIDER),
        fileConfig.llm?.provider,
      ),
    ),
  });
  const paths = createPathsConfig({
    cacheDir: firstDefined(
      resolveEnvPath(process.env.WIKIGRAPH_CACHE_DIR),
      resolveConfigPath(fileConfig.paths?.cacheDir, configDirectoryPath),
    ),
    debugLogDir: firstDefined(
      resolveEnvPath(process.env.WIKIGRAPH_DEBUG_LOG_DIR),
      resolveConfigPath(fileConfig.paths?.debugLogDir, configDirectoryPath),
    ),
  });
  const request = createRequestConfig({
    concurrent: firstDefined(
      parseOptionalPositiveInteger(
        process.env.WIKIGRAPH_REQUEST_CONCURRENT,
        "WIKIGRAPH_REQUEST_CONCURRENT",
      ),
      fileConfig.request?.concurrent,
    ),
    retryIntervalSeconds: firstDefined(
      parseOptionalPositiveNumber(
        process.env.WIKIGRAPH_REQUEST_RETRY_INTERVAL_SECONDS,
        "WIKIGRAPH_REQUEST_RETRY_INTERVAL_SECONDS",
      ),
      fileConfig.request?.retryIntervalSeconds,
    ),
    retryTimes: firstDefined(
      parseOptionalNonNegativeInteger(
        process.env.WIKIGRAPH_REQUEST_RETRY_TIMES,
        "WIKIGRAPH_REQUEST_RETRY_TIMES",
      ),
      fileConfig.request?.retryTimes,
    ),
    stream: firstDefined(
      parseOptionalBoolean(
        process.env.WIKIGRAPH_REQUEST_STREAM,
        "WIKIGRAPH_REQUEST_STREAM",
      ),
      fileConfig.request?.stream,
    ),
    temperature: firstDefined(
      parseOptionalSamplingSetting(
        process.env.WIKIGRAPH_REQUEST_TEMPERATURE,
        "WIKIGRAPH_REQUEST_TEMPERATURE",
      ),
      fileConfig.request?.temperature,
    ),
    timeout: firstDefined(
      parseOptionalPositiveNumber(
        process.env.WIKIGRAPH_REQUEST_TIMEOUT,
        "WIKIGRAPH_REQUEST_TIMEOUT",
      ),
      fileConfig.request?.timeout,
    ),
    topP: firstDefined(
      parseOptionalSamplingSetting(
        process.env.WIKIGRAPH_REQUEST_TOP_P,
        "WIKIGRAPH_REQUEST_TOP_P",
      ),
      fileConfig.request?.topP,
    ),
  });
  const queue = createQueueConfig({
    concurrent: firstDefined(
      parseOptionalPositiveInteger(
        process.env.WIKIGRAPH_QUEUE_CONCURRENT,
        "WIKIGRAPH_QUEUE_CONCURRENT",
      ),
      fileConfig.queue?.concurrent,
    ),
  });

  return {
    ...(existsSync(configFilePath) ? { configFilePath } : {}),
    ...(prompt === undefined ? {} : { prompt }),
    ...(llm === undefined ? {} : { llm }),
    ...(paths === undefined ? {} : { paths }),
    ...(queue === undefined ? {} : { queue }),
    ...(request === undefined ? {} : { request }),
  };
}

export function resolveCLIConfigFilePath(): string {
  return resolveConfigFilePath(process.env.WIKIGRAPH_CONFIG);
}

export async function readCLIConfigFile(path: string): Promise<CLIConfigFile> {
  if (!existsSync(path)) {
    return {};
  }

  const content = await readFile(path, "utf8");
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(content);
  } catch (error) {
    throw new Error(
      withHelpRoute(
        `Invalid CLI config JSON at ${path}: ${formatError(error)}`,
        CLI_HELP_ROUTES["config-file"],
      ),
    );
  }

  const parsed = cliConfigSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error(
      withHelpRoute(
        `Invalid CLI config at ${path}: ${parsed.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
          )
          .join("; ")}`,
        CLI_HELP_ROUTES["config-file"],
      ),
    );
  }

  return parsed.data;
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

function resolveConfigFilePath(path: string | undefined): string {
  if (path === undefined) {
    return resolveWikiGraphConfigFilePath();
  }

  return resolvePath(path, process.cwd());
}

function resolveEnvPath(path: string | undefined): string | undefined {
  const normalized = normalizeString(path);

  return normalized === undefined
    ? undefined
    : resolvePath(normalized, process.cwd());
}

function resolveConfigPath(
  path: string | undefined,
  baseDirectoryPath: string,
): string | undefined {
  const normalized = normalizeString(path);

  return normalized === undefined
    ? undefined
    : resolvePath(normalized, baseDirectoryPath);
}

function resolvePath(path: string, baseDirectoryPath: string): string {
  const expandedPath = path.startsWith("~/")
    ? join(homedir(), path.slice(2))
    : path === "~"
      ? homedir()
      : path;

  return isAbsolute(expandedPath)
    ? resolve(expandedPath)
    : resolve(baseDirectoryPath, expandedPath);
}

function parseOptionalProvider(
  value: string | undefined,
): CLIProvider | undefined {
  const normalized = normalizeString(value)?.toLowerCase();

  if (normalized === undefined) {
    return undefined;
  }

  const parsed = cliProviderSchema.safeParse(normalized);

  if (!parsed.success) {
    throw new Error(
      withHelpRoute(
        `Invalid WIKIGRAPH_LLM_PROVIDER: ${value}. Expected one of ${CLI_PROVIDER_VALUES.join(", ")}.`,
        CLI_HELP_ROUTES.env,
      ),
    );
  }

  return parsed.data;
}

function parseOptionalPositiveInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  const parsed = parseOptionalPositiveNumber(value, name);

  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed)) {
    throw new Error(
      withHelpRoute(`${name} must be an integer.`, CLI_HELP_ROUTES.env),
    );
  }

  return parsed;
}

function parseOptionalNonNegativeInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  const normalized = normalizeString(value);

  if (normalized === undefined) {
    return undefined;
  }

  const parsed = Number(normalized);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      withHelpRoute(
        `${name} must be a non-negative integer.`,
        CLI_HELP_ROUTES.env,
      ),
    );
  }

  return parsed;
}

function parseOptionalPositiveNumber(
  value: string | undefined,
  name: string,
): number | undefined {
  const normalized = normalizeString(value);

  if (normalized === undefined) {
    return undefined;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      withHelpRoute(`${name} must be a positive number.`, CLI_HELP_ROUTES.env),
    );
  }

  return parsed;
}

function parseOptionalBoolean(
  value: string | undefined,
  name: string,
): boolean | undefined {
  const normalized = normalizeString(value)?.toLowerCase();

  if (normalized === undefined) {
    return undefined;
  }

  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new Error(
    withHelpRoute(`${name} must be true/false or 1/0.`, CLI_HELP_ROUTES.env),
  );
}

function parseOptionalSamplingSetting(
  value: string | undefined,
  name: string,
): number | readonly number[] | undefined {
  const normalized = normalizeString(value);

  if (normalized === undefined) {
    return undefined;
  }

  if (normalized.startsWith("[")) {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(normalized);
    } catch (error) {
      throw new Error(
        withHelpRoute(
          `${name} must be a number or JSON number array: ${formatError(error)}`,
          CLI_HELP_ROUTES.env,
        ),
      );
    }

    const parsed = z.array(z.number()).safeParse(parsedJson);

    if (!parsed.success) {
      throw new Error(
        withHelpRoute(
          `${name} must be a number or JSON number array.`,
          CLI_HELP_ROUTES.env,
        ),
      );
    }

    return parsed.data;
  }

  return parseOptionalPositiveNumber(normalized, name);
}

function firstDefined<T>(
  first: T | undefined,
  second: T | undefined,
): T | undefined {
  return first ?? second;
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

function createPathsConfig(input: {
  readonly cacheDir: string | undefined;
  readonly debugLogDir: string | undefined;
}): CLIConfig["paths"] {
  if (input.cacheDir === undefined && input.debugLogDir === undefined) {
    return undefined;
  }

  return {
    ...(input.cacheDir === undefined ? {} : { cacheDir: input.cacheDir }),
    ...(input.debugLogDir === undefined
      ? {}
      : { debugLogDir: input.debugLogDir }),
  };
}

function createRequestConfig(input: {
  readonly concurrent: number | undefined;
  readonly retryIntervalSeconds: number | undefined;
  readonly retryTimes: number | undefined;
  readonly stream: boolean | undefined;
  readonly temperature: number | readonly number[] | undefined;
  readonly timeout: number | undefined;
  readonly topP: number | readonly number[] | undefined;
}): CLIConfig["request"] {
  if (
    input.concurrent === undefined &&
    input.retryIntervalSeconds === undefined &&
    input.retryTimes === undefined &&
    input.stream === undefined &&
    input.temperature === undefined &&
    input.timeout === undefined &&
    input.topP === undefined
  ) {
    return undefined;
  }

  return {
    ...(input.concurrent === undefined ? {} : { concurrent: input.concurrent }),
    ...(input.retryIntervalSeconds === undefined
      ? {}
      : { retryIntervalSeconds: input.retryIntervalSeconds }),
    ...(input.retryTimes === undefined ? {} : { retryTimes: input.retryTimes }),
    ...(input.stream === undefined ? {} : { stream: input.stream }),
    ...(input.temperature === undefined
      ? {}
      : { temperature: input.temperature }),
    ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
    ...(input.topP === undefined ? {} : { topP: input.topP }),
  };
}

function createQueueConfig(input: {
  readonly concurrent: number | undefined;
}): CLIConfig["queue"] {
  if (input.concurrent === undefined) {
    return undefined;
  }

  return {
    concurrent: input.concurrent,
  };
}

function normalizeString(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

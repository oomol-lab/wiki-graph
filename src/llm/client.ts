import { existsSync, mkdirSync, statSync } from "fs";
import { resolve } from "path";
import { setTimeout as sleep } from "timers/promises";

import {
  APICallError,
  generateText,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
} from "ai";
import type { Environment } from "nunjucks";

import { getLogger } from "../common/logging.js";
import { createEnv } from "../common/template.js";
import { AsyncSemaphore } from "../utils/async-semaphore.js";
import { createHash } from "../utils/hash.js";
import { formatError } from "../utils/node-error.js";
import { LLMCache } from "./cache.js";
import { LLMContext, type LLMContextRequestInput } from "./context.js";
import { LLMPaymentRequiredError } from "./errors.js";
import { createRequestLog } from "./request-log.js";
import { getScopeDefaults, resolveSamplingSetting } from "./sampling.js";
import type {
  LLMessage,
  LLMModel,
  LLMOptions,
  LLMRequestOptions,
  LLMStreamProgressCallback,
  SamplingScopeConfig,
  TemperatureSetting,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 360_000;
const ABORT_ERROR_NAMES = new Set([
  "AbortError",
  "ResponseAborted",
  "TimeoutError",
]);
const RETRYABLE_HTTP_STATUS_CODES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529,
]);
// undici commonly reports transient transport failures through low-level error
// codes and generic `terminated` fetch errors instead of retryable HTTP
// responses. The issues below are representative cases we want to treat as
// retryable at our LLM boundary:
// https://github.com/nodejs/undici/issues/1490
// https://github.com/nodejs/undici/issues/1414
// https://github.com/nodejs/undici/issues/1531
// https://github.com/nodejs/undici/issues/1864
// https://github.com/nodejs/undici/issues/2362
// https://github.com/nodejs/undici/issues/3410
// https://github.com/nodejs/undici/issues/4215
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const RETRYABLE_ERROR_KEYWORDS = [
  "connection",
  "terminated",
  "timeout",
  "network",
  "rate limit",
];

let contextIdCounter = 0;

type LLMRequestSessionInput<S extends string> = Omit<
  LLMContextRequestInput<S>,
  "options"
> &
  LLMRequestOptions<S> & {
    sessionId?: number;
  };

export class LLM<S extends string> {
  readonly #cache: LLMCache | undefined;
  readonly #logDirPath: string | undefined;
  readonly #model: LLMModel;
  readonly #modelProvider: string | undefined;
  readonly #modelId: string;
  readonly #modelIdentity: string;
  readonly #onStreamProgress: LLMStreamProgressCallback | undefined;
  readonly #requestLimiter: AsyncSemaphore;
  readonly #retryIntervalSeconds: number;
  readonly #retryTimes: number;
  readonly #sampling: SamplingScopeConfig<S> | undefined;
  readonly #stream: boolean;
  readonly #templateEnvironment: Environment;
  readonly #temperature: TemperatureSetting;
  readonly #timeoutMs: number;
  readonly #topP: TemperatureSetting;

  public readonly config: Readonly<{
    concurrent: number;
    provider?: string;
    modelId: string;
    sampling?: SamplingScopeConfig<S>;
    stream: boolean;
    timeout: number;
    temperature: TemperatureSetting;
    topP: TemperatureSetting;
  }>;

  public constructor(options: LLMOptions<S>) {
    const concurrent = options.concurrent ?? 1;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const temperature = options.temperature ?? 0.6;
    const topP = options.topP ?? 0.6;
    const sampling = options.sampling;
    const stream = options.stream ?? false;
    const modelInfo = resolveModelInfo(options.model);

    this.config = Object.freeze({
      concurrent,
      modelId: modelInfo.modelId,
      temperature,
      stream,
      timeout,
      topP,
      ...(modelInfo.provider === undefined
        ? {}
        : { provider: modelInfo.provider }),
      ...(sampling === undefined ? {} : { sampling }),
    });
    this.#cache = createCache(options.cacheDirPath);
    this.#logDirPath = ensureDirectoryPath(options.logDirPath);
    this.#model = options.model;
    this.#modelProvider = modelInfo.provider;
    this.#modelId = modelInfo.modelId;
    this.#modelIdentity = modelInfo.identity;
    this.#onStreamProgress = options.onStreamProgress;
    this.#requestLimiter = new AsyncSemaphore(concurrent);
    this.#retryIntervalSeconds = options.retryIntervalSeconds ?? 6;
    this.#retryTimes = options.retryTimes ?? 5;
    this.#sampling = sampling;
    this.#stream = stream;
    this.#templateEnvironment = createEnv(options.dataDirPath);
    this.#temperature = temperature;
    this.#timeoutMs = timeout;
    this.#topP = topP;
  }

  public context(): LLMContext<S> {
    contextIdCounter += 1;
    const sessionId = contextIdCounter;

    return new LLMContext(
      sessionId,
      async (input) =>
        await this.#requestWithSession({
          ...input.options,
          messages: input.messages,
          sessionId,
          ...(input.logFiles === undefined ? {} : { logFiles: input.logFiles }),
          ...(input.pendingCacheEntries === undefined
            ? {}
            : { pendingCacheEntries: input.pendingCacheEntries }),
        }),
      this.#cache,
    );
  }

  public async withContext<T>(
    operation: (context: LLMContext<S>) => Promise<T>,
  ): Promise<T> {
    return await this.context().run(operation);
  }

  public async request(
    messages: readonly LLMessage[],
    options: LLMRequestOptions<S> = {},
  ): Promise<string> {
    return await this.#requestWithSession({
      messages,
      ...options,
    });
  }

  public loadSystemPrompt(
    templateName: string,
    templateContext: Record<string, unknown> = {},
  ): string {
    return this.#templateEnvironment.render(templateName, templateContext);
  }

  async #requestWithSession(input: LLMRequestSessionInput<S>): Promise<string> {
    const defaultSampling = getScopeDefaults(
      input.scope,
      this.#sampling,
      this.#temperature,
      this.#topP,
    );
    const temperature = input.temperature ?? defaultSampling.temperature;
    const topP = input.topP ?? defaultSampling.topP;
    const resolvedTemperature = resolveSamplingSetting(
      temperature,
      "temperature",
      input.retryIndex,
      input.retryMax,
    );
    const resolvedTopP = resolveSamplingSetting(
      topP,
      "top_p",
      input.retryIndex,
      input.retryMax,
    );
    const useCache =
      (input.useCache ?? true) && hasVisibleNonSystemContent(input.messages);
    const cacheKey =
      this.#cache !== undefined && useCache
        ? createHash({
            messages: input.messages.map((message) => ({
              content: message.content,
              role: message.role,
            })),
            modelId: this.#modelId,
            provider: this.#modelProvider ?? null,
            temperature: resolvedTemperature ?? null,
            topP: resolvedTopP ?? null,
          })
        : undefined;
    const requestLog = createRequestLog(this.#logDirPath);

    if (requestLog.filePath !== undefined && input.logFiles !== undefined) {
      input.logFiles.push(requestLog.filePath);
    }

    await requestLog.append(
      formatRequestParameters({
        cacheKey,
        modelId: this.#modelId,
        modelIdentity: this.#modelIdentity,
        modelProvider: this.#modelProvider,
        resolvedTemperature,
        resolvedTopP,
        retryIndex: input.retryIndex,
        retryMax: input.retryMax,
        scope: input.scope,
        sessionId: input.sessionId,
        temperature,
        topP,
      }),
    );
    await requestLog.append(formatRequestMessages(input.messages));

    if (cacheKey !== undefined && this.#cache !== undefined && useCache) {
      const cachedResponse = await this.#cache.read(cacheKey);

      if (cachedResponse !== undefined) {
        getLogger({
          component: "llm",
          scope: input.scope,
          sessionId: input.sessionId,
        }).info(
          `[Cache Hit] Using cached response (key: ${cacheKey.slice(0, 12)}...)`,
        );
        await requestLog.append(
          `[[Response]] (from cache):\n${cachedResponse}\n\n`,
        );
        return cachedResponse;
      }
    }

    let response: string | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#retryTimes; attempt += 1) {
      try {
        response = await this.#requestLimiter.use(async () => {
          const generationInput: {
            maxRetries: number;
            messages: ModelMessage[];
            model: LanguageModel;
            system?: string | SystemModelMessage | SystemModelMessage[];
            temperature?: number;
            timeout?: number;
            topP?: number;
          } = normalizeGenerationInput({
            maxRetries: 0,
            messages: [...input.messages],
            model: this.#model,
            timeout: this.#timeoutMs,
          });

          if (resolvedTemperature !== undefined) {
            generationInput.temperature = resolvedTemperature;
          }

          if (resolvedTopP !== undefined) {
            generationInput.topP = resolvedTopP;
          }

          if (this.#stream) {
            const textChunks: string[] = [];
            const result = streamText(generationInput);

            for await (const chunk of result.textStream) {
              textChunks.push(chunk);
              await this.#emitStreamProgress(chunk.length);
            }
            return textChunks.join("");
          } else {
            const result = await generateText(generationInput);
            await this.#emitStreamProgress(result.text.length);
            return result.text;
          }
        });

        await requestLog.append(`[[Response]]:\n${response}\n\n`);
        break;
      } catch (error) {
        lastError = error;

        if (isPaymentRequiredError(error)) {
          const paymentError = new LLMPaymentRequiredError(undefined, {
            cause: error,
          });

          await requestLog.append(
            `[[Error]]:\n${formatError(paymentError)}\n\n`,
          );
          throw paymentError;
        }

        if (!isRetryableError(error)) {
          await requestLog.append(`[[Error]]:\n${formatError(error)}\n\n`);
          throw error;
        }

        await requestLog.append(
          `[[Warning]]:\nRequest failed with connection error, retrying... (${attempt + 1} times)\n\n`,
        );

        if (attempt < this.#retryTimes && this.#retryIntervalSeconds > 0) {
          await sleep(this.#retryIntervalSeconds * 1000);
        }
      }
    }

    if (response === undefined) {
      const failureMessage =
        lastError === undefined
          ? `LLM request failed after ${this.#retryTimes + 1} attempts`
          : `LLM request failed after ${this.#retryTimes + 1} attempts: ${formatError(lastError)}`;

      await requestLog.append(`[[Error]]:\n${failureMessage}\n\n`);

      throw new Error(failureMessage, {
        ...(lastError === undefined ? {} : { cause: lastError }),
      });
    }

    if (cacheKey !== undefined && this.#cache !== undefined && useCache) {
      const entry = this.#cache.createEntry(cacheKey, response);

      if (
        input.sessionId !== undefined &&
        input.pendingCacheEntries !== undefined
      ) {
        input.pendingCacheEntries.set(entry.cacheKey, entry);
      } else {
        await this.#cache.write(entry);
      }
    }

    return response;
  }

  async #emitStreamProgress(outputCharacters: number): Promise<void> {
    if (this.#onStreamProgress === undefined) {
      return;
    }

    try {
      await this.#onStreamProgress({ outputCharacters });
    } catch {
      return;
    }
  }
}

function normalizeGenerationInput(input: {
  maxRetries: number;
  messages: ModelMessage[];
  model: LanguageModel;
  timeout: number;
}): {
  maxRetries: number;
  messages: ModelMessage[];
  model: LanguageModel;
  system?: string | SystemModelMessage | SystemModelMessage[];
  timeout: number;
} {
  const systemMessages: SystemModelMessage[] = [];
  let firstNonSystemIndex = 0;

  while (firstNonSystemIndex < input.messages.length) {
    const message = input.messages[firstNonSystemIndex];

    if (message === undefined || message.role !== "system") {
      break;
    }

    systemMessages.push(message);
    firstNonSystemIndex += 1;
  }

  if (systemMessages.length === 0) {
    return input;
  }

  if (systemMessages.length === 1) {
    const [systemMessage] = systemMessages;

    if (systemMessage === undefined) {
      return input;
    }

    return {
      ...input,
      messages: input.messages.slice(firstNonSystemIndex),
      system: systemMessage,
    };
  }

  return {
    ...input,
    messages: input.messages.slice(firstNonSystemIndex),
    system: systemMessages,
  };
}

function ensureDirectoryPath(dirPath?: string): string | undefined {
  if (dirPath === undefined) {
    return undefined;
  }

  const resolvedDirPath = resolve(dirPath);

  if (!existsSync(resolvedDirPath)) {
    mkdirSync(resolvedDirPath, { recursive: true });
    return resolvedDirPath;
  }

  if (!statSync(resolvedDirPath).isDirectory()) {
    return undefined;
  }

  return resolvedDirPath;
}

function createCache(cacheDirPath?: string): LLMCache | undefined {
  const resolvedCacheDirPath = ensureDirectoryPath(cacheDirPath);

  if (resolvedCacheDirPath === undefined) {
    return undefined;
  }

  return new LLMCache(resolvedCacheDirPath);
}

function hasVisibleNonSystemContent(messages: readonly LLMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role !== "system" &&
      (typeof message.content !== "string" || message.content.trim() !== ""),
  );
}

function formatRequestParameters(input: {
  cacheKey?: string | undefined;
  modelId: string;
  modelIdentity: string;
  modelProvider?: string | undefined;
  resolvedTemperature: number | undefined;
  resolvedTopP: number | undefined;
  retryIndex?: number | undefined;
  retryMax?: number | undefined;
  scope?: string | undefined;
  sessionId?: number | undefined;
  temperature: TemperatureSetting;
  topP: TemperatureSetting;
}): string {
  const lines = [
    "[[Parameters]]:",
    `\tmodel=${input.modelIdentity}`,
    `\ttemperature=${String(input.resolvedTemperature)}`,
    `\ttop_p=${String(input.resolvedTopP)}`,
  ];

  if (input.modelProvider !== undefined) {
    lines.push(`\tprovider=${input.modelProvider}`);
  }

  lines.push(`\tmodel_id=${input.modelId}`);

  if (input.scope !== undefined) {
    lines.push(`\tscope=${input.scope}`);
  }

  if (Array.isArray(input.temperature)) {
    lines.push(`\ttemperature_schedule=${JSON.stringify(input.temperature)}`);
  }

  if (Array.isArray(input.topP)) {
    lines.push(`\ttop_p_schedule=${JSON.stringify(input.topP)}`);
  }

  if (input.retryIndex !== undefined && input.retryMax !== undefined) {
    lines.push(`\tretry_progress=${input.retryIndex}/${input.retryMax}`);
  }

  if (input.cacheKey !== undefined) {
    lines.push(`\tcache_key=${input.cacheKey}`);
  }

  if (input.sessionId !== undefined) {
    lines.push(`\tsession_id=${input.sessionId}`);
  }

  return `${lines.join("\n")}\n\n`;
}

function formatRequestMessages(messages: readonly LLMessage[]): string {
  const body = messages
    .map(
      (message) =>
        `${capitalize(message.role)}:\n${formatMessageContent(message.content)}`,
    )
    .join("\n\n");

  return `[[Request]]:\n${body}\n\n`;
}

function formatMessageContent(content: LLMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  const serializedContent = JSON.stringify(content, null, 2);

  if (typeof serializedContent === "string") {
    return serializedContent;
  }

  return "";
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function isRetryableError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    if (isPaymentRequiredError(error)) {
      return false;
    }

    if (error.isRetryable) {
      return true;
    }

    return isRetryableStatusCode(error.statusCode);
  }

  return !isAbortLikeError(error) && isRetryableTransportError(error);
}

function isPaymentRequiredError(error: unknown): boolean {
  return APICallError.isInstance(error) && error.statusCode === 402;
}

function isRetryableStatusCode(statusCode: number | undefined): boolean {
  return (
    typeof statusCode === "number" &&
    RETRYABLE_HTTP_STATUS_CODES.has(statusCode)
  );
}

function isAbortLikeError(error: unknown): boolean {
  return someErrorInChain(error, (currentError) =>
    ABORT_ERROR_NAMES.has(currentError.name),
  );
}

function isRetryableTransportError(error: unknown): boolean {
  return someErrorInChain(error, (currentError) => {
    const nodeError = currentError as NodeJS.ErrnoException;
    const errorCode =
      typeof nodeError.code === "string"
        ? nodeError.code.toUpperCase()
        : undefined;

    if (errorCode !== undefined && RETRYABLE_ERROR_CODES.has(errorCode)) {
      return true;
    }

    const errorMessage = currentError.message.toLowerCase();

    return RETRYABLE_ERROR_KEYWORDS.some((keyword) =>
      errorMessage.includes(keyword),
    );
  });
}

function someErrorInChain(
  error: unknown,
  matcher: (error: Error) => boolean,
): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !visited.has(current)) {
    if (matcher(current)) {
      return true;
    }

    visited.add(current);
    current = current.cause;
  }

  return false;
}

function resolveModelInfo(model: LLMModel): {
  readonly identity: string;
  readonly modelId: string;
  readonly provider?: string;
} {
  if (typeof model === "string") {
    return {
      identity: model,
      modelId: model,
    };
  }

  if (hasModelMetadata(model)) {
    return {
      identity:
        model.provider === undefined
          ? model.modelId
          : `${model.provider}:${model.modelId}`,
      modelId: model.modelId,
      ...(model.provider === undefined ? {} : { provider: model.provider }),
    };
  }

  return {
    identity: "unknown-model",
    modelId: "unknown-model",
  };
}

function hasModelMetadata(
  model: LLMModel,
): model is LLMModel & { modelId: string; provider?: string } {
  return (
    typeof model === "object" &&
    model !== null &&
    "modelId" in model &&
    typeof model.modelId === "string" &&
    (!("provider" in model) || typeof model.provider === "string")
  );
}

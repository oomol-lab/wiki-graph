import { setTimeout as sleep } from "timers/promises";

import { createCache, ensureDirectoryPath } from "./files.js";
import { normalizeGenerationInput } from "./generation.js";
import {
  formatRequestMessages,
  formatRequestParameters,
  formatRequestResultLog,
  hasVisibleNonSystemContent,
} from "./log.js";
import { resolveModelInfo } from "./model.js";
import { isPaymentRequiredError, isRetryableError } from "./retry.js";
import {
  generateText,
  streamText,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type SystemModelMessage,
} from "ai";
import type { Environment } from "nunjucks";

import { getLogger } from "../../../runtime/common/logging.js";
import { createEnv } from "../../../runtime/common/template.js";
import { AsyncSemaphore } from "../../../utils/async-semaphore.js";
import { createHash } from "../../../utils/hash.js";
import { formatError } from "../../../utils/node-error.js";
import type { LLMCache } from "../cache.js";
import { LLMContext, type LLMContextRequestInput } from "../context.js";
import { LLMPaymentRequiredError } from "../errors.js";
import { createRequestLog } from "../request-log.js";
import { getScopeDefaults, resolveSamplingSetting } from "../sampling.js";
import type {
  LLMessage,
  LLMModel,
  LLMOptions,
  LLMLazyRequestOperation,
  LLMRequestOptions,
  LLMRequestFunction,
  LLMStreamProgressCallback,
  LLMTokenUsageCallback,
  SamplingScopeConfig,
  TemperatureSetting,
} from "../types.js";

const DEFAULT_TIMEOUT_MS = 360_000;
const DEFAULT_CONCURRENT_REQUESTS = 6;
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
  readonly #lazyRequestLimiter: AsyncSemaphore;
  readonly #logDirPath: string | undefined;
  readonly #model: LLMModel;
  readonly #modelProvider: string | undefined;
  readonly #modelId: string;
  readonly #modelIdentity: string;
  readonly #onStreamProgress: LLMStreamProgressCallback | undefined;
  readonly #onTokenUsage: LLMTokenUsageCallback | undefined;
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
    const concurrent = options.concurrent ?? DEFAULT_CONCURRENT_REQUESTS;
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
    this.#lazyRequestLimiter = new AsyncSemaphore(concurrent);
    this.#logDirPath = ensureDirectoryPath(options.logDirPath);
    this.#model = options.model;
    this.#modelProvider = modelInfo.provider;
    this.#modelId = modelInfo.modelId;
    this.#modelIdentity = modelInfo.identity;
    this.#onStreamProgress = options.onStreamProgress;
    this.#onTokenUsage = options.onTokenUsage;
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
    options?: LLMRequestOptions<S>,
  ): Promise<string>;
  public async request<T>(operation: LLMLazyRequestOperation<S, T>): Promise<T>;
  public async request<T>(
    input: readonly LLMessage[] | LLMLazyRequestOperation<S, T>,
    options: LLMRequestOptions<S> = {},
  ): Promise<string | T> {
    if (typeof input === "function") {
      return await this.#lazyRequestLimiter.use(
        async () => await input(this.#requestOnce),
      );
    }

    return await this.#requestOnce(input, options);
  }

  readonly #requestOnce: LLMRequestFunction<S> = async (
    messages,
    options = {},
  ) =>
    await this.#requestWithSession({
      messages,
      ...options,
    });

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
        await requestLog.append(formatRequestResultLog("cache-hit"));
        return cachedResponse;
      }
    }

    let response: string | undefined;
    let tokenUsage: LanguageModelUsage | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#retryTimes; attempt += 1) {
      try {
        response = await this.#requestLimiter.use(async () => {
          const generationInput: {
            abortSignal?: AbortSignal;
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

          if (input.signal !== undefined) {
            generationInput.abortSignal = input.signal;
          }

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
            tokenUsage = await result.totalUsage;
            await this.#emitTokenUsage(tokenUsage);
            return textChunks.join("");
          } else {
            const result = await generateText(generationInput);

            tokenUsage = result.usage;
            await this.#emitStreamProgress(result.text.length);
            await this.#emitTokenUsage(tokenUsage);
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
          await requestLog.append(formatRequestResultLog(tokenUsage, error));
          throw paymentError;
        }

        if (!isRetryableError(error)) {
          await requestLog.append(`[[Error]]:\n${formatError(error)}\n\n`);
          await requestLog.append(formatRequestResultLog(tokenUsage, error));
          throw error;
        }

        await requestLog.append(
          `[[Warning]]:\nRequest failed with connection error, retrying... (${attempt + 1} times)\n\n`,
        );

        if (attempt < this.#retryTimes && this.#retryIntervalSeconds > 0) {
          await sleep(this.#retryIntervalSeconds * 1000, undefined, {
            signal: input.signal,
          });
        }
      }
    }

    if (response === undefined) {
      const failureMessage =
        lastError === undefined
          ? `LLM request failed after ${this.#retryTimes + 1} attempts`
          : `LLM request failed after ${this.#retryTimes + 1} attempts: ${formatError(lastError)}`;

      await requestLog.append(`[[Error]]:\n${failureMessage}\n\n`);
      await requestLog.append(formatRequestResultLog(tokenUsage, lastError));

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

    await requestLog.append(formatRequestResultLog(tokenUsage));
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

  async #emitTokenUsage(usage: LanguageModelUsage | undefined): Promise<void> {
    if (this.#onTokenUsage === undefined || usage === undefined) {
      return;
    }

    try {
      await this.#onTokenUsage({
        ...(usage.inputTokenDetails.cacheReadTokens === undefined
          ? {}
          : { cacheReadTokens: usage.inputTokenDetails.cacheReadTokens }),
        ...(usage.inputTokens === undefined
          ? {}
          : { inputTokens: usage.inputTokens }),
        ...(usage.outputTokens === undefined
          ? {}
          : { outputTokens: usage.outputTokens }),
      });
    } catch {
      return;
    }
  }
}

import {
  CapacityPool as AsyncSemaphore,
  UsageLedger,
  ProviderRuntime,
  boundedCleanup,
  withSignal,
  ProviderFailure,
} from "wiki-graph-runtime";
import { createCache } from "./files.js";
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

import { getLogger } from "../../../runtime/common/logging.js";
import { createEnv } from "../../../runtime/common/template.js";
import { createHash } from "../../../utils/hash.js";
import { formatError } from "../../../utils/host-error.js";
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
  LLMStreamProvider,
  LLMTokenUsageCallback,
  LLMTokenUsage,
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
  public readonly qualityPolicy: LLMOptions<S>["qualityPolicy"];
  readonly #usageLedger = new UsageLedger();
  readonly #onStatistics: LLMOptions<S>["onStatistics"];
  readonly #cache: LLMCache | undefined;
  readonly #lazyRequestLimiter: AsyncSemaphore;
  readonly #logDirectory:
    | import("../../../runtime/platform/index.js").Directory
    | undefined;
  readonly #model: LLMModel | undefined;
  readonly #modelProvider: string | undefined;
  readonly #modelId: string;
  readonly #modelIdentity: string;
  readonly #onStreamProgress: LLMStreamProgressCallback | undefined;
  readonly #onTokenUsage: LLMTokenUsageCallback | undefined;
  readonly #streamProvider: LLMStreamProvider<S> | undefined;
  readonly #requestLimiter: AsyncSemaphore;
  readonly #retryIntervalSeconds: number;
  readonly #retryTimes: number;
  readonly #providerRuntime: ProviderRuntime;
  readonly #sampling: SamplingScopeConfig<S> | undefined;
  readonly #stream: boolean;
  readonly #templateEnvironment: ReturnType<typeof createEnv>;
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
    if (
      (options.model === undefined) ===
      (options.streamProvider === undefined)
    ) {
      throw new Error("LLM requires exactly one of model or streamProvider.");
    }
    const concurrent = options.concurrent ?? DEFAULT_CONCURRENT_REQUESTS;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const temperature = options.temperature ?? 0.6;
    const topP = options.topP ?? 0.6;
    const sampling = options.sampling;
    const stream = options.stream ?? true;
    const modelInfo =
      options.streamProvider === undefined
        ? resolveModelInfo(options.model!)
        : {
            identity: `${options.streamProvider.identity ?? "injected"}:${options.streamProvider.model}`,
            modelId: options.streamProvider.model,
            provider: options.streamProvider.identity ?? "injected",
          };

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
    this.#onStatistics = options.onStatistics;
    this.qualityPolicy = options.qualityPolicy;
    this.#cache = createCache(options.cacheDirectory);
    this.#lazyRequestLimiter = new AsyncSemaphore(concurrent);
    this.#logDirectory = options.logDirectory;
    this.#model = options.model;
    this.#modelProvider = modelInfo.provider;
    this.#modelId = modelInfo.modelId;
    this.#modelIdentity = modelInfo.identity;
    this.#onStreamProgress = options.onStreamProgress;
    this.#onTokenUsage = options.onTokenUsage;
    this.#streamProvider = options.streamProvider;
    this.#requestLimiter = new AsyncSemaphore(concurrent);
    this.#providerRuntime = new ProviderRuntime({ concurrency: concurrent });
    this.#retryIntervalSeconds = options.retryIntervalSeconds ?? 6;
    this.#retryTimes = options.retryTimes ?? 5;
    this.#sampling = sampling;
    this.#stream = stream;
    this.#templateEnvironment = createEnv();
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
    const requestLog = createRequestLog(this.#logDirectory);

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

    let transportAttempts = 0;
    let response: string;
    let tokenUsage: LLMTokenUsage | undefined;
    try {
      response = await this.#providerRuntime.run(
        async (signal) =>
          await this.#requestLimiter.use(async (lease) => {
            const accounting = this.#usageLedger.begin();
            const publish = async () => {
              try {
                await this.#onStatistics?.(this.#usageLedger.snapshot());
              } catch (error) {
                throw new ProviderFailure({
                  code: "OBSERVER_FAILED",
                  cause: error,
                });
              }
            };
            tokenUsage = undefined;
            try {
              const generate = async () => {
                if (this.#streamProvider !== undefined) {
                  const textChunks: string[] = [];
                  signal?.throwIfAborted();
                  const iterator = this.#streamProvider
                    .stream(input.messages, {
                      ...(signal === undefined ? {} : { signal: signal }),
                      ...(input.scope === undefined
                        ? {}
                        : { scope: input.scope }),
                      ...(input.retryIndex === undefined
                        ? {}
                        : { retryIndex: input.retryIndex }),
                      ...(input.retryMax === undefined
                        ? {}
                        : { retryMax: input.retryMax }),
                      ...(resolvedTemperature === undefined
                        ? {}
                        : { temperature: resolvedTemperature }),
                      ...(resolvedTopP === undefined
                        ? {}
                        : { topP: resolvedTopP }),
                    })
                    [Symbol.asyncIterator]();
                  let pending: Promise<unknown> = Promise.resolve();
                  try {
                    while (true) {
                      const next = iterator.next();
                      pending = next;
                      const result = await withSignal(next, signal);
                      signal?.throwIfAborted();
                      if (result.done) {
                        break;
                      }
                      const event = result.value;
                      if (event.type === "text-delta") {
                        textChunks.push(event.text);
                        await this.#emitStreamProgress(event.text.length);
                      } else {
                        tokenUsage = event.usage;
                        accounting.record(event.usage);
                        await publish();
                        await this.#emitTokenUsage(event.usage);
                      }
                    }
                  } catch (error) {
                    const closing = Promise.resolve().then(() =>
                      iterator.return?.(),
                    );
                    lease.retainUntil(Promise.allSettled([pending, closing]));
                    if (!(await boundedCleanup(() => closing))) {
                      throw new ProviderFailure({
                        code: "RESOURCE_CLEANUP_TIMEOUT",
                        cause: error,
                      });
                    }
                    throw error;
                  }
                  signal?.throwIfAborted();
                  return textChunks.join("");
                }

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
                  model: this.#model!,
                  timeout: this.#timeoutMs,
                });

                if (signal !== undefined) {
                  generationInput.abortSignal = signal;
                }

                if (resolvedTemperature !== undefined) {
                  generationInput.temperature = resolvedTemperature;
                }

                if (resolvedTopP !== undefined) {
                  generationInput.topP = resolvedTopP;
                }

                if (this.#stream) {
                  const textChunks: string[] = [];
                  let streamError: unknown;
                  const result = streamText({
                    ...generationInput,
                    onError: ({ error }) => {
                      streamError = error;
                    },
                  });

                  for await (const chunk of result.textStream) {
                    textChunks.push(chunk);
                    await this.#emitStreamProgress(chunk.length);
                  }

                  if (streamError !== undefined) {
                    throw streamError instanceof Error
                      ? streamError
                      : new Error(formatError(streamError), {
                          cause: streamError,
                        });
                  }

                  tokenUsage = toLLMTokenUsage(await result.totalUsage);
                  if (tokenUsage) accounting.record(tokenUsage);
                  await publish();
                  await this.#emitTokenUsage(tokenUsage);
                  return textChunks.join("");
                } else {
                  const result = await generateText(generationInput);

                  tokenUsage = toLLMTokenUsage(result.usage);
                  if (tokenUsage) accounting.record(tokenUsage);
                  await publish();
                  await this.#emitStreamProgress(result.text.length);
                  await this.#emitTokenUsage(tokenUsage);
                  return result.text;
                }
              };
              const result = await generate();
              if (input.candidate)
                input.candidate.defer(
                  async () => {
                    accounting.finish("accepted");
                    await publish();
                  },
                  async () => {
                    accounting.finish("rejected");
                    await publish();
                  },
                );
              else accounting.finish("unclassified");
              await publish();
              return result;
            } catch (error) {
              accounting.finish("rejected");
              try {
                await publish();
              } catch {
                /* Preserve the first failure. */
              }
              throw error;
            }
          }, signal),
        {
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
          policy: {
            retries: this.#retryTimes,
            delayMs: this.#retryIntervalSeconds * 1000,
            backoff: "fixed",
            jitter: false,
            totalTimeoutMs: this.#timeoutMs,
            maxRetryWaitMs:
              this.#retryTimes * this.#retryIntervalSeconds * 1000,
          },
          onEvent: (event) => {
            transportAttempts = event.transportAttempt;
          },
          retryable: isRetryableError,
        },
      );
      await requestLog.append(`[[Response]]:\n${response}\n\n`);
    } catch (error) {
      const failure = isPaymentRequiredError(error)
        ? new LLMPaymentRequiredError(undefined, { cause: error })
        : transportAttempts > this.#retryTimes && isRetryableError(error)
          ? new Error(
              `LLM request failed after ${transportAttempts} attempts: ${formatError(error)}`,
              { cause: error },
            )
          : error;
      await requestLog.append(`[[Error]]:\n${formatError(failure)}\n\n`);
      await requestLog.append(formatRequestResultLog(tokenUsage, error));
      throw failure;
    }

    if (cacheKey !== undefined && this.#cache !== undefined && useCache) {
      const entry = this.#cache.createEntry(cacheKey, response);

      const publish = async () => {
        if (
          input.sessionId !== undefined &&
          input.pendingCacheEntries !== undefined
        ) {
          input.pendingCacheEntries.set(entry.cacheKey, entry);
        } else {
          await this.#cache!.write(entry);
        }
      };
      if (input.candidate) input.candidate.defer(publish);
      else await publish();
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

  async #emitTokenUsage(usage: LLMTokenUsage | undefined): Promise<void> {
    if (this.#onTokenUsage === undefined || usage === undefined) {
      return;
    }

    try {
      await this.#onTokenUsage(usage);
    } catch {
      return;
    }
  }
}

function toLLMTokenUsage(
  usage: LanguageModelUsage | undefined,
): LLMTokenUsage | undefined {
  if (usage === undefined) return undefined;
  return {
    ...(usage.inputTokenDetails.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: usage.inputTokenDetails.cacheReadTokens }),
    ...(usage.inputTokens === undefined
      ? {}
      : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined
      ? {}
      : { outputTokens: usage.outputTokens }),
  };
}

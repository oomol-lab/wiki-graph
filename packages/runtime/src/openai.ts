import type { ResourceLease } from "./capacity.js";
import type { CandidateAcceptance } from "./candidate.js";
import { UsageLedger, type UsageSnapshot } from "./usage.js";
import { ProviderFailure, retryAfterMilliseconds } from "./errors.js";
import { boundedCleanup, withSignal } from "./lifecycle.js";
import { ProviderRuntime, type RequestOptions } from "./request.js";

export interface TokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
}
export interface CompletionOptions extends RequestOptions {
  readonly candidate?: CandidateAcceptance;
  readonly onStatistics?: (snapshot: UsageSnapshot) => Promise<void> | void;
  readonly url: string;
  readonly model: string;
  readonly messages: readonly {
    readonly role: string;
    readonly content: string;
  }[];
  readonly headers?: HeadersInit;
  readonly temperature?: number;
  readonly topP?: number;
  readonly fetch?: typeof fetch;
  readonly onUsage?: (
    usage: TokenUsage,
    attempt: number,
  ) => void | Promise<void>;
}

/** A retry only publishes a complete candidate. Failed attempts never leak text. */
export function createOpenAICompletion(
  runtime = new ProviderRuntime(),
  ledger = new UsageLedger(),
): (options: CompletionOptions) => Promise<string> {
  return async (options) =>
    await runtime.run(async (signal, attempt, lease, context) => {
      const accounting = ledger.begin();
      const publish = async () => {
        const previous = context.phase;
        context.phase = "persistence";
        try {
          await options.onStatistics?.(ledger.snapshot());
          context.phase = previous;
        } catch (error) {
          throw new ProviderFailure({ code: "OBSERVER_FAILED", cause: error });
        }
      };
      try {
        const fetching = (options.fetch ?? fetch)(options.url, {
          method: "POST",
          signal,
          headers: {
            ...Object.fromEntries(new Headers(options.headers)),
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            messages: options.messages,
            stream: true,
            stream_options: { include_usage: true },
            temperature: options.temperature,
            top_p: options.topP,
          }),
        });
        let response: Response;
        try {
          response = await withSignal(fetching, signal);
        } catch (error) {
          lease.retainUntil(
            fetching.then((response) => response.body?.cancel()),
          );
          throw error;
        }
        context.phase = "response";
        if (!response.ok) {
          let payload: unknown;
          try {
            payload = JSON.parse(
              await readLimitedBody(response, signal, lease),
            );
          } catch (error) {
            if (
              error instanceof ProviderFailure &&
              error.code === "RESOURCE_CLEANUP_TIMEOUT"
            )
              throw error;
            signal.throwIfAborted();
            /* Status remains authoritative. */
          }
          throw responseFailure(
            response.status,
            payload,
            response.headers.get("retry-after"),
          );
        }
        if (!response.body) throw new ProviderFailure({ code: "EMPTY_STREAM" });
        context.phase = "stream";
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let data: string[] = [];
        let text = "";
        let complete = false;
        let doneEvent = false;
        let cleanupAttempted = false;
        let eof = false;
        let readFailed = false;
        let pendingRead: Promise<unknown> = Promise.resolve();
        const close = async (reason?: unknown) => {
          // An errored stream is already closed; cancel would reject again.
          if (readFailed) return true;
          const previous = context.phase;
          context.phase = "cleanup";
          const closing = Promise.resolve().then(() => reader.cancel(reason));
          lease.retainUntil(Promise.allSettled([pendingRead, closing]));
          const completed = await boundedCleanup(() => closing);
          if (completed) context.phase = previous;
          return completed;
        };
        const consumeEvent = async () => {
          if (!data.length) return;
          const raw = data.join("\n");
          data = [];
          if (raw.trim() === "[DONE]") {
            complete = true;
            doneEvent = true;
            return;
          }
          const value = JSON.parse(raw) as Record<string, unknown>;
          if (value.error !== undefined)
            throw responseFailure(200, value, null);
          const usage = readUsage(value.usage);
          if (usage) {
            accounting.record(usage);
            await publish();
            try {
              await options.onUsage?.(usage, attempt + 1);
            } catch (error) {
              throw new ProviderFailure({
                code: "OBSERVER_FAILED",
                cause: error,
              });
            }
          }
          if (!Array.isArray(value.choices))
            throw new ProviderFailure({ code: "INVALID_STREAM" });
          const choice = value.choices[0] as
            | { delta?: { content?: unknown }; finish_reason?: unknown }
            | undefined;
          if (!choice) return;
          if (choice.finish_reason != null) complete = true;
          const content = choice.delta?.content;
          if (content != null && typeof content !== "string")
            throw new ProviderFailure({ code: "INVALID_STREAM" });
          if (typeof content === "string") text += content;
        };
        const feed = async (chunk: string, flush = false) => {
          buffer += chunk;
          if (buffer.length > 1_048_576)
            throw new ProviderFailure({ code: "STREAM_EVENT_TOO_LARGE" });
          let index: number;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index).replace(/\r$/u, "");
            buffer = buffer.slice(index + 1);
            if (line === "") await consumeEvent();
            else if (line.startsWith("data:"))
              data.push(line.slice(5).replace(/^ /u, ""));
            if (data.reduce((size, part) => size + part.length, 0) > 1_048_576)
              throw new ProviderFailure({ code: "STREAM_EVENT_TOO_LARGE" });
          }
          if (flush) {
            if (buffer.startsWith("data:"))
              data.push(buffer.slice(5).trimStart());
            await consumeEvent();
          }
        };
        try {
          while (true) {
            const reading = reader.read().catch((error: unknown) => {
              readFailed = true;
              throw error;
            });
            pendingRead = reading;
            const result = await withSignal(reading, signal);
            if (result.done) {
              eof = true;
              break;
            }
            await feed(decoder.decode(result.value, { stream: true }));
            if (doneEvent) break;
          }
          await feed(decoder.decode(), true);
          if (!complete) throw new ProviderFailure({ code: "UND_ERR_SOCKET" });
          cleanupAttempted = true;
          if (!eof && !(await close())) {
            throw new ProviderFailure({ code: "RESOURCE_CLEANUP_TIMEOUT" });
          }
          if (options.candidate)
            options.candidate.defer(
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
          return text;
        } catch (error) {
          if (!eof && !cleanupAttempted && !(await close(error))) {
            throw new ProviderFailure({
              code: "RESOURCE_CLEANUP_TIMEOUT",
              cause: error,
            });
          }
          throw error;
        } finally {
          // releaseLock does not free an uncooperative reader; cleanup timeout stops replay.
          try {
            reader.releaseLock();
          } catch {
            /* Preserve the primary failure. */
          }
        }
      } catch (error) {
        accounting.finish("rejected");
        try {
          await publish();
        } catch {
          /* Preserve the first provider/persistence failure. */
        }
        throw error;
      }
    }, options);
}

export function responseFailure(
  statusCode: number,
  payload: unknown,
  retryAfter: string | null,
): ProviderFailure {
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const error =
    root.error && typeof root.error === "object"
      ? (root.error as Record<string, unknown>)
      : root;
  const code =
    typeof error.code === "string"
      ? error.code
      : typeof error.type === "string"
        ? error.type
        : undefined;
  const retryAfterMs = retryAfterMilliseconds(retryAfter);
  return new ProviderFailure({
    statusCode,
    ...(code === undefined ? {} : { code }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
}

async function readLimitedBody(
  response: Response,
  signal: AbortSignal,
  lease: ResourceLease,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let readFailed = false;
  let pendingRead: Promise<unknown> = Promise.resolve();
  try {
    while (result.length < 16_384) {
      const reading = reader.read().catch((error: unknown) => {
        readFailed = true;
        throw error;
      });
      pendingRead = reading;
      const chunk = await withSignal(reading, signal);
      if (chunk.done) return result + decoder.decode();
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result.slice(0, 16_384);
  } finally {
    const closing = Promise.resolve().then(() =>
      readFailed ? undefined : reader.cancel(),
    );
    lease.retainUntil(Promise.allSettled([pendingRead, closing]));
    if (!(await boundedCleanup(() => closing))) {
      // A stuck body must stop retries; the lease retains the connection.
      // eslint-disable-next-line no-unsafe-finally
      throw new ProviderFailure({
        code: "RESOURCE_CLEANUP_TIMEOUT",
        cause: responseFailure(response.status, undefined, null),
      });
    }
    reader.releaseLock();
  }
}

function readUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const details = usage.prompt_tokens_details as
    | Record<string, unknown>
    | undefined;
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries({
    inputTokens: usage.prompt_tokens ?? usage.input_tokens,
    outputTokens: usage.completion_tokens ?? usage.output_tokens,
    cacheReadTokens: details?.cached_tokens ?? usage.cache_read_input_tokens,
  })) {
    if (typeof item === "number" && Number.isFinite(item) && item >= 0)
      output[key] = item;
  }
  return Object.keys(output).length ? output : undefined;
}

import type { ResourceLease } from "./capacity.js";
import { ProviderFailure } from "./errors.js";
import { boundedCleanup, withSignal } from "./lifecycle.js";
import { responseFailure } from "./openai.js";
import { ProviderRuntime, type RequestOptions } from "./request.js";

export interface JsonRequestOptions extends RequestOptions {
  readonly url: string;
  readonly body: unknown;
  readonly headers?: HeadersInit;
  readonly fetch?: typeof fetch;
  readonly maxResponseBytes?: number;
}

/** Retry the complete JSON response, including interrupted body reads. */
export function createJsonRequest(
  runtime = new ProviderRuntime(),
): (options: JsonRequestOptions) => Promise<unknown> {
  return async (options) => {
    const limit = options.maxResponseBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new RangeError("Invalid JSON response limit");
    const body = JSON.stringify(options.body);
    return await runtime.run(async (signal, _, lease, context) => {
      const fetching = (options.fetch ?? fetch)(options.url, {
        method: "POST",
        headers: {
          ...Object.fromEntries(new Headers(options.headers)),
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body,
        signal,
      });
      let response: Response;
      try {
        response = await withSignal(fetching, signal);
      } catch (error) {
        lease.retainUntil(fetching.then((late) => late.body?.cancel()));
        throw error;
      }
      context.phase = "response";
      let payload: unknown;
      try {
        payload = JSON.parse(
          await readBody(response, signal, lease, response.ok ? limit : 16_384),
        );
      } catch (error) {
        signal.throwIfAborted();
        if (
          response.ok ||
          (error instanceof ProviderFailure &&
            error.code === "RESOURCE_CLEANUP_TIMEOUT")
        )
          throw error;
        // HTTP status is authoritative even when its error body is malformed.
      }
      if (!response.ok)
        throw responseFailure(
          response.status,
          payload,
          response.headers.get("retry-after"),
        );
      return payload;
    }, options);
  };
}

async function readBody(
  response: Response,
  signal: AbortSignal,
  lease: ResourceLease,
  limit: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  let eof = false;
  let readFailed = false;
  let failure: unknown;
  let pending: Promise<unknown> = Promise.resolve();
  try {
    while (true) {
      const reading = reader.read().catch((error: unknown) => {
        readFailed = true;
        throw error;
      });
      pending = reading;
      const chunk = await withSignal(reading, signal);
      if (chunk.done) {
        eof = true;
        return parts.join("") + decoder.decode();
      }
      size += chunk.value.byteLength;
      if (size > limit)
        throw new ProviderFailure({ code: "RESPONSE_TOO_LARGE" });
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // A rejected read means the stream is already errored. Cancelling it would
    // only reject with that same stored error, not perform additional cleanup.
    if (!eof && !readFailed) {
      const closing = Promise.resolve().then(() => reader.cancel(failure));
      lease.retainUntil(Promise.allSettled([pending, closing]));
      if (!(await boundedCleanup(() => closing))) {
        // eslint-disable-next-line no-unsafe-finally
        throw new ProviderFailure({
          code: "RESOURCE_CLEANUP_TIMEOUT",
          cause: failure,
        });
      }
    }
    reader.releaseLock();
  }
}

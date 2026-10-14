export const DEFAULT_WIKIMEDIA_TIMEOUT_MS = 120_000;

export class WikimediaTimeoutError extends Error {
  public readonly code = "WIKIMEDIA_TIMEOUT";
  public readonly timeoutMs: number;

  public constructor(timeoutMs: number) {
    super(`Wikimedia request timed out after ${timeoutMs}ms`);
    this.name = "WikimediaTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function createWikimediaRequest(
  signal?: AbortSignal,
  timeoutMs = DEFAULT_WIKIMEDIA_TIMEOUT_MS,
): { signal: AbortSignal; close(): void } {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Wikimedia timeoutMs must be a positive finite number");
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted === true) abort();
  const timer = setTimeout(
    () => controller.abort(new WikimediaTimeoutError(timeoutMs)),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

/** Settle even when a custom transport ignores cancellation. */
export async function awaitWikimediaRequest<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return await promise;
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      // Preserve the caller's AbortSignal reason, which may be a non-Error.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      },
    );
  });
}

/** Cleanup is best effort: a broken transport must not delay settlement. */
export function cancelWikimediaBody(
  body: { cancel(): Promise<unknown> | void } | null,
): void {
  try {
    void Promise.resolve(body?.cancel()).catch(() => undefined);
  } catch {
    /* already closed */
  }
}

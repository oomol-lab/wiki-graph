export function isTextResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type");

  if (contentType === null) {
    return false;
  }

  return /(?:json|text|xml|javascript|html)/iu.test(contentType);
}

export class WikimediaRequestError extends Error {
  public readonly retryAfterMs: number | undefined;
  public readonly status: number;
  public readonly url: URL;

  public constructor(
    url: URL,
    status: number,
    retryAfterMs: number | undefined,
  ) {
    super(`Wikimedia request failed with ${status}: ${url.toString()}`);
    this.retryAfterMs = retryAfterMs;
    this.status = status;
    this.url = url;
  }
}
export function isRetryableError(error: unknown): boolean {
  if (error instanceof WikimediaRequestError) {
    return (
      error.status === 429 ||
      error.status === 500 ||
      error.status === 502 ||
      error.status === 503 ||
      error.status === 504
    );
  }

  return error instanceof TypeError;
}

export function getRetryDelayMs(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
): number {
  if (
    error instanceof WikimediaRequestError &&
    error.retryAfterMs !== undefined
  ) {
    return error.retryAfterMs;
  }

  if (baseDelayMs <= 0) {
    return 0;
  }

  const exponentialDelayMs = baseDelayMs * 2 ** attempt;
  const jitterMs = Math.floor(Math.random() * Math.min(baseDelayMs, 250));

  return exponentialDelayMs + jitterMs;
}

export async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

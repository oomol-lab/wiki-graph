import { APICallError } from "ai";

const ABORT_ERROR_NAMES = new Set([
  "AbortError",
  "ResponseAborted",
  "TimeoutError",
]);
const RETRYABLE_HTTP_STATUS_CODES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529,
]);
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

export function isRetryableError(error: unknown): boolean {
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

export function isPaymentRequiredError(error: unknown): boolean {
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

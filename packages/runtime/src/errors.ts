export interface SafeError {
  readonly name?: string;
  readonly code?: string;
  readonly syscall?: string;
  readonly statusCode?: number;
  readonly causes?: readonly SafeError[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Bounded exception graph; messages, addresses, headers and bodies never escape. */
export function safeErrorGraph(error: unknown): SafeError {
  const seen = new Set<unknown>();
  let remaining = 16;
  const visit = (value: unknown, depth: number): SafeError => {
    const item = record(value);
    if (!item || seen.has(value) || depth > 5 || remaining-- <= 0) return {};
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const key of ["name", "code", "syscall"]) {
      const token =
        key === "code" ? (item.code ?? item.providerCode) : item[key];
      if (typeof token === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(token))
        result[key] = token;
    }
    const status = item.statusCode ?? item.status;
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
    )
      result.statusCode = status;
    const children = [
      item.cause,
      ...(Array.isArray(item.errors)
        ? (item.errors as unknown[]).slice(0, 8)
        : []),
    ].filter((child) => record(child) && !seen.has(child));
    if (children.length && depth < 5 && remaining > 0)
      result.causes = children.map((child) => visit(child, depth + 1));
    return result as SafeError;
  };
  try {
    return visit(error, 0);
  } catch {
    return {};
  }
}

export class ProviderFailure extends Error {
  public readonly statusCode: number | undefined;
  public readonly code: string | undefined;
  public readonly retryAfterMs: number | undefined;
  public constructor(options: {
    statusCode?: number;
    code?: string;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super("Provider request failed", { cause: options.cause });
    this.name = "ProviderFailure";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export type FailureKind =
  | "cancelled"
  | "terminal"
  | "rate-limit"
  | "transient"
  | "unknown";
const temporaryCodes = new Set([
  "server_error",
  "service_unavailable",
  "overloaded_error",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const terminalCodes = new Set([
  "insufficient_balance",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "insufficient_quota",
  "quota_exceeded",
  "billing_not_active",
  "BALANCE_EXHAUSTED",
  "invalid_api_key",
  "RESOURCE_CLEANUP_TIMEOUT",
]);
const temporaryStatuses = new Set([
  408, 409, 425, 500, 502, 503, 504, 520, 522, 524, 529,
]);

export function classifyFailure(error: unknown): FailureKind {
  const seen = new Set<unknown>();
  const pending = [error];
  let kind: FailureKind = "unknown";
  while (pending.length && seen.size < 32) {
    const value = pending.shift();
    const item = record(value);
    if (!item || seen.has(value)) continue;
    seen.add(value);
    const code = item.providerCode ?? item.code;
    const status = item.statusCode ?? item.status;
    if (
      [401, 402, 403].includes(status as number) ||
      terminalCodes.has(code as string)
    )
      return "terminal";
    if (item.name === "AbortError") kind = "cancelled";
    else if (kind !== "cancelled") {
      if (item.name === "TypeError" && item.message === "fetch failed")
        kind = "transient";
      if (status === 429 || code === "rate_limit_exceeded") kind = "rate-limit";
      else if (
        kind !== "rate-limit" &&
        (temporaryStatuses.has(status as number) ||
          temporaryCodes.has(code as string) ||
          item.isRetryable === true)
      )
        kind = "transient";
    }
    pending.push(
      item.cause,
      ...(Array.isArray(item.errors)
        ? (item.errors as unknown[]).slice(0, 8)
        : []),
    );
  }
  return kind;
}

export function retryAfterMilliseconds(
  value: string | null,
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

/** Observability is best effort; business callbacks must not use this helper. */
export function observe<T>(
  sink: ((event: T) => void) | undefined,
  event: T,
): void {
  try {
    const result: unknown = sink?.(event);
    if (result instanceof Promise) void result.catch(() => {});
  } catch {
    /* A logger cannot fail an operation. */
  }
}

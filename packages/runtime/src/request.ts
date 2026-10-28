import {
  classifyFailure,
  observe,
  safeErrorGraph,
  type SafeError,
} from "./errors.js";
import { abortableDelay, requestBudget } from "./lifecycle.js";

export interface RequestEvent {
  readonly event:
    | "provider.attempt"
    | "provider.retry"
    | "provider.success"
    | "provider.failure";
  readonly logicalRequestId: string;
  readonly attemptId: string;
  readonly transportAttempt: number;
  readonly contentRound?: number;
  readonly delayMs?: number;
  readonly error?: SafeError;
}
export interface RequestPolicy {
  readonly retries?: number;
  readonly delayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoff?: "fixed" | "exponential";
  readonly jitter?: boolean;
  readonly totalTimeoutMs?: number;
  readonly maxRetryWaitMs?: number;
}
export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly deadline?: number;
  readonly contentRound?: number;
  readonly policy?: RequestPolicy;
  readonly onEvent?: (event: RequestEvent) => void;
  readonly retryable?: (error: unknown) => boolean;
}

/** Shared per credential/provider scope, never a process-wide singleton. */
export class ProviderRuntime {
  #cooldownUntil = 0;
  public async run<T>(
    operation: (signal: AbortSignal, attempt: number) => Promise<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    const policy = options.policy ?? {};
    const retries = policy.retries ?? 2;
    const delay = policy.delayMs ?? 1000;
    const waitLimit = policy.maxRetryWaitMs ?? 60_000;
    if (
      !Number.isInteger(retries) ||
      retries < 0 ||
      !Number.isFinite(delay) ||
      delay < 0 ||
      !Number.isFinite(waitLimit) ||
      waitLimit < 0
    )
      throw new RangeError("Invalid request policy");
    for (const value of [
      policy.maxDelayMs ?? 30_000,
      policy.totalTimeoutMs ?? 360_000,
    ]) {
      if (!Number.isFinite(value) || value < 0)
        throw new RangeError("Invalid request policy");
    }
    if (options.deadline !== undefined && !Number.isFinite(options.deadline))
      throw new RangeError("Invalid deadline");
    const deadline =
      options.deadline ?? Date.now() + (policy.totalTimeoutMs ?? 360_000);
    const budget = requestBudget(options.signal, deadline);
    const logicalRequestId = crypto.randomUUID();
    let waited = 0;
    try {
      for (let attempt = 0; ; attempt++) {
        budget.signal.throwIfAborted();
        const cooldown = Math.max(0, this.#cooldownUntil - Date.now());
        if (cooldown > 0) {
          if (waited + cooldown > waitLimit)
            throw new Error("Provider retry waiting budget exhausted");
          waited += cooldown;
          await abortableDelay(cooldown, budget.signal);
        }
        const base = {
          ...(options.contentRound === undefined
            ? {}
            : { contentRound: options.contentRound }),
          logicalRequestId,
          attemptId: crypto.randomUUID(),
          transportAttempt: attempt + 1,
        };
        observe(options.onEvent, { ...base, event: "provider.attempt" });
        try {
          // Operation must settle its resources before returning or rejecting.
          const result = await operation(budget.signal, attempt);
          budget.signal.throwIfAborted();
          observe(options.onEvent, { ...base, event: "provider.success" });
          return result;
        } catch (error) {
          if (budget.signal.aborted) throw budget.signal.reason;
          const kind = classifyFailure(error);
          const retryable =
            kind === "transient" ||
            kind === "rate-limit" ||
            (kind === "unknown" && options.retryable?.(error) === true);
          if (!retryable || attempt >= retries) {
            observe(options.onEvent, {
              ...base,
              event: "provider.failure",
              error: safeErrorGraph(error),
            });
            throw error;
          }
          const retryAfter = (error as { retryAfterMs?: number } | null)
            ?.retryAfterMs;
          const exponential = Math.min(
            policy.maxDelayMs ?? 30_000,
            delay * (policy.backoff === "fixed" ? 1 : 2 ** attempt),
          );
          const sleep = Math.max(
            typeof retryAfter === "number" && Number.isFinite(retryAfter)
              ? retryAfter
              : 0,
            policy.jitter === false
              ? exponential
              : exponential * (0.5 + Math.random() * 0.5),
          );
          if (waited + sleep > waitLimit) throw error;
          observe(options.onEvent, {
            ...base,
            event: "provider.retry",
            delayMs: sleep,
            error: safeErrorGraph(error),
          });
          if (kind === "rate-limit")
            this.#cooldownUntil = Math.max(
              this.#cooldownUntil,
              Date.now() + sleep,
            );
          waited += sleep;
          await abortableDelay(sleep, budget.signal);
        }
      }
    } finally {
      budget.close();
    }
  }
}

export class RequestDeadlineError extends Error {
  public readonly code = "REQUEST_DEADLINE";
  public constructor() {
    super("Provider operation exceeded its deadline");
    this.name = "RequestDeadlineError";
  }
}

export function requestBudget(
  signal?: AbortSignal,
  deadline?: number,
): {
  readonly signal: AbortSignal;
  close(): void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer =
    deadline === undefined
      ? undefined
      : setTimeout(
          () => controller.abort(new RequestDeadlineError()),
          Math.max(0, deadline - Date.now()),
        );
  if (deadline !== undefined && deadline <= Date.now())
    controller.abort(new RequestDeadlineError());
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

export async function abortableDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer); // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      reject(signal?.reason);
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Does not release a resource/permit: callers must still drain or quarantine work. */
export async function withSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    throw signal.reason;
  }
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A failed close must not replace the operation's primary failure. */
export async function boundedCleanup(
  close: () => Promise<unknown>,
  timeoutMs = 5000,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(close)
        .then(
          () => true,
          () => false,
        ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class ExecutionScope {
  readonly #controller = new AbortController();
  #fatal: unknown;
  #hasFatal = false;
  public get signal(): AbortSignal {
    return this.#controller.signal;
  }
  public fail(error: unknown): void {
    if (!this.#hasFatal) {
      this.#hasFatal = true;
      this.#fatal = error;
    }
    this.#controller.abort(this.#fatal);
  }
  public throwIfFailed(): void {
    if (this.#hasFatal) throw this.#fatal;
  }
}

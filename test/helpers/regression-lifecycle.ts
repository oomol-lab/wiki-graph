import { AsyncLocalStorage } from "async_hooks";
import { onTestFinished } from "vitest";

/** A test timeout rejects the runner's wait; it does not stop the test promise. */
export class RegressionLifecycle {
  readonly #controller = new AbortController();
  readonly #tasks = new Set<Promise<unknown>>();
  readonly #cleanup: Array<() => Promise<void> | void> = [];
  #disposing: Promise<void> | undefined;

  public get signal(): AbortSignal {
    return this.#controller.signal;
  }

  public defer(cleanup: () => Promise<void> | void): void {
    this.#cleanup.push(cleanup);
  }

  public track<T>(operation: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    const task = Promise.resolve().then(operation);
    this.#tasks.add(task);
    void task.then(
      () => this.#tasks.delete(task),
      () => this.#tasks.delete(task),
    );
    return task;
  }

  public dispose(): Promise<void> {
    return (this.#disposing ??= this.#dispose());
  }

  async #dispose(): Promise<void> {
    this.#controller.abort(new Error("Regression test finished or timed out"));
    const failures: unknown[] = [];
    // Join the real body (including setup and finally), not a timeout race.
    const results = await Promise.allSettled([...this.#tasks]);
    for (const result of results)
      if (result.status === "rejected") failures.push(result.reason);
    for (const cleanup of this.#cleanup.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Regression operation/cleanup failed");
  }
}

const context = new AsyncLocalStorage<RegressionLifecycle>();

export function regressionLifecycle(): RegressionLifecycle {
  const value = context.getStore();
  if (value === undefined) throw new Error("Missing regression test lifecycle");
  return value;
}

export function regressionSignal(): AbortSignal | undefined {
  return context.getStore()?.signal;
}

/** Teardown joins timed-out work before the next test can reuse globals. */
export function regressionTest<Args extends unknown[]>(
  operation: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return (...args) => {
    const lifecycle = new RegressionLifecycle();
    onTestFinished(async () => await lifecycle.dispose(), 120_000);
    return context.run(lifecycle, () =>
      lifecycle.track(async () => await operation(...args)),
    );
  };
}

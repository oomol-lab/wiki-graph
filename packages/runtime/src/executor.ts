import { ExecutionScope } from "./lifecycle.js";

/** Bounded windows: no unbounded producer or completed-result queue. */
export async function* mapConcurrent<T, R>(
  input: AsyncIterable<T> | Iterable<T>,
  operation: (value: T, signal: AbortSignal) => Promise<R>,
  options: { concurrency: number; signal?: AbortSignal },
): AsyncIterable<R> {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1)
    throw new RangeError("Invalid concurrency");
  const scope = new ExecutionScope();
  const abort = () => scope.fail(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const iterator =
    Symbol.asyncIterator in input
      ? input[Symbol.asyncIterator]()
      : input[Symbol.iterator]();
  const pending = new Set<
    Promise<{ value?: R; error?: unknown; failed: boolean }>
  >();
  let done = false;
  try {
    while (!done) {
      scope.throwIfFailed();
      // A window is consumed before pulling the next: backpressure is bounded.
      for (let index = 0; index < options.concurrency; index++) {
        scope.throwIfFailed();
        const next = await iterator.next();
        if (next.done) {
          done = true;
          break;
        }
        const task = Promise.resolve()
          .then(() => operation(next.value, scope.signal))
          .then(
            (value) => ({ value, failed: false }),
            (error: unknown) => {
              scope.fail(error);
              return { error, failed: true };
            },
          );
        pending.add(task);
      }
      for (const task of pending) {
        const result = await task;
        pending.delete(task);
        scope.throwIfFailed();
        if (result.failed) throw result.error;
        yield result.value as R;
      }
    }
  } catch (error) {
    scope.fail(error);
    scope.throwIfFailed();
  } finally {
    scope.fail(new DOMException("Consumer closed", "AbortError"));
    // Drain before releasing resources; an uncooperative host must isolate work.
    await Promise.all(pending);
    try {
      await iterator.return?.();
    } catch {
      scope.throwIfFailed();
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

/** Materializes only the requested output; in-flight work stays bounded. */
export async function collectConcurrent<T, R>(
  input: Iterable<T>,
  operation: (value: T, index: number, signal: AbortSignal) => Promise<R>,
  options: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<R[]> {
  function* indexed() {
    let index = 0;
    for (const value of input) yield { value, index: index++ };
  }
  const results: R[] = [];
  for await (const result of mapConcurrent(
    indexed(),
    ({ value, index }, signal) => operation(value, index, signal),
    {
      concurrency: options.concurrency ?? 4,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  ))
    results.push(result);
  return results;
}

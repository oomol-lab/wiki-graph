import { afterEach, expect, it, vi } from "vitest";
import { ProviderFailure } from "./errors.js";
import { ProviderRuntime } from "./request.js";

afterEach(() => vi.useRealTimers());

it("keeps queued cooldown waits cancellable and bounded", async () => {
  vi.useFakeTimers();
  const runtime = new ProviderRuntime({ concurrency: 1 });
  const limited = runtime
    .run(
      () =>
        Promise.reject(
          new ProviderFailure({ statusCode: 429, retryAfterMs: 100 }),
        ),
      { policy: { retries: 0, delayMs: 0 } },
    )
    .catch(() => {});
  const operation = vi.fn();
  const controller = new AbortController();
  const reason = new Error("cancel cooldown");
  const cancelled = runtime
    .run(operation, { signal: controller.signal })
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(reason);
  await expect(cancelled).resolves.toBe(reason);
  await expect(
    runtime.run(operation, { policy: { maxRetryWaitMs: 50 } }),
  ).rejects.toThrow("waiting budget exhausted");
  expect(operation).not.toHaveBeenCalled();
  await limited;
});

it.each([0, 1])(
  "holds queued requests after 429 even with %i retries",
  async (retries) => {
    vi.useFakeTimers();
    const runtime = new ProviderRuntime({ concurrency: 1 });
    const limited = runtime
      .run(
        () =>
          Promise.reject(
            new ProviderFailure({ statusCode: 429, retryAfterMs: 100 }),
          ),
        { policy: { retries, delayMs: 0, jitter: false } },
      )
      .catch((error: unknown) => error);
    const operation = vi.fn().mockResolvedValue("ok");
    const queued = runtime.run(operation);
    await vi.advanceTimersByTimeAsync(99);
    expect(operation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(queued).resolves.toBe("ok");
    await limited;
  },
);

it("rechecks a cooldown extended while another request is sleeping", async () => {
  vi.useFakeTimers();
  const runtime = new ProviderRuntime({ concurrency: 2 });
  const options = { policy: { retries: 0, delayMs: 0, jitter: false } };
  const first = runtime
    .run(
      () =>
        Promise.reject(
          new ProviderFailure({ statusCode: 429, retryAfterMs: 100 }),
        ),
      options,
    )
    .catch(() => {});
  const second = runtime
    .run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new ProviderFailure({ statusCode: 429, retryAfterMs: 200 });
    }, options)
    .catch(() => {});
  await vi.advanceTimersByTimeAsync(0);
  const operation = vi.fn().mockResolvedValue("ok");
  const queued = runtime.run(operation);
  await vi.advanceTimersByTimeAsync(249);
  expect(operation).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(queued).resolves.toBe("ok");
  await Promise.all([first, second]);
});

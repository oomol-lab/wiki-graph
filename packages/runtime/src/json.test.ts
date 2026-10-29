import { afterEach, expect, it, vi } from "vitest";
import { createJsonRequest } from "./json.js";
import { ProviderRuntime } from "./request.js";

const options = {
  url: "https://provider.test/embeddings",
  body: { input: ["text"] },
  policy: { retries: 2, delayMs: 0, jitter: false },
};
const networkError = () =>
  Object.assign(new Error("socket lost"), { code: "ECONNRESET" });
afterEach(() => vi.useRealTimers());

it("retries network failures before headers and while reading JSON", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(
      new TypeError("fetch failed", { cause: networkError() }),
    )
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(networkError());
          },
        }),
      ),
    )
    .mockResolvedValueOnce(Response.json({ data: [1, 2] }));
  await expect(
    createJsonRequest()({ ...options, fetch: fetcher }),
  ).resolves.toEqual({ data: [1, 2] });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([401, 402, 403, 429])(
  "does not replay terminal provider errors (%i)",
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ error: { code: "insufficient_quota" } }, { status }),
        ),
      );
    await expect(
      createJsonRequest()({ ...options, fetch: fetcher }),
    ).rejects.toMatchObject({ statusCode: status, code: "insufficient_quota" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("honors Retry-After and retries a transient HTTP response", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({}, { status: 429, headers: { "Retry-After": "1" } }),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const result = createJsonRequest()({ ...options, fetch: fetcher });
  await vi.advanceTimersByTimeAsync(999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ ok: true });
});

it("does not replay invalid JSON or an oversized response", async () => {
  for (const response of [
    new Response("not JSON"),
    Response.json({ text: "too large" }),
  ]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      createJsonRequest()({ ...options, fetch: fetcher, maxResponseBytes: 10 }),
    ).rejects.toBeInstanceOf(Error);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it("cancels a pending body and does not retry after caller cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("caller stopped");
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          pull() {
            controller.abort(reason);
          },
          cancel,
        }),
      ),
    ),
  );
  await expect(
    createJsonRequest()({
      ...options,
      fetch: fetcher,
      signal: controller.signal,
    }),
  ).rejects.toBe(reason);
  // Runtime cancellation returns before its retained cleanup settles.
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("retains capacity until a cancelled JSON body is actually closed", async () => {
  vi.useFakeTimers();
  const runtime = new ProviderRuntime({ concurrency: 1 });
  const request = createJsonRequest(runtime);
  let finishCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finishCleanup = resolve;
  });
  const controller = new AbortController();
  const first = request({
    ...options,
    signal: controller.signal,
    fetch: () =>
      Promise.resolve(
        new Response(new ReadableStream({ cancel: () => cleanup })),
      ),
  }).catch(() => {});
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await first;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ ok: true }));
  const next = request({ ...options, fetch: fetcher });
  await vi.advanceTimersByTimeAsync(5_001);
  expect(fetcher).not.toHaveBeenCalled();
  finishCleanup();
  await expect(next).resolves.toEqual({ ok: true });
});

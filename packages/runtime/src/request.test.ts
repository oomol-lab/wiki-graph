import { describe, expect, it, vi } from "vitest";
import { ProviderRuntime } from "./request.js";
import { ProviderFailure, safeErrorGraph } from "./errors.js";
import { createOpenAICompletion } from "./openai.js";
import { mapConcurrent } from "./executor.js";

const policy = { retries: 2, delayMs: 0, jitter: false };
const networkError = () =>
  new TypeError("fetch failed", {
    cause: Object.assign(new Error("secret URL token"), {
      code: "ECONNRESET",
      syscall: "connect",
    }),
  });
const sse = (text: string, end = true) =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 8 } })}\n\n${end ? "data: [DONE]\n\n" : ""}`,
  );

describe("provider recovery boundary", () => {
  it("recovers pre-header network failure without losing nested diagnostics", async () => {
    const error = networkError();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(sse("accepted"));
    const events: unknown[] = [];
    expect(
      await createOpenAICompletion()({
        url: "https://example.test",
        model: "m",
        messages: [],
        fetch: fetcher,
        policy,
        onEvent: (e) => events.push(e),
      }),
    ).toBe("accepted");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(events)).toContain("ECONNRESET");
    expect(JSON.stringify(events)).not.toContain("secret");
  });
  it("discards incomplete candidates and preserves usage of every attempt", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sse("discard", false))
      .mockResolvedValueOnce(sse("accepted"));
    const usage = vi.fn();
    expect(
      await createOpenAICompletion()({
        url: "https://example.test",
        model: "m",
        messages: [],
        fetch: fetcher,
        policy,
        onUsage: usage,
      }),
    ).toBe("accepted");
    expect(usage.mock.calls).toEqual([
      [{ inputTokens: 8 }, 1],
      [{ inputTokens: 8 }, 2],
    ]);
  });
  it.each([401, 402, 403, 429])(
    "does not retry permanent provider failure %s",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: "insufficient_quota" } }),
              { status },
            ),
          ),
        );
      await expect(
        createOpenAICompletion()({
          url: "https://example.test",
          model: "m",
          messages: [],
          fetch: fetcher,
          policy,
        }),
      ).rejects.toMatchObject({ statusCode: status });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("preserves original failure after exhaustion and isolates broken logging", async () => {
    const error = networkError();
    const operation = vi.fn().mockRejectedValue(error);
    await expect(
      new ProviderRuntime().run(operation, {
        policy,
        onEvent: () => {
          throw new Error("logger failed");
        },
      }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });
  it("does not retry unknown errors", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("bug"));
    await expect(
      new ProviderRuntime().run(operation, { policy }),
    ).rejects.toThrow("bug");
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("cancels during backoff without another attempt", async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(networkError());
    const reason = new Error("stop");
    await expect(
      new ProviderRuntime().run(operation, {
        signal: controller.signal,
        policy: { retries: 5, delayMs: 10 },
        onEvent: (e) => {
          if (e.event === "provider.retry") controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("keeps structured SSE quota codes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            'data: {"error":{"code":"insufficient_quota","message":"secret"}}\n\n',
          ),
        ),
      );
    await expect(
      createOpenAICompletion()({
        url: "https://example.test",
        model: "m",
        messages: [],
        fetch: fetcher,
        policy,
      }),
    ).rejects.toMatchObject({ code: "insufficient_quota" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds cyclic aggregate errors", () => {
    const error = new AggregateError([], "secret");
    error.errors.push(error, networkError());
    expect(JSON.stringify(safeErrorGraph(error))).toContain("ECONNRESET");
    expect(JSON.stringify(safeErrorGraph(error))).not.toContain("secret");
  });
  it("does not fetch after an expired operation deadline", async () => {
    const operation = vi.fn();
    await expect(
      new ProviderRuntime().run(operation, { deadline: Date.now() - 1 }),
    ).rejects.toMatchObject({ code: "REQUEST_DEADLINE" });
    expect(operation).not.toHaveBeenCalled();
  });
  it("honors rate limit retry-after within a bounded waiting budget", async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(
        new ProviderFailure({ statusCode: 429, retryAfterMs: 100 }),
      );
    await expect(
      new ProviderRuntime().run(operation, {
        policy: { ...policy, maxRetryWaitMs: 5 },
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

it("bounded executor closes its producer on early exit", async () => {
  let pulled = 0;
  let closed = false;
  function* input() {
    try {
      while (true) yield ++pulled;
    } finally {
      closed = true;
    }
  }
  for await (const value of mapConcurrent(input(), (n) => Promise.resolve(n), {
    concurrency: 2,
  })) {
    expect(value).toBe(1);
    break;
  }
  expect(pulled).toBe(2);
  expect(closed).toBe(true);
});

it("DONE terminates and cancels an otherwise open response", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n',
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  expect(
    await createOpenAICompletion()({
      url: "https://example.test",
      model: "m",
      messages: [],
      fetch: () => Promise.resolve(response),
      policy,
    }),
  ).toBe("done");
  expect(cancelled).toBe(true);
});

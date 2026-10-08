import { describe, expect, it, vi } from "vitest";

import { LLM } from "./core.js";
import type { LLMRequestOptions } from "../types.js";

describe("LLM stream providers", () => {
  it("collects streamed text while preserving progress, usage, and options", async () => {
    const onStreamProgress = vi.fn();
    const onTokenUsage = vi.fn();
    const stream = vi.fn(async function* (
      _messages: readonly unknown[],
      options: LLMRequestOptions<"test">,
    ) {
      expect(options).toMatchObject({
        retryIndex: 1,
        retryMax: 3,
        scope: "test",
        temperature: 0.2,
        topP: 0.4,
      });
      yield { type: "text-delta" as const, text: "hel" };
      yield { type: "text-delta" as const, text: "lo" };
      yield {
        type: "usage" as const,
        usage: { inputTokens: 4, outputTokens: 2 },
      };
    });
    const llm = new LLM<"test">({
      onStreamProgress,
      onTokenUsage,
      streamProvider: { identity: "custom:test", model: "test", stream },
      temperature: 0.2,
      topP: 0.4,
    });

    await expect(
      llm.request([{ content: "prompt", role: "user" }], {
        retryIndex: 1,
        retryMax: 3,
        scope: "test",
      }),
    ).resolves.toBe("hello");
    expect(onStreamProgress).toHaveBeenNthCalledWith(1, {
      outputCharacters: 3,
    });
    expect(onStreamProgress).toHaveBeenNthCalledWith(2, {
      outputCharacters: 2,
    });
    expect(onTokenUsage).toHaveBeenCalledWith({
      inputTokens: 4,
      outputTokens: 2,
    });
  });

  it("propagates provider stream failures", async () => {
    const llm = new LLM<"test">({
      retryTimes: 0,
      streamProvider: {
        model: "test",
        async *stream() {
          await Promise.resolve();
          yield { text: "partial", type: "text-delta" };
          throw new TypeError("provider failed");
        },
      },
    });

    await expect(
      llm.request([{ content: "prompt", role: "user" }], { scope: "test" }),
    ).rejects.toThrow("provider failed");
  });

  it("uses the existing retry policy for retryable stream failures", async () => {
    let attempts = 0;
    const llm = new LLM<"test">({
      retryIntervalSeconds: 0,
      retryTimes: 1,
      streamProvider: {
        model: "test",
        async *stream() {
          attempts += 1;
          if (attempts === 1) throw new Error("network unavailable");
          yield { text: "recovered", type: "text-delta" };
        },
      },
    });

    await expect(
      llm.request([{ content: "prompt", role: "user" }], { scope: "test" }),
    ).resolves.toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("rejects a pre-aborted request even when the provider returns no events", async () => {
    const reason = new DOMException("cancelled", "AbortError");
    const controller = new AbortController();
    controller.abort(reason);
    const stream = vi.fn(() => ({
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        await Promise.resolve();
        return { done: true as const, value: undefined };
      },
    }));
    const llm = new LLM<"test">({
      retryTimes: 0,
      streamProvider: { model: "test", stream },
    });

    await expect(
      llm.request([{ content: "prompt", role: "user" }], {
        scope: "test",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(stream).not.toHaveBeenCalled();
  });

  it("rejects when cancellation occurs as the provider stream ends", async () => {
    const reason = new DOMException("cancelled", "AbortError");
    const controller = new AbortController();
    const llm = new LLM<"test">({
      retryTimes: 0,
      streamProvider: {
        model: "test",
        async *stream() {
          yield { text: "partial", type: "text-delta" };
          controller.abort(reason);
        },
      },
    });

    await expect(
      llm.request([{ content: "prompt", role: "user" }], {
        scope: "test",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
  });

  it("rejects while waiting for a provider that ignores cancellation", async () => {
    const reason = new DOMException("cancelled", "AbortError");
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const llm = new LLM<"test">({
      retryTimes: 0,
      streamProvider: {
        model: "test",
        async *stream() {
          markStarted!();
          await new Promise<never>(() => {});
          yield { text: "unreachable", type: "text-delta" };
        },
      },
    });
    const request = llm.request([{ content: "prompt", role: "user" }], {
      scope: "test",
      signal: controller.signal,
    });

    await started;
    controller.abort(reason);

    await expect(request).rejects.toBe(reason);
  });
});

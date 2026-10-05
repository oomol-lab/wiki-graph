import { describe, expect, it, vi } from "vitest";

import type { WikimediaResolveInput } from "../../../../external/wikipage/index.js";

import { resolveEntityWikipage } from "./wikipage.js";

describe("resolveEntityWikipage", () => {
  it("forwards cancellation to the Wikimedia resolver", async () => {
    const controller = new AbortController();
    const resolve = vi.fn(async function* (
      _input: readonly WikimediaResolveInput[],
      options?: { readonly signal?: AbortSignal },
    ) {
      expect(options?.signal).toBe(controller.signal);
      yield { index: 0, resolution: resolution() };
    });

    await expect(
      resolveEntityWikipage("Q1", {
        signal: controller.signal,
        wikimediaResolver: { resolve },
      }),
    ).resolves.toMatchObject({ zh: { label: "Q1" } });
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("rejects missing, duplicate, and invalid resolver indexes", async () => {
    await expect(
      resolveEntityWikipage("Q1", {
        wikimediaResolver: {
          resolve: async function* () {
            await Promise.resolve();
            yield* [];
          },
        },
      }),
    ).rejects.toThrow("ended after 0 of 1 results");

    await expect(
      resolveEntityWikipage("Q1", {
        wikimediaResolver: {
          resolve: async function* () {
            yield { index: 0, resolution: resolution() };
            yield { index: 0, resolution: resolution() };
          },
        },
      }),
    ).rejects.toThrow("input index 0 twice");

    await expect(
      resolveEntityWikipage("Q1", {
        wikimediaResolver: {
          resolve: async function* () {
            yield { index: 1, resolution: resolution() };
          },
        },
      }),
    ).rejects.toThrow("invalid input index 1");
  });
});

function resolution() {
  return {
    en: { description: null, label: "Q1", url: "https://example.com/en" },
    qid: "Q1",
    zh: { description: null, label: "Q1", url: "https://example.com/zh" },
  };
}

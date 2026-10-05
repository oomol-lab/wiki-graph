import { describe, expect, it, vi } from "vitest";

import type { UpstreamError } from "./wikimedia.js";
import { MediaWikiClient } from "./wikimedia.js";

describe("MediaWikiClient", () => {
  it("propagates cancellation to upstream fetch", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () =>
            reject(
              init.signal?.reason instanceof Error
                ? init.signal.reason
                : new Error("cancelled"),
            ),
          { once: true },
        );
      });
    });
    const controller = new AbortController();
    const request = new MediaWikiClient(fetcher, undefined, undefined, {
      retryWaitBudgetMs: 0,
    }).entities(["Q1"], { signal: controller.signal });

    controller.abort(new Error("cancelled"));

    await expect(request).rejects.toThrow("cancelled");
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("batches Wikidata entities without changing their order", async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = toUrl(input);
      const ids = url.searchParams.get("ids")?.split("|") ?? [];
      return Promise.resolve(
        Response.json({
          entities: Object.fromEntries(
            ids.map((qid) => [qid, { labels: { en: { value: qid } } }]),
          ),
        }),
      );
    });
    const qids = Array.from({ length: 101 }, (_, index) => `Q${index + 1}`);

    const entities = await new MediaWikiClient(fetcher, undefined, undefined, {
      retryWaitBudgetMs: 0,
    }).entities(qids);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(entities.map(({ qid }) => qid)).toStrictEqual(qids);
    for (const [input] of fetcher.mock.calls) {
      expect(
        toUrl(input).searchParams.get("ids")?.split("|").length,
      ).toBeLessThanOrEqual(50);
    }
  });

  it("batches Wikipedia page metadata", async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = toUrl(input);
      const titles = url.searchParams.get("titles")?.split("|") ?? [];
      return Promise.resolve(
        Response.json({
          query: {
            pages: titles.map((title, index) => ({
              canonicalurl: `https://en.wikipedia.org/wiki/${title}`,
              pageid: index + 1,
              revisions: [{ revid: index + 10 }],
              title,
            })),
          },
        }),
      );
    });
    const titles = Array.from(
      { length: 101 },
      (_, index) => `Page ${index + 1}`,
    );

    const pages = await new MediaWikiClient(fetcher, undefined, undefined, {
      retryWaitBudgetMs: 0,
    }).pages("enwiki", titles);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(pages.map(({ requestedTitle }) => requestedTitle)).toStrictEqual(
      titles,
    );
  });

  it("rejects MediaWiki JSON errors instead of returning empty data", async () => {
    const client = new MediaWikiClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          error: { code: "toomanyvalues", info: "Too many values" },
        }),
      ),
      undefined,
      undefined,
      { retryWaitBudgetMs: 0 },
    );

    await expect(client.entities(["Q1"])).rejects.toMatchObject({
      message: "Wikimedia toomanyvalues: Too many values",
      status: 502,
    } satisfies Partial<UpstreamError>);
  });

  it("retries maxlag without an attempt limit while budget remains", async () => {
    const wait = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(
      () => Promise.resolve(),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(maxlagResponse())
      .mockResolvedValueOnce(maxlagResponse())
      .mockResolvedValueOnce(maxlagResponse())
      .mockResolvedValueOnce(maxlagResponse())
      .mockResolvedValueOnce(
        Response.json({ entities: { Q1: { labels: {} } } }),
      );
    const client = new MediaWikiClient(fetcher, undefined, undefined, {
      random: () => 0,
      retryWaitBudgetMs: 100_000,
      wait,
    });

    await expect(client.entities(["Q1"])).resolves.toHaveLength(1);

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(wait.mock.calls.map(([ms]) => ms)).toStrictEqual([
      5_000, 10_000, 20_000, 40_000,
    ]);
  });

  it("stops only after the cumulative retry wait budget is exhausted", async () => {
    const wait = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(
      () => Promise.resolve(),
    );
    const client = new MediaWikiClient(
      vi
        .fn<typeof fetch>()
        .mockImplementation(() => Promise.resolve(maxlagResponse())),
      undefined,
      undefined,
      {
        random: () => 0,
        retryWaitBudgetMs: 12_000,
        wait,
      },
    );

    await expect(client.entities(["Q1"])).rejects.toMatchObject({
      code: "retry-budget-exhausted",
      kind: "retry-budget",
      retryable: true,
      status: 503,
    } satisfies Partial<UpstreamError>);
    expect(wait.mock.calls.map(([ms]) => ms)).toStrictEqual([5_000, 7_000]);
  });

  it.each([
    ["ratelimited", Response.json({ error: { code: "ratelimited" } })],
    ["forbidden", new Response("forbidden", { status: 403 })],
    ["server", new Response("unavailable", { status: 504 })],
  ])("retries %s feedback through the shared policy", async (_name, first) => {
    const wait = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(
      () => Promise.resolve(),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(
        Response.json({ entities: { Q1: { labels: {} } } }),
      );
    const client = new MediaWikiClient(fetcher, undefined, undefined, {
      random: () => 0,
      retryWaitBudgetMs: 5_000,
      wait,
    });

    await expect(client.entities(["Q1"])).resolves.toHaveLength(1);
    expect(wait).toHaveBeenCalledWith(5_000, undefined);
  });
});

function maxlagResponse(): Response {
  return Response.json({
    error: { code: "maxlag", info: "Waiting for wdqs: 5.35 seconds lagged" },
  });
}

function toUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

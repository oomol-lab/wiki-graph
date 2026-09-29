import { describe, expect, it, vi } from "vitest";

import type { UpstreamError } from "./wikimedia.js";
import { MediaWikiClient } from "./wikimedia.js";

describe("MediaWikiClient", () => {
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

    const entities = await new MediaWikiClient(
      fetcher,
      undefined,
      undefined,
      0,
    ).entities(qids);

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

    const pages = await new MediaWikiClient(
      fetcher,
      undefined,
      undefined,
      0,
    ).pages("enwiki", titles);

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
      0,
    );

    await expect(client.entities(["Q1"])).rejects.toMatchObject({
      message: "Wikimedia toomanyvalues: Too many values",
      status: 502,
    } satisfies Partial<UpstreamError>);
  });
});

function toUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

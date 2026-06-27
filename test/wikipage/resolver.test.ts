import { describe, expect, it } from "vitest";

import { WikipageResolver } from "../../src/wikipage/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("wikipage/resolver", () => {
  it("resolves qids, expands disambiguation pages, and reuses cache", async () => {
    await withTempDir("spinedigest-wikipage-", async (path) => {
      const calls: string[] = [];
      const fetch = createMockFetch(calls);
      const normalizerCalls: string[] = [];
      const progressEvents: Array<{
        readonly detail: string;
        readonly done: number;
        readonly total: number;
      }> = [];
      const resolver = await WikipageResolver.open({
        cacheDatabasePath: `${path}/cache.sqlite`,
        fetch,
        language: "en",
        minRequestIntervalMs: 0,
        normalizer: (input) => {
          normalizerCalls.push(input.sourceQid);

          return Promise.resolve({
            meanings: [
              {
                category: "place",
                information: "first planet from the Sun",
                name: "Mercury (planet)",
                priority: "primary",
                qid: "Q308",
              },
            ],
            sourceQid: input.sourceQid,
            ...(input.surface === undefined ? {} : { surface: input.surface }),
          });
        },
        progress: (event) => {
          progressEvents.push(event);
        },
        retryBaseDelayMs: 0,
      });

      try {
        const first = await resolver.resolveQids(["Q48397", "Q1"]);

        expect(first).toMatchObject([
          {
            disambiguation: {
              disambiguationQid: "Q48397",
              linkedQids: [
                {
                  qid: "Q925",
                  title: "Mercury (element)",
                },
                {
                  qid: "Q308",
                  title: "Mercury (planet)",
                },
              ],
              pages: [
                {
                  text:
                    "* [[Mercury|wikigraph://qid=Q925]], a chemical element\n" +
                    "* [[Mercury|wikigraph://qid=Q308]], the first planet from the Sun",
                  title: "Mercury",
                  wiki: "enwiki",
                },
              ],
              profile: {
                meanings: [
                  {
                    information: "first planet from the Sun",
                    name: "Mercury (planet)",
                    qid: "Q308",
                  },
                ],
                sourceQid: "Q48397",
              },
            },
            disambiguationPages: [
              {
                text:
                  "* [[Mercury|wikigraph://qid=Q925]], a chemical element\n" +
                  "* [[Mercury|wikigraph://qid=Q308]], the first planet from the Sun",
                title: "Mercury",
                wiki: "enwiki",
              },
            ],
            isDisambiguation: true,
            label: "Mercury",
            qid: "Q48397",
          },
          {
            description: "totality of space and time",
            isDisambiguation: false,
            label: "Universe",
            qid: "Q1",
          },
        ]);

        const firstCallCount = calls.length;
        const second = await resolver.resolveQids(["Q48397", "Q1"]);

        expect(second).toStrictEqual(first);
        expect(calls).toHaveLength(firstCallCount);
        expect(normalizerCalls).toStrictEqual(["Q48397"]);
        expect(progressEvents).toEqual(
          expect.arrayContaining([
            { detail: "qid", done: 0, total: 2 },
            { detail: "qid", done: 2, total: 2 },
            { detail: "disambiguation-page", done: 1, total: 1 },
          ]),
        );
      } finally {
        await resolver.close();
      }
    });
  });

  it("retries transient wikimedia responses", async () => {
    await withTempDir("spinedigest-wikipage-", async (path) => {
      let failedOnce = false;
      const calls: string[] = [];
      const resolver = await WikipageResolver.open({
        cacheDatabasePath: `${path}/cache.sqlite`,
        fetch: ((input: string | URL | Request) => {
          const url = new URL(input instanceof Request ? input.url : input);
          calls.push(url.toString());

          if (!failedOnce && url.hostname === "www.wikidata.org") {
            failedOnce = true;
            return Promise.resolve(jsonResponse({ error: "busy" }, 503));
          }

          return createMockFetch([])(input);
        }) as typeof fetch,
        language: "en",
        minRequestIntervalMs: 0,
        retryBaseDelayMs: 0,
        retryTimes: 1,
      });

      try {
        await expect(resolver.resolveQids(["Q1"])).resolves.toMatchObject([
          {
            description: "totality of space and time",
            label: "Universe",
            qid: "Q1",
          },
        ]);
        expect(
          calls.filter((call) => call.includes("wbgetentities")),
        ).toHaveLength(2);
      } finally {
        await resolver.close();
      }
    });
  });
});

function createMockFetch(calls: string[]): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url.toString());

    if (url.hostname === "www.wikidata.org") {
      const ids = url.searchParams.get("ids")?.split("|") ?? [];

      return Promise.resolve(
        jsonResponse({
          entities: Object.fromEntries(ids.map((qid) => [qid, entity(qid)])),
        }),
      );
    }

    if (url.searchParams.get("action") === "query") {
      const titles = url.searchParams.get("titles")?.split("|") ?? [];

      return Promise.resolve(
        jsonResponse({
          query: {
            pages: titles.map(page),
          },
        }),
      );
    }

    if (url.searchParams.get("action") === "parse") {
      return Promise.resolve(
        jsonResponse({
          parse: {
            pageid: 19007,
            text: `
<ul>
  <li><a href="/wiki/Mercury_(element)" title="Mercury (element)">Mercury</a>, a chemical element</li>
  <li><a href="/wiki/Mercury_(planet)" title="Mercury (planet)">Mercury</a>, the first planet from the Sun</li>
</ul>
`,
            title: "Mercury",
          },
        }),
      );
    }

    return Promise.resolve(jsonResponse({}, 404));
  }) as typeof fetch;
}

function entity(qid: string): Record<string, unknown> {
  const data: Record<string, Record<string, string | undefined>> = {
    Q1: {
      description: "totality of space and time",
      label: "Universe",
      title: "Universe",
    },
    Q308: {
      description: "first planet from the Sun",
      label: "Mercury",
      title: "Mercury (planet)",
    },
    Q925: {
      description: "chemical element",
      label: "Mercury",
      title: "Mercury (element)",
    },
    Q48397: {
      description: "Wikimedia disambiguation page",
      label: "Mercury",
      title: "Mercury",
    },
  };
  const item = data[qid] ?? {};

  return {
    descriptions: {
      en: { value: item.description },
    },
    labels: {
      en: { value: item.label },
    },
    sitelinks: {
      enwiki: { title: item.title },
    },
  };
}

function page(title: string): Record<string, unknown> {
  const qids: Record<string, string> = {
    Mercury: "Q48397",
    "Mercury (element)": "Q925",
    "Mercury (planet)": "Q308",
    Universe: "Q1",
  };

  return {
    pageid: title === "Mercury" ? 19007 : 1,
    pageprops: {
      ...(title === "Mercury" ? { disambiguation: "" } : {}),
      wikibase_item: qids[title],
    },
    title,
  };
}

function jsonResponse(input: unknown, status = 200): Response {
  return new Response(JSON.stringify(input), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}

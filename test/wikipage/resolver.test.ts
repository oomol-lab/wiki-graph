import { describe, expect, it } from "vitest";

import { WikipageResolver } from "../../src/wikipage/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("wikipage/resolver", () => {
  it("resolves qids, expands disambiguation pages, and reuses cache", async () => {
    await withTempDir("spinedigest-wikipage-", async (path) => {
      const calls: string[] = [];
      const fetch = createMockFetch(calls);
      const resolver = await WikipageResolver.open({
        cacheDatabasePath: `${path}/cache.sqlite`,
        fetch,
        language: "en",
        minRequestIntervalMs: 0,
      });

      try {
        const first = await resolver.resolveQids(["Q48397", "Q1"]);

        expect(first).toMatchObject([
          {
            disambiguation: {
              disambiguationQid: "Q48397",
              options: [
                {
                  description: "chemical element",
                  hint: "Mercury, a chemical element",
                  qid: "Q925",
                  title: "Mercury (element)",
                },
                {
                  description: "first planet from the Sun",
                  hint: "Mercury, the first planet from the Sun",
                  qid: "Q308",
                  title: "Mercury (planet)",
                },
              ],
              pageTitle: "Mercury",
            },
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
      } finally {
        await resolver.close();
      }
    });
  });
});

function createMockFetch(calls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url.toString());

    if (url.hostname === "www.wikidata.org") {
      const ids = url.searchParams.get("ids")?.split("|") ?? [];

      return jsonResponse({
        entities: Object.fromEntries(ids.map((qid) => [qid, entity(qid)])),
      });
    }

    if (url.searchParams.get("action") === "query") {
      const titles = url.searchParams.get("titles")?.split("|") ?? [];

      return jsonResponse({
        query: {
          pages: titles.map(page),
        },
      });
    }

    if (url.searchParams.get("action") === "parse") {
      return jsonResponse({
        parse: {
          links: [
            { ns: 0, title: "Mercury (element)" },
            { ns: 0, title: "Mercury (planet)" },
          ],
          pageid: 19007,
          text: `
<ul>
  <li><a href="/wiki/Mercury_(element)" title="Mercury (element)">Mercury</a>, a chemical element</li>
  <li><a href="/wiki/Mercury_(planet)" title="Mercury (planet)">Mercury</a>, the first planet from the Sun</li>
</ul>
`,
          title: "Mercury",
        },
      });
    }

    return jsonResponse({}, 404);
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

import { mkdir, readdir, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { withLoggingContext } from "../../packages/core/src/common/logging.js";
import { Database } from "../../packages/core/src/document/index.js";
import { WikipageResolver } from "../../packages/core/src/wikipage/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("wikipage/resolver", () => {
  it("resolves qids, expands disambiguation pages, and reuses cache", async () => {
    await withTempDir("wikigraph-wikipage-", async (path) => {
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
                    "* [[Mercury|wikg://qid=Q925]], a chemical element\n" +
                    "* [[Mercury|wikg://qid=Q308]], the first planet from the Sun",
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
                  "* [[Mercury|wikg://qid=Q925]], a chemical element\n" +
                  "* [[Mercury|wikg://qid=Q308]], the first planet from the Sun",
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

  it("writes compact fetch logs when a log directory is configured", async () => {
    await withTempDir("wikigraph-wikipage-", async (path) => {
      const calls: string[] = [];

      await withLoggingContext(
        {
          logDirPath: path,
          operation: "wikipage-test",
        },
        async () => {
          const resolver = await WikipageResolver.open({
            cacheDatabasePath: `${path}/cache.sqlite`,
            fetch: createMockFetch(calls),
            language: "en",
            logDirPath: path,
            minRequestIntervalMs: 0,
            retryBaseDelayMs: 0,
          });

          try {
            await resolver.resolveQids(["Q1"]);
          } finally {
            await resolver.close();
          }
        },
      );

      const log = await readWikipageFetchLog(path);
      const lines = log
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatchObject({
        action: "wbgetentities",
        attempt: 1,
        batch: {
          count: 1,
          kind: "qid",
          sample: ["Q1"],
        },
        host: "www.wikidata.org",
        ok: true,
        status: 200,
      });
      expect(lines[0]).not.toHaveProperty("responseText");
      expect(lines.slice(1)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "query",
            attempt: 1,
            ok: true,
            status: 200,
          }),
        ]),
      );
      expect(lines.slice(1).map(readBatchSample)).toEqual(
        expect.arrayContaining([["Universe"], ["宇宙"]]),
      );
    });
  });

  it("includes response text for failed text responses", async () => {
    await withTempDir("wikigraph-wikipage-", async (path) => {
      const failingFetch: typeof globalThis.fetch = () =>
        Promise.resolve(
          new Response("service unavailable", {
            headers: {
              "content-type": "text/plain",
            },
            status: 503,
          }),
        );

      await expect(
        withLoggingContext(
          {
            logDirPath: path,
            operation: "wikipage-test",
          },
          async () => {
            const resolver = await WikipageResolver.open({
              cacheDatabasePath: `${path}/cache.sqlite`,
              fetch: failingFetch,
              language: "en",
              logDirPath: path,
              minRequestIntervalMs: 0,
              retryBaseDelayMs: 0,
              retryTimes: 0,
            });

            try {
              await resolver.resolveQids(["Q1"]);
            } finally {
              await resolver.close();
            }
          },
        ),
      ).rejects.toThrow("Wikimedia request failed with 503");

      const [line] = (await readWikipageFetchLog(path)).trim().split("\n");
      const entry = JSON.parse(line!) as Record<string, unknown>;

      expect(entry).toMatchObject({
        action: "wbgetentities",
        ok: false,
        responseText: "service unavailable",
        status: 503,
      });
    });
  });

  it("does not fail requests when fetch logging fails", async () => {
    await withTempDir("wikigraph-wikipage-", async (path) => {
      const calls: string[] = [];

      await expect(
        withLoggingContext(
          {
            logDirPath: path,
            operation: "wikipage-test",
          },
          async () => {
            const resolver = await WikipageResolver.open({
              cacheDatabasePath: `${path}/cache.sqlite`,
              fetch: createMockFetch(calls),
              language: "en",
              logDirPath: path,
              minRequestIntervalMs: 0,
              retryBaseDelayMs: 0,
            });

            try {
              const runDirName = await readOnlyRunDirName(path);
              await mkdir(
                `${path}/${runDirName}/artifacts/wikipage/wikipage-fetch.jsonl`,
              );

              return await resolver.resolveQids(["Q1"]);
            } finally {
              await resolver.close();
            }
          },
        ),
      ).resolves.toMatchObject([
        {
          description: "totality of space and time",
          label: "Universe",
          qid: "Q1",
        },
      ]);

      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it("retries transient wikimedia responses", async () => {
    await withTempDir("wikigraph-wikipage-", async (path) => {
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

  it("keeps qid cache entries isolated by language", async () => {
    await withTempDir("wikigraph-wikipage-", async (path) => {
      const calls: string[] = [];
      const fetch = createMockFetch(calls);
      const cacheDatabasePath = `${path}/cache.sqlite`;
      const enResolver = await WikipageResolver.open({
        cacheDatabasePath,
        fetch,
        language: "en",
        minRequestIntervalMs: 0,
        retryBaseDelayMs: 0,
      });

      try {
        await expect(enResolver.resolveQids(["Q1"])).resolves.toMatchObject([
          {
            description: "totality of space and time",
            label: "Universe",
            qid: "Q1",
          },
        ]);
      } finally {
        await enResolver.close();
      }

      const zhResolver = await WikipageResolver.open({
        cacheDatabasePath,
        fetch,
        language: "zh",
        minRequestIntervalMs: 0,
        retryBaseDelayMs: 0,
      });

      try {
        await expect(zhResolver.resolveQids(["Q1"])).resolves.toMatchObject([
          {
            description: "宇宙的全部时空",
            label: "宇宙",
            qid: "Q1",
          },
        ]);
      } finally {
        await zhResolver.close();
      }

      expect(
        calls.filter((call) => call.includes("wbgetentities")),
      ).toHaveLength(2);
    });
  });

  it("keeps cache entries across resolver reopen", async () => {
    await withTempDir("wikigraph-wikipage-", async (path) => {
      const calls: string[] = [];
      const fetch = createMockFetch(calls);
      const cacheDatabasePath = `${path}/cache.sqlite`;
      const firstResolver = await WikipageResolver.open({
        cacheDatabasePath,
        fetch,
        language: "en",
        minRequestIntervalMs: 0,
        retryBaseDelayMs: 0,
      });

      try {
        await expect(firstResolver.resolveQids(["Q1"])).resolves.toMatchObject([
          {
            description: "totality of space and time",
            label: "Universe",
            qid: "Q1",
          },
        ]);
      } finally {
        await firstResolver.close();
      }

      const firstCallCount = calls.length;
      const secondResolver = await WikipageResolver.open({
        cacheDatabasePath,
        fetch,
        language: "en",
        minRequestIntervalMs: 0,
        retryBaseDelayMs: 0,
      });

      try {
        await expect(secondResolver.resolveQids(["Q1"])).resolves.toMatchObject(
          [
            {
              description: "totality of space and time",
              label: "Universe",
              qid: "Q1",
            },
          ],
        );
      } finally {
        await secondResolver.close();
      }

      expect(calls).toHaveLength(firstCallCount);
    });
  });

  it("migrates language-insensitive cache entries once", async () => {
    await withTempDir("wikigraph-wikipage-", async (path) => {
      const cacheDatabasePath = `${path}/cache.sqlite`;
      const database = await Database.open(
        cacheDatabasePath,
        `
CREATE TABLE qid_cache (
  qid TEXT PRIMARY KEY,
  label TEXT,
  description TEXT,
  pages_json TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE disambiguation_cache (
  qid TEXT PRIMARY KEY,
  pages_json TEXT NOT NULL,
  profile_json TEXT,
  checked_at TEXT NOT NULL
);
`,
      );

      try {
        await database.run(
          `
INSERT INTO qid_cache (
  qid, label, description, pages_json, checked_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?)
`,
          [
            "Q1",
            "Universe",
            "totality of space and time",
            JSON.stringify([
              {
                isDisambiguation: false,
                title: "Universe",
                wiki: "enwiki",
              },
            ]),
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
          ],
        );
      } finally {
        await database.close();
      }

      const calls: string[] = [];
      const resolver = await WikipageResolver.open({
        cacheDatabasePath,
        fetch: createMockFetch(calls),
        language: "en",
        minRequestIntervalMs: 0,
        retryBaseDelayMs: 0,
      });

      try {
        await expect(resolver.resolveQids(["Q1"])).resolves.toMatchObject([
          {
            description: "totality of space and time",
            label: "Universe",
            qid: "Q1",
          },
        ]);
      } finally {
        await resolver.close();
      }

      expect(calls).toStrictEqual([]);
    });
  });
});

function createMockFetch(calls: string[]): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url.toString());

    if (url.hostname === "www.wikidata.org") {
      const ids = url.searchParams.get("ids")?.split("|") ?? [];
      const languages = url.searchParams.get("languages")?.split("|") ?? ["en"];

      return Promise.resolve(
        jsonResponse({
          entities: Object.fromEntries(
            ids.map((qid) => [qid, entity(qid, languages)]),
          ),
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

async function readWikipageFetchLog(logDirPath: string): Promise<string> {
  const runDirName = await readOnlyRunDirName(logDirPath);

  return await readFile(
    `${logDirPath}/${runDirName}/artifacts/wikipage/wikipage-fetch.jsonl`,
    "utf8",
  );
}

async function readOnlyRunDirName(logDirPath: string): Promise<string> {
  const entries = await readdir(logDirPath, { withFileTypes: true });
  const runEntries = entries.filter((entry) => entry.isDirectory());

  expect(runEntries).toHaveLength(1);

  return runEntries[0]!.name;
}

function readBatchSample(entry: Record<string, unknown>): readonly unknown[] {
  const batch = entry.batch;

  expect(batch).toEqual(expect.any(Object));

  const sample = (batch as Record<string, unknown>).sample;

  expect(Array.isArray(sample)).toBe(true);
  return sample as readonly unknown[];
}

function entity(
  qid: string,
  languages: readonly string[],
): Record<string, unknown> {
  const data: Record<
    string,
    Record<string, Record<string, string | undefined>>
  > = {
    Q1: {
      en: {
        description: "totality of space and time",
        label: "Universe",
        title: "Universe",
      },
      zh: {
        description: "宇宙的全部时空",
        label: "宇宙",
        title: "宇宙",
      },
    },
    Q308: {
      en: {
        description: "first planet from the Sun",
        label: "Mercury",
        title: "Mercury (planet)",
      },
    },
    Q925: {
      en: {
        description: "chemical element",
        label: "Mercury",
        title: "Mercury (element)",
      },
    },
    Q48397: {
      en: {
        description: "Wikimedia disambiguation page",
        label: "Mercury",
        title: "Mercury",
      },
    },
  };
  const item = data[qid] ?? {};

  return {
    descriptions: Object.fromEntries(
      languages.flatMap((language) =>
        item[language]?.description === undefined
          ? []
          : [[language, { value: item[language].description }]],
      ),
    ),
    labels: Object.fromEntries(
      languages.flatMap((language) =>
        item[language]?.label === undefined
          ? []
          : [[language, { value: item[language].label }]],
      ),
    ),
    sitelinks: {
      ...(item.en?.title === undefined
        ? {}
        : { enwiki: { title: item.en.title } }),
      ...(item.zh?.title === undefined
        ? {}
        : { zhwiki: { title: item.zh.title } }),
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

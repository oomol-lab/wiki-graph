import { describe, expect, it, vi } from "vitest";

import { DirectWikimediaResolver } from "./resolver.js";
import type {
  CachedWikimediaDisambiguation,
  CachedWikimediaQid,
  DisambiguationNormalizer,
  WikimediaCache,
  WikimediaCacheStats,
  WikimediaClient,
  WikimediaDisambiguationCacheKey,
  WikimediaNormalizerIdentity,
} from "./types.js";

const identity = { modelId: "test-model", normalizerVersion: "v1" } as const;

describe("DirectWikimediaResolver", () => {
  it("reads and emits QIDs in bounded cache batches", async () => {
    const cache = memoryCache(
      Array.from({ length: 51 }, (_, index) => cachedRecord(`Q${index + 1}`)),
    );
    const resolver = createResolver(cache);
    const iterator = resolver
      .resolve(
        Array.from({ length: 51 }, (_, index) => ({
          disambiguation: false,
          qid: `Q${index + 1}`,
        })),
      )
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { index: 0, resolution: { qid: "Q1" } },
    });
    expect(cache.getQids).toHaveBeenCalledOnce();
    expect(vi.mocked(cache.getQids).mock.calls[0]?.[0]).toHaveLength(50);
    await iterator.return?.();
  });

  it("emits a cache hit before rebuilding another QID in the same batch", async () => {
    const entities = vi.fn(() => Promise.resolve([]));
    const resolver = createResolver(memoryCache([cachedRecord("Q1")]), {
      entities,
    });
    const iterator = resolver
      .resolve([
        { disambiguation: false, qid: "Q2" },
        { disambiguation: false, qid: "Q1" },
      ])
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { index: 1, resolution: { qid: "Q1" } },
    });
    expect(entities).not.toHaveBeenCalled();
    await iterator.return?.();
  });

  it("keeps plain and disambiguation requests on one level-one cache entry", async () => {
    const cache = memoryCache();
    const entities = vi.fn(() =>
      Promise.resolve([
        {
          descriptions: { en: "author" },
          labels: { en: "Douglas Adams" },
          qid: "Q42",
          sitelinks: { enwiki: "Douglas Adams" },
        },
      ]),
    );
    const disambiguation = vi.fn(() =>
      Promise.resolve({
        items: [],
        links: [],
        pageId: 42,
        revisionId: 7,
        text: "page",
        title: "Douglas Adams",
      }),
    );
    const resolver = createResolver(cache, {
      disambiguation,
      entities,
      pages: (wiki) =>
        Promise.resolve(
          wiki === "enwiki"
            ? [
                {
                  description: "writer",
                  isDisambiguation: true,
                  pageId: 42,
                  revisionId: 7,
                  title: "Douglas Adams",
                  url: "https://en.wikipedia.org/wiki/Douglas_Adams",
                  wiki,
                },
              ]
            : [],
        ),
    });

    await collect(resolver.resolve([{ disambiguation: false, qid: "Q42" }]));
    const expanded = await collect(
      resolver.resolve([{ disambiguation: true, qid: "Q42" }]),
    );
    await collect(resolver.resolve([{ disambiguation: false, qid: "Q42" }]));

    expect(entities).toHaveBeenCalledOnce();
    expect(disambiguation).toHaveBeenCalledOnce();
    expect(expanded[0]?.resolution.disambiguation).toEqual([
      { information: "meaning", qid: "Q1" },
    ]);
  });

  it("coalesces concurrent level-one misses in one process", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entities = vi.fn(async (qids: readonly string[]) => {
      await held;
      return qids.map((qid) => ({
        descriptions: {},
        labels: {},
        qid,
        sitelinks: {},
      }));
    });
    const resolver = createResolver(memoryCache(), { entities });

    const first = collect(
      resolver.resolve([{ disambiguation: false, qid: "Q1" }]),
    );
    await vi.waitFor(() => expect(entities).toHaveBeenCalledOnce());
    const second = collect(
      resolver.resolve([{ disambiguation: false, qid: "Q1" }]),
    );
    release?.();
    await Promise.all([first, second]);

    expect(entities).toHaveBeenCalledOnce();
  });

  it("does not normalize a page that is not objectively marked as disambiguation", async () => {
    const normalize = vi.fn(() => Promise.resolve({ meanings: [] }));
    const resolver = createResolver(memoryCache(), {
      entities: () =>
        Promise.resolve([
          {
            descriptions: {},
            labels: {},
            qid: "Q1",
            sitelinks: { enwiki: "ordinary" },
          },
        ]),
      normalize,
      pages: (wiki) =>
        Promise.resolve(
          wiki === "enwiki"
            ? [
                {
                  description: null,
                  isDisambiguation: false,
                  pageId: 1,
                  revisionId: 1,
                  title: "ordinary",
                  url: "url",
                  wiki,
                },
              ]
            : [],
        ),
    });

    const [item] = await collect(
      resolver.resolve([{ disambiguation: true, qid: "Q1" }]),
    );

    expect(item?.resolution.disambiguation).toEqual([]);
    expect(normalize).not.toHaveBeenCalled();
  });

  it("matches level-two cache entries by normalizer and model identity", async () => {
    const cache = memoryCache([cachedRecord("Q1", true)]);
    const getDisambiguations = vi.mocked(cache.getDisambiguations);
    const resolver = createResolver(cache);

    await collect(resolver.resolve([{ disambiguation: true, qid: "Q1" }]));

    expect(getDisambiguations).toHaveBeenCalledWith(
      [expect.objectContaining({ qid: "Q1", revisionId: 1 })],
      identity,
      undefined,
    );
  });

  it("reports aggregate cache statistics", async () => {
    const observeCache = vi.fn();
    const resolver = createResolver(memoryCache([cachedRecord("Q1")]), {
      observeCache,
    });

    await collect(resolver.resolve([{ disambiguation: false, qid: "Q1" }]));

    expect(observeCache).toHaveBeenCalledWith(
      expect.objectContaining({ level1Hit: 1, level1Miss: 0 }),
    );
  });

  it("preserves every duplicate input through stable indexes", async () => {
    const resolver = createResolver(memoryCache([cachedRecord("Q1")]));
    const items = await collect(
      resolver.resolve([
        { disambiguation: false, qid: "Q1" },
        { disambiguation: false, qid: "Q1" },
      ]),
    );
    expect(items.map(({ index }) => index)).toStrictEqual([0, 1]);
  });
});

function createResolver(
  cache: WikimediaCache,
  overrides: {
    readonly disambiguation?: WikimediaClient["disambiguation"];
    readonly entities?: WikimediaClient["entities"];
    readonly normalize?: DisambiguationNormalizer["normalize"];
    readonly observeCache?: (stats: WikimediaCacheStats) => void;
    readonly pages?: WikimediaClient["pages"];
  } = {},
) {
  return new DirectWikimediaResolver({
    cache,
    client: {
      disambiguation:
        overrides.disambiguation ??
        ((page) =>
          Promise.resolve({
            items: [],
            links: [],
            pageId: page.pageId,
            revisionId: page.revisionId,
            text: "page",
            title: page.title,
          })),
      entities:
        overrides.entities ??
        ((qids) =>
          Promise.resolve(
            qids.map((qid) => ({
              descriptions: {},
              labels: {},
              qid,
              sitelinks: {},
            })),
          )),
      pages: overrides.pages ?? (() => Promise.resolve([])),
    },
    normalizer: {
      identity,
      normalize:
        overrides.normalize ??
        (() =>
          Promise.resolve({
            meanings: [{ information: "meaning", qid: "Q1" }],
          })),
    },
    ...(overrides.observeCache === undefined
      ? {}
      : { observeCache: overrides.observeCache }),
  });
}

function memoryCache(
  initial: readonly CachedWikimediaQid[] = [],
): WikimediaCache {
  const qids = new Map(initial.map((record) => [record.qid, record]));
  const disambiguations = new Map<string, CachedWikimediaDisambiguation>();
  return {
    getDisambiguations: vi.fn(
      (
        keys: readonly WikimediaDisambiguationCacheKey[],
        requestedIdentity: WikimediaNormalizerIdentity,
      ) =>
        Promise.resolve(
          keys.flatMap((key) => {
            const value = disambiguations.get(cacheKey(key, requestedIdentity));
            return value === undefined ? [] : [value];
          }),
        ),
    ),
    getQids: vi.fn((requested: readonly string[]) => {
      return Promise.resolve(
        new Map<string, CachedWikimediaQid>(
          requested.flatMap((qid): readonly [string, CachedWikimediaQid][] => {
            const value = qids.get(qid);
            return value === undefined ? [] : [[qid, value] as const];
          }),
        ),
      );
    }),
    putDisambiguations: vi.fn(
      (
        records: readonly CachedWikimediaDisambiguation[],
        requestedIdentity: WikimediaNormalizerIdentity,
      ) => {
        for (const record of records) {
          disambiguations.set(cacheKey(record, requestedIdentity), record);
        }
        return Promise.resolve();
      },
    ),
    putQids: vi.fn((records: readonly CachedWikimediaQid[]) => {
      for (const record of records) qids.set(record.qid, record);
      return Promise.resolve();
    }),
  };
}

function cacheKey(
  key: WikimediaDisambiguationCacheKey,
  requestedIdentity: WikimediaNormalizerIdentity,
): string {
  return `${key.qid}:${key.wiki}:${key.pageId}:${key.revisionId}:${requestedIdentity.normalizerVersion}:${requestedIdentity.modelId}`;
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

function cachedRecord(qid: string, disambiguation = false): CachedWikimediaQid {
  return {
    qid,
    refreshedAt: new Date().toISOString(),
    sites: [
      {
        output: { description: null, label: qid, url: null },
        wiki: "zhwiki",
      },
      {
        output: { description: null, label: qid, url: null },
        ...(disambiguation
          ? {
              page: {
                description: null,
                isDisambiguation: true,
                pageId: 1,
                revisionId: 1,
                title: qid,
                url: "url",
                wiki: "enwiki" as const,
              },
            }
          : {}),
        wiki: "enwiki",
      },
    ],
  };
}

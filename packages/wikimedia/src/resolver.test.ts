import { describe, expect, it, vi } from "vitest";

import { DirectWikimediaResolver } from "./resolver.js";
import type { CachedWikimediaQid, WikimediaCache } from "./types.js";

describe("DirectWikimediaResolver", () => {
  it("yields from a bounded cache batch before scanning later inputs", async () => {
    const get = vi.fn((qids: readonly string[]) =>
      Promise.resolve(
        new Map(qids.map((qid) => [qid, cachedRecord(qid)] as const)),
      ),
    );
    const resolver = new DirectWikimediaResolver({
      cache: { get, put: () => Promise.resolve() },
      client: {
        disambiguation: () => Promise.reject(new Error("not expected")),
        entities: () => Promise.reject(new Error("not expected")),
        pages: () => Promise.reject(new Error("not expected")),
      },
      normalizer: {
        normalize: () => Promise.reject(new Error("not expected")),
      },
    });
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
    expect(get).toHaveBeenCalledOnce();
    expect(get.mock.calls[0]?.[0]).toHaveLength(50);
    await iterator.return?.();
  });

  it("yields a cached result before a preceding cache miss starts upstream work", async () => {
    const entities = vi.fn(() => Promise.resolve([]));
    const resolver = new DirectWikimediaResolver({
      cache: {
        get: () => Promise.resolve(new Map([["Q1", cachedRecord("Q1")]])),
        put: () => Promise.resolve(),
      },
      client: {
        disambiguation: () => Promise.reject(new Error("not expected")),
        entities,
        pages: () => Promise.resolve([]),
      },
      normalizer: {
        normalize: () => Promise.reject(new Error("not expected")),
      },
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

  it("preserves every duplicate input through stable indexes", async () => {
    const resolver = new DirectWikimediaResolver({
      cache: {
        get: () => Promise.resolve(new Map([["Q1", cachedRecord("Q1")]])),
        put: () => Promise.resolve(),
      },
      client: {
        disambiguation: () => Promise.reject(new Error("not expected")),
        entities: () => Promise.reject(new Error("not expected")),
        pages: () => Promise.reject(new Error("not expected")),
      },
      normalizer: {
        normalize: () => Promise.reject(new Error("not expected")),
      },
    });

    const items = await collect(
      resolver.resolve([
        { disambiguation: false, qid: "Q1" },
        { disambiguation: false, qid: "Q1" },
      ]),
    );

    expect(items.map(({ index }) => index)).toStrictEqual([0, 1]);
  });

  it("stops rebuilding records after abort", async () => {
    const put = vi.fn(() => Promise.resolve());
    const controller = new AbortController();
    const resolver = new DirectWikimediaResolver({
      cache: { get: () => Promise.resolve(new Map()), put },
      client: {
        disambiguation: () => Promise.reject(new Error("not expected")),
        entities: (qids) =>
          Promise.resolve(
            qids.map((qid) => ({
              descriptions: {},
              labels: {},
              qid,
              sitelinks: {},
            })),
          ),
        pages: () => Promise.resolve([]),
      },
      normalizer: {
        normalize: () => Promise.reject(new Error("not expected")),
      },
    });
    const iterator = resolver
      .resolve(
        Array.from({ length: 51 }, (_, index) => ({
          disambiguation: false,
          qid: `Q${index + 1}`,
        })),
        { signal: controller.signal },
      )
      [Symbol.asyncIterator]();

    await iterator.next();
    controller.abort(new Error("stopped"));
    await expect(iterator.next()).rejects.toThrow("stopped");
    expect(put).toHaveBeenCalledOnce();
  });

  it("uses the caller's WikiSpine flag and caches a complete QID aggregate", async () => {
    const values = new Map<string, CachedWikimediaQid>();
    const cache: WikimediaCache = {
      get: (qids) =>
        Promise.resolve(
          new Map(
            qids.flatMap((qid) => {
              const value = values.get(qid);
              return value === undefined ? [] : [[qid, value] as const];
            }),
          ),
        ),
      put: (records) => {
        for (const record of records) values.set(record.qid, record);
        return Promise.resolve();
      },
    };
    const entities = vi.fn((qids: readonly string[]) =>
      Promise.resolve(
        qids.map((qid) => ({
          descriptions: { en: "description" },
          labels: { en: "label" },
          qid,
          sitelinks: {},
        })),
      ),
    );
    const disambiguation = vi.fn(() =>
      Promise.reject(
        new Error("the false WikiSpine flag must prevent parsing"),
      ),
    );
    const resolver = new DirectWikimediaResolver({
      cache,
      client: {
        disambiguation,
        entities,
        pages: () => Promise.resolve([]),
      },
      normalizer: {
        normalize: () => Promise.reject(new Error("not expected")),
      },
    });
    const input = [{ disambiguation: false, qid: "Q1" }] as const;

    const first = await collect(resolver.resolve(input));
    const second = await collect(resolver.resolve(input));

    expect(second).toEqual(first);
    expect(entities).toHaveBeenCalledTimes(1);
    expect(disambiguation).not.toHaveBeenCalled();
  });

  it("returns an explicit empty disambiguation array without eligible sites", async () => {
    const resolver = new DirectWikimediaResolver({
      cache: {
        get: () => Promise.resolve(new Map()),
        put: () => Promise.resolve(),
      },
      client: {
        disambiguation: () => Promise.reject(new Error("not expected")),
        entities: () =>
          Promise.resolve([
            { descriptions: {}, labels: {}, qid: "Q1", sitelinks: {} },
          ]),
        pages: () => Promise.resolve([]),
      },
      normalizer: {
        normalize: () => Promise.reject(new Error("not expected")),
      },
    });

    const [item] = await collect(
      resolver.resolve([{ disambiguation: true, qid: "Q1" }]),
    );

    expect(item?.resolution.disambiguation).toEqual([]);
  });
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

function cachedRecord(qid: string): CachedWikimediaQid {
  return {
    disambiguation: false,
    qid,
    refreshedAt: new Date().toISOString(),
    sites: [
      {
        output: { description: null, label: qid, url: null },
        wiki: "zhwiki",
      },
      {
        output: { description: null, label: qid, url: null },
        wiki: "enwiki",
      },
    ],
  };
}

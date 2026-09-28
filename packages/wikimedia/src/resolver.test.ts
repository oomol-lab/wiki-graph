import { describe, expect, it, vi } from "vitest";

import { DirectWikimediaResolver } from "./resolver.js";
import type { CachedWikimediaQid, WikimediaCache } from "./types.js";

describe("DirectWikimediaResolver", () => {
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

    const first = await resolver.resolve(input);
    const second = await resolver.resolve(input);

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

    const [result] = await resolver.resolve([
      { disambiguation: true, qid: "Q1" },
    ]);

    expect(result?.disambiguation).toEqual([]);
  });
});

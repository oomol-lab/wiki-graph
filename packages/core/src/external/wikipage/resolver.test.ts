import { describe, expect, it } from "vitest";

import { WikipageResolver } from "./resolver.js";

import type {
  CachedDisambiguationRecord,
  CachedQidRecord,
  EnrichmentStore,
  WikiClient,
} from "./types.js";
import type {
  ParsedDisambiguationPage,
  SupportedWiki,
  WikidataEntityInfo,
  WikiPageInfo,
} from "./wikimedia-client/index.js";

describe("wikipage/resolver adapter boundaries", () => {
  it("uses cached qid records without calling the wiki client", async () => {
    const client = new FakeWikiClient();
    const store = new FakeEnrichmentStore({
      qids: [qidRecord({ qid: "Q1", title: "Universe" })],
    });
    const resolver = createResolver(client, store);

    await expect(resolver.resolveQids(["Q1"])).resolves.toMatchObject([
      {
        isDisambiguation: false,
        label: "Universe",
        qid: "Q1",
      },
    ]);

    expect(client.calls).toStrictEqual([]);
    expect(store.putQidCalls).toStrictEqual([]);
  });

  it("fetches and stores qid misses through injected adapters", async () => {
    const client = new FakeWikiClient({
      entities: [
        [
          "Q1",
          {
            description: "totality of space and time",
            label: "Universe",
            qid: "Q1",
            sitelinks: [{ title: "Universe", wiki: "enwiki" }],
          },
        ],
      ],
      pages: [
        [
          "enwiki:Universe",
          {
            isDisambiguation: false,
            pageId: 1,
            title: "Universe",
            wiki: "enwiki",
            wikibaseItem: "Q1",
          },
        ],
      ],
    });
    const store = new FakeEnrichmentStore();
    const resolver = createResolver(client, store);

    await expect(resolver.resolveQids(["Q1"])).resolves.toMatchObject([
      {
        description: "totality of space and time",
        isDisambiguation: false,
        label: "Universe",
        qid: "Q1",
      },
    ]);

    expect(client.calls).toStrictEqual([
      "getEntities:Q1",
      "getPagesByTitles:enwiki:Universe",
    ]);
    expect(store.putQidCalls).toStrictEqual([["Q1"]]);
    expect(await store.getQids(["Q1"], "en")).toHaveProperty("size", 1);
  });

  it("expands and stores disambiguation misses through injected adapters", async () => {
    const client = new FakeWikiClient({
      pages: [
        [
          "enwiki:Mercury (planet)",
          {
            isDisambiguation: false,
            title: "Mercury (planet)",
            wiki: "enwiki",
            wikibaseItem: "Q308",
          },
        ],
      ],
      parsedPages: [
        [
          "enwiki:Mercury",
          {
            linkedTitles: ["Mercury (planet)"],
            pageId: 19007,
            text: "* [[Mercury|/wiki/Mercury_(planet)]], the planet",
            title: "Mercury",
            wiki: "enwiki",
          },
        ],
      ],
    });
    const store = new FakeEnrichmentStore({
      qids: [
        qidRecord({
          isDisambiguation: true,
          qid: "Q48397",
          title: "Mercury",
        }),
      ],
    });
    const resolver = createResolver(client, store);

    await expect(resolver.resolveQids(["Q48397"])).resolves.toMatchObject([
      {
        disambiguation: {
          disambiguationQid: "Q48397",
          linkedQids: [{ qid: "Q308", title: "Mercury (planet)" }],
          pages: [
            {
              pageId: 19007,
              title: "Mercury",
              wiki: "enwiki",
            },
          ],
        },
        isDisambiguation: true,
        qid: "Q48397",
      },
    ]);

    expect(client.calls).toStrictEqual([
      "parseDisambiguationPage:enwiki:Mercury",
      "getPagesByTitles:enwiki:Mercury (planet)",
    ]);
    expect(store.putDisambiguationCalls).toStrictEqual([["Q48397"]]);
  });
});

function createResolver(
  client: WikiClient,
  store: EnrichmentStore,
): WikipageResolver {
  return new WikipageResolver({
    client,
    language: "en",
    maxBatchSize: 50,
    normalizer: undefined,
    progress: undefined,
    store,
    wiki: "enwiki",
  });
}

function qidRecord(input: {
  readonly isDisambiguation?: boolean;
  readonly qid: string;
  readonly title: string;
}): CachedQidRecord {
  return {
    checkedAt: "2026-01-01T00:00:00.000Z",
    label: input.title,
    qid: input.qid,
    sitelinks: [
      {
        isDisambiguation: input.isDisambiguation ?? false,
        title: input.title,
        wiki: "enwiki",
      },
    ],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

class FakeEnrichmentStore implements EnrichmentStore {
  readonly #disambiguations = new Map<string, CachedDisambiguationRecord>();
  readonly #qids = new Map<string, CachedQidRecord>();

  public readonly putDisambiguationCalls: string[][] = [];
  public readonly putQidCalls: string[][] = [];

  public constructor(
    input: { readonly qids?: readonly CachedQidRecord[] } = {},
  ) {
    for (const record of input.qids ?? []) {
      this.#qids.set(record.qid, record);
    }
  }

  public getQids(
    qids: readonly string[],
    _language: string,
  ): Promise<ReadonlyMap<string, CachedQidRecord>> {
    return Promise.resolve(
      new Map(
        qids.flatMap((qid) => {
          const record = this.#qids.get(qid);

          return record === undefined ? [] : [[qid, record]];
        }),
      ),
    );
  }

  public putQids(
    records: readonly CachedQidRecord[],
    _language: string,
  ): Promise<void> {
    this.putQidCalls.push(records.map((record) => record.qid));
    for (const record of records) {
      this.#qids.set(record.qid, record);
    }

    return Promise.resolve();
  }

  public getDisambiguations(
    qids: readonly string[],
    _wiki: string,
  ): Promise<ReadonlyMap<string, CachedDisambiguationRecord>> {
    return Promise.resolve(
      new Map(
        qids.flatMap((qid) => {
          const record = this.#disambiguations.get(qid);

          return record === undefined ? [] : [[qid, record]];
        }),
      ),
    );
  }

  public putDisambiguations(
    records: readonly CachedDisambiguationRecord[],
    _wiki: string,
  ): Promise<void> {
    this.putDisambiguationCalls.push(
      records.map((record) => record.disambiguationQid),
    );
    for (const record of records) {
      this.#disambiguations.set(record.disambiguationQid, record);
    }

    return Promise.resolve();
  }
}

class FakeWikiClient implements WikiClient {
  readonly #entities: ReadonlyMap<string, WikidataEntityInfo>;
  readonly #pages: ReadonlyMap<string, WikiPageInfo>;
  readonly #parsedPages: ReadonlyMap<string, ParsedDisambiguationPage>;

  public readonly calls: string[] = [];

  public constructor(
    input: {
      readonly entities?: readonly (readonly [string, WikidataEntityInfo])[];
      readonly pages?: readonly (readonly [string, WikiPageInfo])[];
      readonly parsedPages?: readonly (readonly [
        string,
        ParsedDisambiguationPage,
      ])[];
    } = {},
  ) {
    this.#entities = new Map(input.entities ?? []);
    this.#pages = new Map(input.pages ?? []);
    this.#parsedPages = new Map(input.parsedPages ?? []);
  }

  public getEntities(
    qids: readonly string[],
  ): Promise<ReadonlyMap<string, WikidataEntityInfo>> {
    this.calls.push(`getEntities:${qids.join(",")}`);

    return Promise.resolve(
      new Map(
        qids.flatMap((qid) => {
          const entity = this.#entities.get(qid);

          return entity === undefined ? [] : [[qid, entity]];
        }),
      ),
    );
  }

  public getPagesByTitles(
    titles: readonly string[],
    wiki: SupportedWiki = "enwiki",
  ): Promise<ReadonlyMap<string, WikiPageInfo>> {
    this.calls.push(`getPagesByTitles:${wiki}:${titles.join(",")}`);

    return Promise.resolve(
      new Map(
        titles.flatMap((title) => {
          const page = this.#pages.get(`${wiki}:${title}`);

          return page === undefined ? [] : [[title, page]];
        }),
      ),
    );
  }

  public parseDisambiguationPage(
    title: string,
    wiki: SupportedWiki,
  ): Promise<ParsedDisambiguationPage> {
    this.calls.push(`parseDisambiguationPage:${wiki}:${title}`);
    const page = this.#parsedPages.get(`${wiki}:${title}`);

    if (page === undefined) {
      return Promise.reject(
        new Error(`No fake disambiguation page for ${wiki}:${title}`),
      );
    }

    return Promise.resolve(page);
  }
}

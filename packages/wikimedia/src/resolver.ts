import type {
  CachedWikimediaQid,
  CachedWikimediaSite,
  DisambiguationNormalizer,
  EntityData,
  PageMeta,
  Wiki,
  WikimediaCache,
  WikimediaClient,
  WikimediaDisambiguationItem,
  WikimediaResolution,
  WikimediaResolveInput,
  WikimediaResolver as WikimediaResolverContract,
} from "./types.js";

const WIKIS = ["zhwiki", "enwiki"] as const;
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1_000;

export class DirectWikimediaResolver implements WikimediaResolverContract {
  readonly #cache: WikimediaCache;
  readonly #client: WikimediaClient;
  readonly #normalizer: DisambiguationNormalizer;
  readonly #now: () => number;
  readonly #ttlMs: number;

  public constructor(options: {
    readonly cache: WikimediaCache;
    readonly client: WikimediaClient;
    readonly normalizer: DisambiguationNormalizer;
    readonly now?: () => number;
    readonly ttlMs?: number;
  }) {
    this.#cache = options.cache;
    this.#client = options.client;
    this.#normalizer = options.normalizer;
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  public async resolve(
    input: readonly WikimediaResolveInput[],
  ): Promise<readonly WikimediaResolution[]> {
    const normalized = input.map(normalizeInput);
    const unique = [
      ...new Map(normalized.map((item) => [item.qid, item])).values(),
    ];
    const cached = await this.#cache.get(unique.map((item) => item.qid));
    const records = new Map<string, CachedWikimediaQid>();
    const missing: WikimediaResolveInput[] = [];

    for (const item of unique) {
      const record = cached.get(item.qid);
      if (record !== undefined && this.#isCurrent(record, item)) {
        records.set(item.qid, record);
      } else {
        missing.push(item);
      }
    }

    if (missing.length > 0) {
      const entities = await this.#client.entities(
        missing.map((item) => item.qid),
      );
      const entitiesByQid = new Map(
        entities.map((entity) => [entity.qid, entity]),
      );
      const pages = await this.#fetchPages(entities);
      const rebuilt: CachedWikimediaQid[] = [];

      for (const item of missing) {
        const record = await this.#rebuild(
          item,
          entitiesByQid.get(item.qid),
          pages,
        );
        rebuilt.push(record);
        records.set(item.qid, record);
      }
      await this.#cache.put(rebuilt);
    }

    return normalized.map((item) => toResolution(records.get(item.qid)!));
  }

  #isCurrent(
    record: CachedWikimediaQid,
    input: WikimediaResolveInput,
  ): boolean {
    const refreshedAt = Date.parse(record.refreshedAt);
    return (
      record.disambiguation === input.disambiguation &&
      Number.isFinite(refreshedAt) &&
      this.#now() - refreshedAt <= this.#ttlMs &&
      WIKIS.every((wiki) => record.sites.some((site) => site.wiki === wiki))
    );
  }

  async #fetchPages(
    entities: readonly EntityData[],
  ): Promise<ReadonlyMap<Wiki, ReadonlyMap<string, PageMeta>>> {
    const results = new Map<Wiki, ReadonlyMap<string, PageMeta>>();
    for (const wiki of WIKIS) {
      const titles = [
        ...new Set(
          entities.flatMap((entity) => {
            const title = entity.sitelinks[wiki];
            return title === undefined ? [] : [title];
          }),
        ),
      ];
      const pages = await this.#client.pages(wiki, titles);
      results.set(
        wiki,
        new Map(
          pages.flatMap((page) => [
            [page.requestedTitle ?? page.title, page],
            [page.title, page],
          ]),
        ),
      );
    }
    return results;
  }

  async #rebuild(
    input: WikimediaResolveInput,
    entity: EntityData | undefined,
    pages: ReadonlyMap<Wiki, ReadonlyMap<string, PageMeta>>,
  ): Promise<CachedWikimediaQid> {
    const sites: CachedWikimediaSite[] = [];
    for (const wiki of WIKIS) {
      const language = wiki === "zhwiki" ? "zh" : "en";
      const sourceTitle = entity?.sitelinks[wiki];
      const page =
        sourceTitle === undefined
          ? undefined
          : pages.get(wiki)?.get(sourceTitle);
      const output = {
        description:
          entity?.descriptions[language] ?? page?.description ?? null,
        label: entity?.labels[language] ?? page?.title ?? null,
        url: page?.url ?? null,
      };
      if (input.disambiguation && page?.isDisambiguation === true) {
        const parsedPage = await this.#client.disambiguation(page);
        const profile = await this.#normalizer.normalize({
          page: parsedPage,
          sourceQid: input.qid,
          wiki,
        });
        sites.push({
          output,
          page,
          parsedPage,
          profile,
          ...(sourceTitle === undefined ? {} : { sourceTitle }),
          wiki,
        });
      } else {
        sites.push({
          output,
          ...(page === undefined ? {} : { page }),
          ...(sourceTitle === undefined ? {} : { sourceTitle }),
          wiki,
        });
      }
    }
    return {
      disambiguation: input.disambiguation,
      qid: input.qid,
      refreshedAt: new Date(this.#now()).toISOString(),
      sites,
    };
  }
}

function normalizeInput(input: WikimediaResolveInput): WikimediaResolveInput {
  const qid = input.qid.trim().toUpperCase();
  if (!/^Q[1-9][0-9]*$/u.test(qid)) {
    throw new Error(`Invalid QID: ${input.qid}`);
  }
  return { disambiguation: input.disambiguation, qid };
}

function toResolution(record: CachedWikimediaQid): WikimediaResolution {
  const sites = new Map(record.sites.map((site) => [site.wiki, site]));
  return {
    ...(record.disambiguation
      ? {
          disambiguation: fuseMeanings(
            record.sites.flatMap((site) => site.profile?.meanings ?? []),
          ),
        }
      : {}),
    en: sites.get("enwiki")?.output ?? emptyLanguageProfile(),
    qid: record.qid,
    zh: sites.get("zhwiki")?.output ?? emptyLanguageProfile(),
  };
}

function fuseMeanings(
  meanings: readonly WikimediaDisambiguationItem[],
): readonly WikimediaDisambiguationItem[] {
  return [
    ...new Map(meanings.map((meaning) => [meaning.qid, meaning])).values(),
  ];
}

function emptyLanguageProfile() {
  return { description: null, label: null, url: null } as const;
}

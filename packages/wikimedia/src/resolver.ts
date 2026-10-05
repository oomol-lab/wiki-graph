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
  WikimediaResolvedItem,
  WikimediaResolveInput,
  WikimediaResolver as WikimediaResolverContract,
} from "./types.js";

const WIKIS = ["zhwiki", "enwiki"] as const;
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const RESOLUTION_BATCH_SIZE = 50;

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

  public async *resolve(
    input: readonly WikimediaResolveInput[],
    options?: { readonly signal?: AbortSignal },
  ): AsyncIterable<WikimediaResolvedItem> {
    const signal = options?.signal;
    const normalized = input.map(normalizeInput);
    const grouped = groupInputs(normalized);
    signal?.throwIfAborted();
    const missing: GroupedInput[] = [];

    for (const batch of batches(grouped, RESOLUTION_BATCH_SIZE)) {
      signal?.throwIfAborted();
      const cached = await this.#cache.get(
        [...new Set(batch.map(({ input: item }) => item.qid))],
        options,
      );
      signal?.throwIfAborted();
      for (const item of batch) {
        const record = cached.get(item.input.qid);
        if (record !== undefined && this.#isCurrent(record, item)) {
          const resolution = toResolution(record);
          for (const index of item.indexes) {
            yield { index, resolution };
          }
        } else {
          missing.push(item);
        }
      }
    }

    for (const batch of batches(missing, RESOLUTION_BATCH_SIZE)) {
      signal?.throwIfAborted();
      const entities = await this.#client.entities(
        [...new Set(batch.map(({ input: item }) => item.qid))],
        options,
      );
      signal?.throwIfAborted();
      const entitiesByQid = new Map(
        entities.map((entity) => [entity.qid, entity]),
      );
      const pages = await this.#fetchPages(entities, options);

      for (const item of batch) {
        signal?.throwIfAborted();
        const record = await this.#rebuild(
          item.input,
          entitiesByQid.get(item.input.qid),
          pages,
          options,
        );
        signal?.throwIfAborted();
        await this.#cache.put([record], options);
        const resolution = toResolution(record);
        for (const index of item.indexes) {
          yield { index, resolution };
        }
      }
    }
  }

  #isCurrent(record: CachedWikimediaQid, input: GroupedInput): boolean {
    const refreshedAt = Date.parse(record.refreshedAt);
    return (
      record.disambiguation === input.input.disambiguation &&
      Number.isFinite(refreshedAt) &&
      this.#now() - refreshedAt <= this.#ttlMs &&
      WIKIS.every((wiki) => record.sites.some((site) => site.wiki === wiki))
    );
  }

  async #fetchPages(
    entities: readonly EntityData[],
    options?: { readonly signal?: AbortSignal },
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
      options?.signal?.throwIfAborted();
      const pages = await this.#client.pages(wiki, titles, options);
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
    options?: { readonly signal?: AbortSignal },
  ): Promise<CachedWikimediaQid> {
    const sites: CachedWikimediaSite[] = [];
    for (const wiki of WIKIS) {
      options?.signal?.throwIfAborted();
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
        const parsedPage = await this.#client.disambiguation(page, options);
        const profile = await this.#normalizer.normalize(
          {
            page: parsedPage,
            sourceQid: input.qid,
            wiki,
          },
          options,
        );
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

interface GroupedInput {
  readonly indexes: readonly number[];
  readonly input: WikimediaResolveInput;
}

function groupInputs(
  input: readonly WikimediaResolveInput[],
): readonly GroupedInput[] {
  const groups = new Map<
    string,
    { indexes: number[]; input: WikimediaResolveInput }
  >();
  input.forEach((item, index) => {
    const key = `${item.qid}\0${item.disambiguation ? "1" : "0"}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { indexes: [index], input: item });
    } else {
      group.indexes.push(index);
    }
  });
  return [...groups.values()];
}

function batches<T>(
  values: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
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

import { WikipageCache } from "./cache.js";
import {
  WikimediaClient,
  type WikiPageInfo,
  type WikidataEntityInfo,
} from "./wikimedia-client.js";
import type {
  CachedDisambiguationRecord,
  CachedQidRecord,
  DisambiguationExpansion,
  DisambiguationOption,
  QidResolution,
  WikipageResolverOptions,
} from "./types.js";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_LANGUAGE = "en";
const DEFAULT_MAX_BATCH_SIZE = 50;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 100;
const DEFAULT_USER_AGENT =
  "WikiGraph/0.3 (https://github.com/oomol-lab/spinedigest)";

export class WikipageResolver {
  readonly #cache: WikipageCache;
  readonly #client: WikimediaClient;
  readonly #language: string;
  readonly #maxBatchSize: number;
  readonly #ownsCache: boolean;
  readonly #wiki: string;

  private constructor(input: {
    readonly cache: WikipageCache;
    readonly client: WikimediaClient;
    readonly language: string;
    readonly maxBatchSize: number;
    readonly ownsCache: boolean;
    readonly wiki: string;
  }) {
    this.#cache = input.cache;
    this.#client = input.client;
    this.#language = input.language;
    this.#maxBatchSize = input.maxBatchSize;
    this.#ownsCache = input.ownsCache;
    this.#wiki = input.wiki;
  }

  public static async open(
    options: WikipageResolverOptions = {},
  ): Promise<WikipageResolver> {
    const language = normalizeLanguage(options.language);
    const wiki = options.wiki ?? `${language}wiki`;
    const cache = await WikipageCache.open(options.cacheDatabasePath);

    return new WikipageResolver({
      cache,
      client: new WikimediaClient({
        concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
        language,
        minRequestIntervalMs:
          options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS,
        userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
        wiki,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      }),
      language,
      maxBatchSize: normalizeBatchSize(options.maxBatchSize),
      ownsCache: true,
      wiki,
    });
  }

  public async close(): Promise<void> {
    if (this.#ownsCache) {
      await this.#cache.close();
    }
  }

  public async resolveQids(
    qids: readonly string[],
  ): Promise<readonly QidResolution[]> {
    const normalizedQids = normalizeQids(qids);
    const qidRecords = await this.#resolveQidRecords(normalizedQids);
    const disambiguationRecords = await this.#resolveDisambiguations(
      [...qidRecords.values()].filter((record) => record.isDisambiguation),
    );

    return normalizedQids.map((qid) => {
      const record = qidRecords.get(qid);

      if (record === undefined) {
        return {
          isDisambiguation: false,
          qid,
        };
      }

      const disambiguation = disambiguationRecords.get(qid);

      return {
        ...(record.description === undefined
          ? {}
          : { description: record.description }),
        ...(disambiguation === undefined
          ? {}
          : { disambiguation: toDisambiguationExpansion(disambiguation) }),
        isDisambiguation: record.isDisambiguation,
        ...(record.label === undefined ? {} : { label: record.label }),
        qid,
        ...(record.sitelinkTitle === undefined ||
        record.sitelinkWiki === undefined
          ? {}
          : {
              sitelink: {
                title: record.sitelinkTitle,
                wiki: record.sitelinkWiki,
              },
            }),
      };
    });
  }

  async #resolveQidRecords(
    qids: readonly string[],
  ): Promise<ReadonlyMap<string, CachedQidRecord>> {
    const cached = new Map(await this.#cache.getQids(qids));
    const missing = qids.filter((qid) => !cached.has(qid));

    for (const batch of chunk(missing, this.#maxBatchSize)) {
      const entityInfos = await this.#client.getEntities(batch);
      const pageInfos = await this.#fetchPageInfos(entityInfos);
      const now = new Date().toISOString();
      const records = batch.map((qid) =>
        createQidRecord(qid, entityInfos.get(qid), pageInfos, now),
      );

      await this.#cache.putQids(records);
      for (const record of records) {
        cached.set(record.qid, record);
      }
    }

    return cached;
  }

  async #fetchPageInfos(
    entityInfos: ReadonlyMap<string, WikidataEntityInfo>,
  ): Promise<ReadonlyMap<string, WikiPageInfo>> {
    const titles = [...entityInfos.values()]
      .map((entity) => entity.sitelinkTitle)
      .filter((title): title is string => title !== undefined);
    const results = new Map<string, WikiPageInfo>();

    for (const batch of chunk([...new Set(titles)], this.#maxBatchSize)) {
      for (const [title, page] of await this.#client.getPagesByTitles(batch)) {
        results.set(title, page);
      }
    }

    return results;
  }

  async #resolveDisambiguations(
    records: readonly CachedQidRecord[],
  ): Promise<ReadonlyMap<string, CachedDisambiguationRecord>> {
    const qids = records.map((record) => record.qid);
    const cached = new Map(await this.#cache.getDisambiguations(qids));
    const missing = records.filter(
      (record) => !cached.has(record.qid) && record.sitelinkTitle !== undefined,
    );

    for (const record of missing) {
      const expansion = await this.#expandDisambiguation(record);

      await this.#cache.putDisambiguations([expansion]);
      cached.set(record.qid, expansion);
    }

    return cached;
  }

  async #expandDisambiguation(
    record: CachedQidRecord,
  ): Promise<CachedDisambiguationRecord> {
    const pageTitle = record.sitelinkTitle;

    if (pageTitle === undefined) {
      throw new Error(`QID ${record.qid} has no ${this.#wiki} sitelink.`);
    }

    const parsedPage = await this.#client.parseDisambiguationPage(pageTitle);
    const linkedPageInfos = new Map<string, WikiPageInfo>();

    for (const batch of chunk(
      parsedPage.links.map((link) => link.title),
      this.#maxBatchSize,
    )) {
      for (const [title, page] of await this.#client.getPagesByTitles(batch)) {
        linkedPageInfos.set(title, page);
      }
    }

    const optionQids = parsedPage.links
      .map((link) => linkedPageInfos.get(link.title)?.wikibaseItem)
      .filter((qid): qid is string => qid !== undefined);
    const optionRecords = await this.#resolveQidRecords(optionQids);
    const options = parsedPage.links.flatMap((link): DisambiguationOption[] => {
      const qid = linkedPageInfos.get(link.title)?.wikibaseItem;

      if (qid === undefined) {
        return [];
      }

      const optionRecord = optionRecords.get(qid);

      return [
        {
          ...(optionRecord?.description === undefined
            ? {}
            : { description: optionRecord.description }),
          ...(link.hint === undefined ? {} : { hint: link.hint }),
          ...(optionRecord?.isDisambiguation === undefined
            ? {}
            : { isDisambiguation: optionRecord.isDisambiguation }),
          ...(optionRecord?.label === undefined
            ? {}
            : { label: optionRecord.label }),
          qid,
          ...(link.hint === undefined ? {} : { sourceLine: link.hint }),
          title: link.title,
        },
      ];
    });

    return {
      checkedAt: new Date().toISOString(),
      disambiguationQid: record.qid,
      language: this.#language,
      options,
      ...(parsedPage.pageId === undefined ? {} : { pageId: parsedPage.pageId }),
      pageTitle: parsedPage.title,
      wiki: this.#wiki,
    };
  }
}

function createQidRecord(
  qid: string,
  entityInfo: WikidataEntityInfo | undefined,
  pageInfos: ReadonlyMap<string, WikiPageInfo>,
  now: string,
): CachedQidRecord {
  const pageInfo =
    entityInfo?.sitelinkTitle === undefined
      ? undefined
      : pageInfos.get(entityInfo.sitelinkTitle);

  return {
    checkedAt: now,
    ...(entityInfo?.description === undefined
      ? {}
      : { description: entityInfo.description }),
    isDisambiguation: pageInfo?.isDisambiguation ?? false,
    ...(entityInfo?.label === undefined ? {} : { label: entityInfo.label }),
    ...(pageInfo?.pageId === undefined ? {} : { pageId: pageInfo.pageId }),
    qid,
    ...(entityInfo?.sitelinkTitle === undefined
      ? {}
      : { sitelinkTitle: entityInfo.sitelinkTitle }),
    ...(entityInfo?.sitelinkWiki === undefined
      ? {}
      : { sitelinkWiki: entityInfo.sitelinkWiki }),
    updatedAt: now,
  };
}

function toDisambiguationExpansion(
  record: CachedDisambiguationRecord,
): DisambiguationExpansion {
  return {
    checkedAt: record.checkedAt,
    disambiguationQid: record.disambiguationQid,
    language: record.language,
    options: record.options,
    ...(record.pageId === undefined ? {} : { pageId: record.pageId }),
    pageTitle: record.pageTitle,
    wiki: record.wiki,
  };
}

function normalizeQids(qids: readonly string[]): readonly string[] {
  return [
    ...new Set(
      qids
        .map((qid) => qid.trim().toUpperCase())
        .filter((qid) => /^Q[1-9]\d*$/u.test(qid)),
    ),
  ];
}

function normalizeLanguage(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();

  return normalized === undefined || normalized === ""
    ? DEFAULT_LANGUAGE
    : normalized;
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_BATCH_SIZE;
  }

  return Math.max(1, Math.floor(value));
}

function chunk<T>(items: readonly T[], size: number): readonly T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

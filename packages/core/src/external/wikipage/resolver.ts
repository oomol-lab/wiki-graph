import { WikipageCache } from "./cache.js";
import { createWikipageFetchLog } from "./fetch-log.js";
import { GuaranteedRequestFailureError } from "../guaranteed/index.js";
import {
  WikimediaClient,
  replaceTitleUriWithQidUri,
  type SupportedWiki,
  type WikiPageInfo,
  type WikidataEntityInfo,
} from "./wikimedia-client/index.js";
import type {
  CachedDisambiguationRecord,
  CachedPageRecord,
  CachedQidRecord,
  DisambiguationExpansion,
  DisambiguationLinkedQid,
  DisambiguationPageText,
  DisambiguationProfileNormalizer,
  EnrichmentStore,
  QidResolution,
  WikiClient,
  WikipageResolveProgressReporter,
  WikipageResolverOptions,
} from "./types.js";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_LANGUAGE = "zh";
const DEFAULT_MAX_BATCH_SIZE = 50;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 100;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_TIMES = 3;
const DEFAULT_USER_AGENT =
  "WikiGraph/0.3 (https://github.com/oomol-lab/wiki-graph)";
const DISAMBIGUATION_PROFILE_ERROR_RETRY_DELAY_MS = 6 * 60 * 60 * 1_000;

export class WikipageResolver {
  readonly #client: WikiClient;
  readonly #maxBatchSize: number;
  readonly #language: string;
  readonly #normalizer: DisambiguationProfileNormalizer | undefined;
  readonly #ownsStore: boolean;
  readonly #progress: WikipageResolveProgressReporter | undefined;
  readonly #store: EnrichmentStore;
  readonly #wiki: string;

  public constructor(input: {
    readonly client: WikiClient;
    readonly language: string;
    readonly maxBatchSize: number;
    readonly normalizer: DisambiguationProfileNormalizer | undefined;
    readonly ownsStore?: boolean;
    readonly progress: WikipageResolveProgressReporter | undefined;
    readonly store: EnrichmentStore;
    readonly wiki: string;
  }) {
    this.#client = input.client;
    this.#language = input.language;
    this.#maxBatchSize = input.maxBatchSize;
    this.#normalizer = input.normalizer;
    this.#ownsStore = input.ownsStore ?? false;
    this.#progress = input.progress;
    this.#store = input.store;
    this.#wiki = input.wiki;
  }

  public static async open(
    options: WikipageResolverOptions = {},
  ): Promise<WikipageResolver> {
    const language = normalizeLanguage(options.language);
    const wiki = options.wiki ?? `${language}wiki`;
    const cache = await WikipageCache.open(options.cacheDatabasePath);

    return new WikipageResolver({
      client: new WikimediaClient({
        concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
        language,
        requestLog: createWikipageFetchLog(options.logDirPath),
        minRequestIntervalMs:
          options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS,
        retryBaseDelayMs:
          options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
        retryTimes: options.retryTimes ?? DEFAULT_RETRY_TIMES,
        userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
        wiki,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      }),
      language,
      maxBatchSize: normalizeBatchSize(options.maxBatchSize),
      normalizer: options.normalizer,
      ownsStore: true,
      progress: options.progress,
      store: cache,
      wiki,
    });
  }

  public async close(): Promise<void> {
    if (this.#ownsStore && isClosableStore(this.#store)) {
      await this.#store.close();
    }
  }

  public async resolveQids(
    qids: readonly string[],
  ): Promise<readonly QidResolution[]> {
    const normalizedQids = normalizeQids(qids);
    const qidRecords = await this.#resolveQidRecords(normalizedQids);
    const disambiguationRecords = await this.#resolveDisambiguations(
      [...qidRecords.values()].filter(hasDisambiguationPage),
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
      const disambiguationPages = disambiguation?.pages ?? [];
      const primarySitelink = pickPrimarySitelink(record.sitelinks, this.#wiki);

      return {
        ...(record.description === undefined
          ? {}
          : { description: record.description }),
        ...(disambiguation === undefined
          ? {}
          : { disambiguation: toDisambiguationExpansion(disambiguation) }),
        ...(disambiguationPages.length === 0 ? {} : { disambiguationPages }),
        isDisambiguation: disambiguationPages.length > 0,
        ...(record.label === undefined ? {} : { label: record.label }),
        qid,
        ...(primarySitelink === undefined ? {} : { sitelink: primarySitelink }),
        ...(record.sitelinks.length === 0
          ? {}
          : { sitelinks: record.sitelinks.map(toSitelink) }),
      };
    });
  }

  async #resolveQidRecords(
    qids: readonly string[],
  ): Promise<ReadonlyMap<string, CachedQidRecord>> {
    const cached = new Map(await this.#store.getQids(qids, this.#language));
    const missing = qids.filter((qid) => !cached.has(qid));
    let resolvedQids = cached.size;
    let resolvedEntities = 0;

    await this.#reportProgress("qid", resolvedQids, qids.length);

    for (const batch of chunk(missing, this.#maxBatchSize)) {
      const entityInfos = await this.#client.getEntities(batch);
      resolvedEntities += batch.length;
      await this.#reportProgress("entity", resolvedEntities, missing.length);
      const pageInfos = await this.#fetchPageInfos(entityInfos);
      const now = new Date().toISOString();
      const records = batch.map((qid) =>
        createQidRecord(qid, entityInfos.get(qid), pageInfos, now),
      );

      await this.#store.putQids(records, this.#language);
      for (const record of records) {
        cached.set(record.qid, record);
      }
      resolvedQids += batch.length;
      await this.#reportProgress("qid", resolvedQids, qids.length);
    }

    return cached;
  }

  async #fetchPageInfos(
    entityInfos: ReadonlyMap<string, WikidataEntityInfo>,
  ): Promise<ReadonlyMap<string, WikiPageInfo>> {
    const results = new Map<string, WikiPageInfo>();
    const titlesByWiki = new Map<SupportedWiki, Set<string>>();

    for (const entity of entityInfos.values()) {
      for (const sitelink of entity.sitelinks) {
        const titles = titlesByWiki.get(sitelink.wiki) ?? new Set<string>();

        titles.add(sitelink.title);
        titlesByWiki.set(sitelink.wiki, titles);
      }
    }

    for (const [wiki, titles] of titlesByWiki) {
      for (const batch of chunk([...titles], this.#maxBatchSize)) {
        for (const [title, page] of await this.#client.getPagesByTitles(
          batch,
          wiki,
        )) {
          results.set(pageKey(wiki, title), page);
        }
        await this.#reportProgress(
          "page",
          results.size,
          countTitleSetItems(titlesByWiki),
        );
      }
    }

    return results;
  }

  async #resolveDisambiguations(
    records: readonly CachedQidRecord[],
  ): Promise<ReadonlyMap<string, CachedDisambiguationRecord>> {
    const qids = records.map((record) => record.qid);
    const cached = new Map(
      await this.#store.getDisambiguations(qids, this.#wiki),
    );
    const missing = records.filter((record) => !cached.has(record.qid));
    let resolvedPages = cached.size;

    await this.#reportProgress(
      "disambiguation-page",
      resolvedPages,
      qids.length,
    );

    for (const record of missing) {
      const expansion = await this.#expandDisambiguation(record);

      await this.#store.putDisambiguations([expansion], this.#wiki);
      cached.set(record.qid, expansion);
      resolvedPages += 1;
      await this.#reportProgress(
        "disambiguation-page",
        resolvedPages,
        qids.length,
      );
    }

    return cached;
  }

  async #expandDisambiguation(
    record: CachedQidRecord,
  ): Promise<CachedDisambiguationRecord> {
    const pages: DisambiguationPageText[] = [];

    for (const page of record.sitelinks.filter(
      (item) => item.isDisambiguation,
    )) {
      const parsedPage = await this.#client.parseDisambiguationPage(
        page.title,
        page.wiki,
      );
      const linkedPageInfos = new Map<string, WikiPageInfo>();

      for (const batch of chunk(parsedPage.linkedTitles, this.#maxBatchSize)) {
        for (const [title, linkedPage] of await this.#client.getPagesByTitles(
          batch,
          page.wiki,
        )) {
          linkedPageInfos.set(title, linkedPage);
        }
        await this.#reportProgress(
          "linked-page",
          linkedPageInfos.size,
          parsedPage.linkedTitles.length,
        );
      }

      const titleToQid = new Map<string, string>();
      const linkedQids: DisambiguationLinkedQid[] = [];

      for (const title of parsedPage.linkedTitles) {
        const qid = linkedPageInfos.get(title)?.wikibaseItem;

        if (qid === undefined) {
          continue;
        }

        titleToQid.set(title, qid);
        linkedQids.push({ qid, title });
      }

      pages.push({
        linkedQids,
        ...(parsedPage.pageId === undefined
          ? {}
          : { pageId: parsedPage.pageId }),
        text: replaceTitleUriWithQidUri(parsedPage.text, titleToQid),
        title: parsedPage.title,
        wiki: parsedPage.wiki,
      });
    }

    const linkedQids = mergeLinkedQids(pages);
    const profileResult = await this.#normalizeDisambiguationProfile(
      record,
      pages,
      linkedQids,
    );

    return {
      checkedAt: new Date().toISOString(),
      disambiguationQid: record.qid,
      pages,
      ...profileResult,
    };
  }

  async #normalizeDisambiguationProfile(
    record: CachedQidRecord,
    pages: readonly DisambiguationPageText[],
    linkedQids: readonly DisambiguationLinkedQid[],
  ): Promise<Pick<CachedDisambiguationRecord, "profile" | "profileError">> {
    if (this.#normalizer === undefined || linkedQids.length === 0) {
      return {};
    }

    try {
      return {
        profile: await this.#normalizer({
          pageQidLinks: linkedQids,
          pages,
          sourceQid: record.qid,
          ...(record.label === undefined ? {} : { surface: record.label }),
        }),
      };
    } catch (error) {
      if (!(error instanceof GuaranteedRequestFailureError)) {
        throw error;
      }

      const failedAt = new Date();
      const retryAfter = new Date(
        failedAt.getTime() + DISAMBIGUATION_PROFILE_ERROR_RETRY_DELAY_MS,
      );

      return {
        profileError: {
          failedAt: failedAt.toISOString(),
          message: error.message,
          retryAfter: retryAfter.toISOString(),
        },
      };
    }
  }

  async #reportProgress(
    detail: Parameters<WikipageResolveProgressReporter>[0]["detail"],
    done: number,
    total: number,
  ): Promise<void> {
    await this.#progress?.({
      detail,
      done: Math.min(Math.max(0, done), Math.max(0, total)),
      total: Math.max(0, total),
    });
  }
}

function createQidRecord(
  qid: string,
  entityInfo: WikidataEntityInfo | undefined,
  pageInfos: ReadonlyMap<string, WikiPageInfo>,
  now: string,
): CachedQidRecord {
  return {
    checkedAt: now,
    ...(entityInfo?.description === undefined
      ? {}
      : { description: entityInfo.description }),
    ...(entityInfo?.label === undefined ? {} : { label: entityInfo.label }),
    qid,
    sitelinks:
      entityInfo?.sitelinks.flatMap((sitelink): CachedPageRecord[] => {
        const page = pageInfos.get(pageKey(sitelink.wiki, sitelink.title));

        if (page === undefined) {
          return [];
        }

        return [
          {
            isDisambiguation: page.isDisambiguation,
            ...(page.pageId === undefined ? {} : { pageId: page.pageId }),
            title: page.title,
            wiki: page.wiki,
          },
        ];
      }) ?? [],
    updatedAt: now,
  };
}

function toDisambiguationExpansion(
  record: CachedDisambiguationRecord,
): DisambiguationExpansion {
  return {
    checkedAt: record.checkedAt,
    disambiguationQid: record.disambiguationQid,
    linkedQids: mergeLinkedQids(record.pages),
    pages: record.pages,
    ...(record.profile === undefined ? {} : { profile: record.profile }),
  };
}

function mergeLinkedQids(
  pages: readonly DisambiguationPageText[],
): readonly DisambiguationLinkedQid[] {
  const results = new Map<string, DisambiguationLinkedQid>();

  for (const page of pages) {
    for (const item of page.linkedQids) {
      results.set(item.qid, item);
    }
  }

  return [...results.values()];
}

function countTitleSetItems(
  input: ReadonlyMap<SupportedWiki, Set<string>>,
): number {
  let count = 0;

  for (const titles of input.values()) {
    count += titles.size;
  }

  return count;
}

function hasDisambiguationPage(record: CachedQidRecord): boolean {
  return record.sitelinks.some((page) => page.isDisambiguation);
}

function pickPrimarySitelink(
  pages: readonly CachedPageRecord[],
  wiki: string,
): { readonly title: string; readonly wiki: string } | undefined {
  const preferred = pages.find((page) => page.wiki === wiki) ?? pages[0];

  return preferred === undefined ? undefined : toSitelink(preferred);
}

function toSitelink(page: CachedPageRecord): {
  readonly title: string;
  readonly wiki: string;
} {
  return {
    title: page.title,
    wiki: page.wiki,
  };
}

function isClosableStore(
  store: EnrichmentStore,
): store is EnrichmentStore & { readonly close: () => Promise<void> } {
  return "close" in store && typeof store.close === "function";
}

function pageKey(wiki: SupportedWiki, title: string): string {
  return `${wiki}:${title}`;
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

  if (normalized === "en" || normalized === "zh") {
    return normalized;
  }

  return DEFAULT_LANGUAGE;
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

import type {
  CachedWikimediaDisambiguation,
  CachedWikimediaQid,
  CachedWikimediaSite,
  DisambiguationNormalizer,
  EntityData,
  PageMeta,
  Wiki,
  WikimediaCache,
  WikimediaCacheStats,
  WikimediaClient,
  WikimediaDisambiguationCacheKey,
  WikimediaDisambiguationItem,
  WikimediaResolution,
  WikimediaResolvedItem,
  WikimediaResolveInput,
  WikimediaResolver as WikimediaResolverContract,
} from "./types.js";

const WIKIS = ["zhwiki", "enwiki"] as const;
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const RESOLUTION_BATCH_SIZE = 50;

interface MutableCacheStats {
  level1Expired: number;
  level1Hit: number;
  level1Miss: number;
  level2Hit: number;
  level2Miss: number;
  singleflightLeader: number;
  singleflightWaiter: number;
}

interface GroupedInput {
  readonly disambiguationIndexes: readonly number[];
  readonly plainIndexes: readonly number[];
  readonly qid: string;
}

interface DisambiguationTarget {
  readonly key: WikimediaDisambiguationCacheKey;
  readonly page: PageMeta;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T) => void;
}

export class DirectWikimediaResolver implements WikimediaResolverContract {
  readonly #cache: WikimediaCache;
  readonly #client: WikimediaClient;
  readonly #disambiguationFlights = new Map<
    string,
    Promise<CachedWikimediaDisambiguation>
  >();
  readonly #normalizer: DisambiguationNormalizer;
  readonly #now: () => number;
  readonly #observeCache: ((stats: WikimediaCacheStats) => void) | undefined;
  readonly #qidFlights = new Map<string, Promise<CachedWikimediaQid>>();
  readonly #ttlMs: number;

  public constructor(options: {
    readonly cache: WikimediaCache;
    readonly client: WikimediaClient;
    readonly normalizer: DisambiguationNormalizer;
    readonly now?: () => number;
    readonly observeCache?: (stats: WikimediaCacheStats) => void;
    readonly ttlMs?: number;
  }) {
    this.#cache = options.cache;
    this.#client = options.client;
    this.#normalizer = options.normalizer;
    this.#now = options.now ?? Date.now;
    this.#observeCache = options.observeCache;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  public async *resolve(
    input: readonly WikimediaResolveInput[],
    options?: { readonly signal?: AbortSignal },
  ): AsyncIterable<WikimediaResolvedItem> {
    const stats = emptyStats();
    try {
      const grouped = groupInputs(input.map(normalizeInput));
      options?.signal?.throwIfAborted();

      for (const batch of batches(grouped, RESOLUTION_BATCH_SIZE)) {
        options?.signal?.throwIfAborted();
        const cached = await this.#cache.getQids(
          batch.map(({ qid }) => qid),
          options,
        );
        const current = new Map<string, CachedWikimediaQid>();
        const missing: GroupedInput[] = [];
        for (const group of batch) {
          const record = cached.get(group.qid);
          if (record !== undefined && this.#isCurrent(record)) {
            current.set(group.qid, record);
            stats.level1Hit += 1;
          } else {
            missing.push(group);
            if (record === undefined) stats.level1Miss += 1;
            else stats.level1Expired += 1;
          }
        }
        yield* this.#resolveBatch(
          batch.filter(({ qid }) => current.has(qid)),
          current,
          stats,
          options,
        );
        if (missing.length > 0) {
          const rebuilt = await this.#resolveMissingQids(
            missing.map(({ qid }) => qid),
            stats,
            options,
          );
          yield* this.#resolveBatch(missing, rebuilt, stats, options);
        }
      }
    } finally {
      this.#observeCache?.(stats);
    }
  }

  async #resolveMissingQids(
    missing: readonly string[],
    stats: MutableCacheStats,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadonlyMap<string, CachedWikimediaQid>> {
    const records = new Map<string, CachedWikimediaQid>();
    const leaders: Array<{
      deferred: Deferred<CachedWikimediaQid>;
      qid: string;
    }> = [];
    const pending = new Map<string, Promise<CachedWikimediaQid>>();
    for (const qid of missing) {
      const active = this.#qidFlights.get(qid);
      if (active !== undefined) {
        stats.singleflightWaiter += 1;
        pending.set(qid, active);
        continue;
      }
      const deferred = createDeferred<CachedWikimediaQid>();
      this.#qidFlights.set(qid, deferred.promise);
      pending.set(qid, deferred.promise);
      leaders.push({ deferred, qid });
      stats.singleflightLeader += 1;
    }

    if (leaders.length > 0) {
      try {
        const rebuilt = await this.#rebuildQids(
          leaders.map(({ qid }) => qid),
          options,
        );
        await this.#cache.putQids([...rebuilt.values()], options);
        for (const leader of leaders) {
          const record = rebuilt.get(leader.qid);
          if (record === undefined) {
            throw new Error(`Wikimedia rebuild omitted ${leader.qid}`);
          }
          leader.deferred.resolve(record);
        }
      } catch (error) {
        for (const { deferred } of leaders) deferred.reject(error);
      } finally {
        for (const { qid } of leaders) this.#qidFlights.delete(qid);
      }
    }

    for (const [qid, promise] of pending) {
      records.set(qid, await withSignal(promise, options?.signal));
    }
    return records;
  }

  async *#resolveBatch(
    groups: readonly GroupedInput[],
    records: ReadonlyMap<string, CachedWikimediaQid>,
    stats: MutableCacheStats,
    options?: { readonly signal?: AbortSignal },
  ): AsyncIterable<WikimediaResolvedItem> {
    for (const group of groups) {
      const record = requiredRecord(records, group.qid);
      const resolution = toResolution(record);
      for (const index of group.plainIndexes) yield { index, resolution };
    }

    const targets = groups.flatMap((group): readonly DisambiguationTarget[] => {
      if (group.disambiguationIndexes.length === 0) return [];
      return requiredRecord(records, group.qid).sites.flatMap((site) => {
        const page = site.page;
        return page?.isDisambiguation === true
          ? [
              {
                key: {
                  pageId: page.pageId,
                  qid: group.qid,
                  revisionId: page.revisionId,
                  wiki: site.wiki,
                },
                page,
              },
            ]
          : [];
      });
    });
    const disambiguations = await this.#resolveDisambiguations(
      targets,
      stats,
      options,
    );

    for (const group of groups) {
      if (group.disambiguationIndexes.length === 0) continue;
      const record = requiredRecord(records, group.qid);
      const resolution = toResolution(
        record,
        fuseMeanings(
          record.sites.flatMap((site) => {
            const page = site.page;
            if (page?.isDisambiguation !== true) return [];
            return (
              disambiguations.get(
                disambiguationKey({
                  pageId: page.pageId,
                  qid: group.qid,
                  revisionId: page.revisionId,
                  wiki: site.wiki,
                }),
              )?.profile.meanings ?? []
            );
          }),
        ),
      );
      for (const index of group.disambiguationIndexes)
        yield { index, resolution };
    }
  }

  async #resolveDisambiguations(
    targets: readonly DisambiguationTarget[],
    stats: MutableCacheStats,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadonlyMap<string, CachedWikimediaDisambiguation>> {
    if (targets.length === 0) return new Map();
    options?.signal?.throwIfAborted();
    const uniqueTargets = [
      ...new Map(
        targets.map((target) => [disambiguationKey(target.key), target]),
      ).values(),
    ];
    const uniqueKeys = uniqueTargets.map(({ key }) => key);
    const pages = new Map(
      uniqueTargets.map(({ key, page }) => [disambiguationKey(key), page]),
    );
    const cached = await this.#cache.getDisambiguations(
      uniqueKeys,
      this.#normalizer.identity,
      options,
    );
    const records = new Map(
      cached.map((record) => [disambiguationKey(record), record]),
    );
    const missing = uniqueKeys.filter(
      (key) => !records.has(disambiguationKey(key)),
    );
    stats.level2Hit += uniqueKeys.length - missing.length;
    stats.level2Miss += missing.length;

    const leaders: Array<{
      deferred: Deferred<CachedWikimediaDisambiguation>;
      key: WikimediaDisambiguationCacheKey;
      flightKey: string;
    }> = [];
    const pending = new Map<string, Promise<CachedWikimediaDisambiguation>>();
    for (const key of missing) {
      const cacheKey = disambiguationKey(key);
      const flightKey = `${cacheKey}\0${this.#normalizer.identity.normalizerVersion}\0${this.#normalizer.identity.modelId}`;
      const active = this.#disambiguationFlights.get(flightKey);
      if (active !== undefined) {
        stats.singleflightWaiter += 1;
        pending.set(cacheKey, active);
        continue;
      }
      const deferred = createDeferred<CachedWikimediaDisambiguation>();
      this.#disambiguationFlights.set(flightKey, deferred.promise);
      pending.set(cacheKey, deferred.promise);
      leaders.push({ deferred, flightKey, key });
      stats.singleflightLeader += 1;
    }

    if (leaders.length > 0) {
      try {
        const generated: CachedWikimediaDisambiguation[] = [];
        for (const leader of leaders) {
          options?.signal?.throwIfAborted();
          const page = pages.get(disambiguationKey(leader.key));
          if (page === undefined) {
            throw new Error(`Missing page metadata for ${leader.key.qid}`);
          }
          const parsedPage = await this.#client.disambiguation(page, options);
          const profile = await this.#normalizer.normalize(
            {
              page: parsedPage,
              sourceQid: leader.key.qid,
              wiki: leader.key.wiki,
            },
            options,
          );
          generated.push({ ...leader.key, parsedPage, profile });
        }
        await this.#cache.putDisambiguations(
          generated,
          this.#normalizer.identity,
          options,
        );
        generated.forEach((record, index) =>
          leaders[index]?.deferred.resolve(record),
        );
      } catch (error) {
        for (const { deferred } of leaders) deferred.reject(error);
      } finally {
        for (const { flightKey } of leaders)
          this.#disambiguationFlights.delete(flightKey);
      }
    }

    for (const [key, promise] of pending) {
      records.set(key, await withSignal(promise, options?.signal));
    }
    return records;
  }

  #isCurrent(record: CachedWikimediaQid): boolean {
    const refreshedAt = Date.parse(record.refreshedAt);
    return (
      Number.isFinite(refreshedAt) &&
      this.#now() - refreshedAt <= this.#ttlMs &&
      WIKIS.every((wiki) => record.sites.some((site) => site.wiki === wiki))
    );
  }

  async #rebuildQids(
    qids: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadonlyMap<string, CachedWikimediaQid>> {
    const entities = await this.#client.entities(qids, options);
    const entitiesByQid = new Map(
      entities.map((entity) => [entity.qid, entity]),
    );
    const pages = await this.#fetchPages(entities, options);
    return new Map(
      qids.map((qid) => [
        qid,
        this.#buildQid(qid, entitiesByQid.get(qid), pages),
      ]),
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

  #buildQid(
    qid: string,
    entity: EntityData | undefined,
    pages: ReadonlyMap<Wiki, ReadonlyMap<string, PageMeta>>,
  ): CachedWikimediaQid {
    const sites: CachedWikimediaSite[] = WIKIS.map((wiki) => {
      const language = wiki === "zhwiki" ? "zh" : "en";
      const sourceTitle = entity?.sitelinks[wiki];
      const page =
        sourceTitle === undefined
          ? undefined
          : pages.get(wiki)?.get(sourceTitle);
      return {
        output: {
          description:
            entity?.descriptions[language] ?? page?.description ?? null,
          label: entity?.labels[language] ?? page?.title ?? null,
          url: page?.url ?? null,
        },
        ...(page === undefined ? {} : { page }),
        ...(sourceTitle === undefined ? {} : { sourceTitle }),
        wiki,
      };
    });
    return { qid, refreshedAt: new Date(this.#now()).toISOString(), sites };
  }
}

function groupInputs(
  input: readonly WikimediaResolveInput[],
): readonly GroupedInput[] {
  const groups = new Map<
    string,
    { disambiguationIndexes: number[]; plainIndexes: number[] }
  >();
  input.forEach((item, index) => {
    const group = groups.get(item.qid) ?? {
      disambiguationIndexes: [],
      plainIndexes: [],
    };
    (item.disambiguation
      ? group.disambiguationIndexes
      : group.plainIndexes
    ).push(index);
    groups.set(item.qid, group);
  });
  return [...groups].map(([qid, indexes]) => ({ qid, ...indexes }));
}

function batches<T>(
  values: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size)
    result.push(values.slice(offset, offset + size));
  return result;
}

function normalizeInput(input: WikimediaResolveInput): WikimediaResolveInput {
  const qid = input.qid.trim().toUpperCase();
  if (!/^Q[1-9][0-9]*$/u.test(qid))
    throw new Error(`Invalid QID: ${input.qid}`);
  return { disambiguation: input.disambiguation, qid };
}

function toResolution(
  record: CachedWikimediaQid,
  disambiguation?: readonly WikimediaDisambiguationItem[],
): WikimediaResolution {
  const sites = new Map(record.sites.map((site) => [site.wiki, site]));
  return {
    ...(disambiguation === undefined ? {} : { disambiguation }),
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

function emptyStats(): MutableCacheStats {
  return {
    level1Expired: 0,
    level1Hit: 0,
    level1Miss: 0,
    level2Hit: 0,
    level2Miss: 0,
    singleflightLeader: 0,
    singleflightWaiter: 0,
  };
}

function requiredRecord(
  records: ReadonlyMap<string, CachedWikimediaQid>,
  qid: string,
): CachedWikimediaQid {
  const record = records.get(qid);
  if (record === undefined)
    throw new Error(`Wikimedia record unavailable for ${qid}`);
  return record;
}

function disambiguationKey(key: WikimediaDisambiguationCacheKey): string {
  return `${key.qid}\0${key.wiki}\0${key.pageId}\0${key.revisionId}`;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

async function withSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return promise;
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Wikimedia resolution aborted"),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

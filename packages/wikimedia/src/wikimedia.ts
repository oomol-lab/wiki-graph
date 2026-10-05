/* eslint-disable */
import type {
  EntityData,
  PageMeta,
  ParsedPage,
  Wiki,
  WikimediaClient,
  WikimediaRequestGate,
  WikimediaRequestOptions,
} from "./types.js";
import {
  createWikimediaRetryBudget,
  DEFAULT_WIKIMEDIA_RETRY_WAIT_BUDGET_MS,
} from "./retry.js";

export type WikimediaUpstreamErrorKind =
  | "api"
  | "forbidden"
  | "maxlag"
  | "network"
  | "rate-limit"
  | "retry-budget"
  | "server";

export class UpstreamError extends Error {
  public constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | undefined,
    message: string,
    public readonly kind: WikimediaUpstreamErrorKind = "api",
    public readonly code: string = `http-${status}`,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface MediaWikiRetryOptions {
  readonly random?: () => number;
  readonly retryWaitBudgetMs?: number;
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const API: Record<Wiki, string> = {
  zhwiki: "https://zh.wikipedia.org/w/api.php",
  enwiki: "https://en.wikipedia.org/w/api.php",
};
const API_BATCH_SIZE = 50;

export class MediaWikiClient implements WikimediaClient {
  readonly #random: () => number;
  readonly #retryWaitBudgetMs: number;
  readonly #wait: (ms: number, signal?: AbortSignal) => Promise<void>;

  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly userAgent = "wg-wikimedia/0.1 (https://github.com/oomol/wiki-graph; contact via repository)",
    private readonly gate: WikimediaRequestGate = {
      use: async <T>(operation: () => Promise<T>) => await operation(),
    },
    retry: MediaWikiRetryOptions = {},
  ) {
    this.#random = retry.random ?? Math.random;
    this.#retryWaitBudgetMs =
      retry.retryWaitBudgetMs ?? DEFAULT_WIKIMEDIA_RETRY_WAIT_BUDGET_MS;
    this.#wait = retry.wait ?? delay;
  }

  async entities(
    qids: readonly string[],
    options?: WikimediaRequestOptions,
  ): Promise<readonly EntityData[]> {
    if (qids.length === 0) return [];
    const requestOptions = withRetryBudget(options, this.#retryWaitBudgetMs);
    const entities: EntityData[] = [];
    for (const batch of batches(qids, API_BATCH_SIZE)) {
      requestOptions.signal?.throwIfAborted();
      entities.push(...(await this.entitiesBatch(batch, requestOptions)));
    }
    return entities;
  }

  private async entitiesBatch(
    qids: readonly string[],
    options: WikimediaRequestOptions,
  ): Promise<readonly EntityData[]> {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", qids.join("|"));
    url.searchParams.set("props", "labels|descriptions|sitelinks");
    url.searchParams.set("languages", "zh|en");
    url.searchParams.set("sitefilter", "zhwiki|enwiki");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    const json = await this.get(url, options);
    const entities = (json.entities ?? {}) as Record<string, any>;

    return qids.map((qid) => {
      const entity = entities[qid] ?? {};
      return {
        qid,
        labels: {
          zh: entity.labels?.zh?.value,
          en: entity.labels?.en?.value,
        },
        descriptions: {
          zh: entity.descriptions?.zh?.value,
          en: entity.descriptions?.en?.value,
        },
        sitelinks: {
          zhwiki: entity.sitelinks?.zhwiki?.title,
          enwiki: entity.sitelinks?.enwiki?.title,
        },
      };
    });
  }

  async pages(
    wiki: Wiki,
    titles: readonly string[],
    options?: WikimediaRequestOptions,
  ): Promise<readonly PageMeta[]> {
    if (titles.length === 0) return [];
    const requestOptions = withRetryBudget(options, this.#retryWaitBudgetMs);
    const pages: PageMeta[] = [];
    for (const batch of batches(titles, API_BATCH_SIZE)) {
      requestOptions.signal?.throwIfAborted();
      pages.push(...(await this.pagesBatch(wiki, batch, requestOptions)));
    }
    return pages;
  }

  private async pagesBatch(
    wiki: Wiki,
    titles: readonly string[],
    options: WikimediaRequestOptions,
  ): Promise<readonly PageMeta[]> {
    const url = new URL(API[wiki]);
    url.searchParams.set("action", "query");
    url.searchParams.set("titles", titles.join("|"));
    url.searchParams.set("prop", "pageprops|info|description|revisions");
    url.searchParams.set("ppprop", "disambiguation|wikibase_item");
    url.searchParams.set("inprop", "url");
    url.searchParams.set("rvprop", "ids");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    const json = await this.get(url, options);
    const redirects = new Map<string, string>(
      ((json.query?.redirects ?? []) as any[]).map((item) => [
        item.from,
        item.to,
      ]),
    );
    const requestedByCanonical = new Map<string, string>();
    for (const requested of titles) {
      requestedByCanonical.set(
        redirects.get(requested) ?? requested,
        requested,
      );
    }

    return ((json.query?.pages ?? []) as any[]).flatMap((page) =>
      page.missing
        ? []
        : [
            {
              wiki,
              title: page.title,
              requestedTitle:
                requestedByCanonical.get(page.title) ?? page.title,
              pageId: page.pageid,
              revisionId: page.revisions?.[0]?.revid ?? 0,
              url: page.canonicalurl ?? page.fullurl,
              description: page.description ?? null,
              isDisambiguation: page.pageprops?.disambiguation !== undefined,
            },
          ],
    );
  }

  async disambiguation(
    page: PageMeta,
    options?: WikimediaRequestOptions,
  ): Promise<ParsedPage> {
    const requestOptions = withRetryBudget(options, this.#retryWaitBudgetMs);
    const parseUrl = new URL(API[page.wiki]);
    parseUrl.searchParams.set("action", "parse");
    parseUrl.searchParams.set("oldid", String(page.revisionId));
    parseUrl.searchParams.set("prop", "text");
    parseUrl.searchParams.set("format", "json");
    parseUrl.searchParams.set("formatversion", "2");

    const [parsed, targetQids] = await Promise.all([
      this.get(parseUrl, requestOptions),
      this.getLinkedTargetQids(page, requestOptions),
    ]);
    const html = String(parsed.parse?.text ?? "");
    const items = parseListItems(html, targetQids);

    return {
      title: page.title,
      pageId: page.pageId,
      revisionId: page.revisionId,
      text: html,
      links: deduplicateLinks(items.flatMap((item) => item.links)),
      items,
    };
  }

  private async getLinkedTargetQids(
    page: PageMeta,
    options: WikimediaRequestOptions,
  ): Promise<ReadonlyMap<string, string>> {
    const qids = new Map<string, string>();
    let continuation: string | undefined;
    do {
      options?.signal?.throwIfAborted();
      const url = new URL(API[page.wiki]);
      url.searchParams.set("action", "query");
      url.searchParams.set("generator", "links");
      url.searchParams.set("pageids", String(page.pageId));
      url.searchParams.set("gplnamespace", "0");
      url.searchParams.set("gpllimit", "max");
      url.searchParams.set("prop", "pageprops");
      url.searchParams.set("ppprop", "wikibase_item");
      url.searchParams.set("redirects", "1");
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      if (continuation !== undefined)
        url.searchParams.set("gplcontinue", continuation);
      const json = await this.get(url, options);
      const redirects = new Map<string, string>(
        ((json.query?.redirects ?? []) as any[]).map((item) => [
          item.from,
          item.to,
        ]),
      );
      for (const target of (json.query?.pages ?? []) as any[]) {
        const qid = target.pageprops?.wikibase_item;
        if (typeof qid !== "string") continue;
        qids.set(target.title, qid);
        for (const [source, destination] of redirects) {
          if (destination === target.title) qids.set(source, qid);
        }
      }
      continuation = json.continue?.gplcontinue;
    } while (continuation !== undefined);
    return qids;
  }

  private async get(url: URL, options: WikimediaRequestOptions): Promise<any> {
    url.searchParams.set("maxlag", "5");
    for (let attempt = 0; ; attempt += 1) {
      options?.signal?.throwIfAborted();
      try {
        return await this.gate.use(async () => {
          let response: Response;
          try {
            response = await this.fetcher(url, {
              headers: {
                "Accept-Encoding": "gzip",
                "User-Agent": this.userAgent,
              },
              ...(options.signal === undefined
                ? {}
                : { signal: options.signal }),
            });
          } catch (error) {
            if (options.signal?.aborted === true) {
              throw options.signal.reason ?? error;
            }
            throw new UpstreamError(
              503,
              undefined,
              `Wikimedia network error: ${error instanceof Error ? error.message : String(error)}`,
              "network",
              "network",
              true,
              { cause: error },
            );
          }
          const retryAfterMs = parseRetryAfter(
            response.headers.get("retry-after"),
          );
          if (!response.ok) {
            const classification = classifyHttpStatus(response.status);
            throw new UpstreamError(
              response.status,
              retryAfterMs,
              `Wikimedia ${response.status}`,
              classification.kind,
              `http-${response.status}`,
              classification.retryable,
            );
          }
          const json = await response.json();
          if (json.error !== undefined) {
            const code = readErrorText(json.error.code) ?? "unknown";
            const detail = readErrorText(json.error.info);
            const isMaxlag = code === "maxlag";
            const isRateLimited = code === "ratelimited";
            throw new UpstreamError(
              isMaxlag ? 503 : isRateLimited ? 429 : 502,
              isMaxlag ? (retryAfterMs ?? 5000) : retryAfterMs,
              `Wikimedia ${code}${detail === undefined ? "" : `: ${detail}`}`,
              isMaxlag ? "maxlag" : isRateLimited ? "rate-limit" : "api",
              code,
              isMaxlag || isRateLimited,
            );
          }
          return json;
        }, options);
      } catch (error) {
        if (!isRetryable(error)) throw error;
        const waitMs = retryDelay(error, attempt, this.#random);
        const budget = options.retryBudget;
        if (budget === undefined) throw error;
        if (waitMs > budget.remainingMs) {
          if (budget.remainingMs > 0) {
            const remainingMs = budget.remainingMs;
            budget.consume(remainingMs);
            await this.#wait(remainingMs, options.signal);
          }
          throw retryBudgetError(error);
        }
        budget.consume(waitMs);
        await this.#wait(waitMs, options.signal);
      }
    }
  }
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

function readErrorText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function isRetryable(error: unknown): error is UpstreamError {
  return error instanceof UpstreamError && error.retryable;
}

function retryDelay(
  error: UpstreamError,
  attempt: number,
  random: () => number,
): number {
  const maximumBackoffMs = 5 * 60 * 1_000;
  const backoff = Math.min(maximumBackoffMs, 5_000 * 2 ** Math.min(attempt, 6));
  const jitteredBackoff = Math.min(
    maximumBackoffMs,
    backoff + Math.floor(backoff * 0.2 * random()),
  );
  return Math.max(jitteredBackoff, error.retryAfterMs ?? 0);
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, ms);
    const abort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("Wikimedia request aborted"));
    };
    function done(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function withRetryBudget(
  options: WikimediaRequestOptions | undefined,
  waitBudgetMs: number,
): WikimediaRequestOptions {
  return options?.retryBudget === undefined
    ? { ...options, retryBudget: createWikimediaRetryBudget(waitBudgetMs) }
    : options;
}

function classifyHttpStatus(status: number): {
  readonly kind: WikimediaUpstreamErrorKind;
  readonly retryable: boolean;
} {
  if (status === 403) return { kind: "forbidden", retryable: true };
  if (status === 408 || status === 425)
    return { kind: "rate-limit", retryable: true };
  if (status === 429) return { kind: "rate-limit", retryable: true };
  if (status >= 500) return { kind: "server", retryable: true };
  return { kind: "api", retryable: false };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

function retryBudgetError(cause: UpstreamError): UpstreamError {
  return new UpstreamError(
    503,
    undefined,
    "Wikimedia retry wait budget is exhausted.",
    "retry-budget",
    "retry-budget-exhausted",
    true,
    { cause },
  );
}

function parseListItems(
  html: string,
  qids: ReadonlyMap<string, string>,
): ParsedPage["items"] {
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)].flatMap(
    (match) => {
      const body = match[1] ?? "";
      const links = [...body.matchAll(/<a\b[^>]*\btitle="([^"]+)"[^>]*>/giu)]
        .map((link) => {
          const title = decodeHtml(link[1]!);
          return { title, qid: qids.get(title) };
        })
        .filter(
          (link): link is { title: string; qid: string } =>
            link.qid !== undefined,
        );
      const text = decodeHtml(body.replace(/<[^>]+>/gu, " "))
        .replace(/\s+/gu, " ")
        .trim();
      return text === "" || links.length === 0 ? [] : [{ text, links }];
    },
  );
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function deduplicateLinks(
  links: readonly { title: string; qid: string }[],
): readonly { title: string; qid: string }[] {
  return [
    ...new Map(
      links.map((link) => [`${link.title}\0${link.qid}`, link]),
    ).values(),
  ];
}

import { getLogger } from "../../../runtime/common/logging.js";
import { formatError } from "../../../utils/node-error.js";
import type { WikipageFetchLog } from "../fetch-log.js";
import type { WikiClient } from "../types.js";
import { RateLimiter, parseRetryAfterMs } from "../rate-limiter.js";
import { renderDisambiguationHtml } from "./html.js";
import {
  asArray,
  asRecord,
  getNestedString,
  getNumber,
  getString,
} from "./json.js";
import {
  delay,
  getRetryDelayMs,
  isRetryableError,
  isTextResponse,
  WikimediaRequestError,
} from "./request.js";
import {
  listWikidataLanguages,
  type MediaWikiPage,
  normalizeWiki,
  pickLocalizedValue,
  SUPPORTED_WIKIS,
  type ParsedDisambiguationPage,
  type SupportedWiki,
  type WikidataEntityInfo,
  type WikimediaClientOptions,
  type WikiPageInfo,
  wikiApiBaseURL,
} from "./wiki.js";

export class WikimediaClient implements WikiClient {
  readonly #fetch: typeof fetch;
  readonly #language: string;
  readonly #limiter: RateLimiter;
  readonly #requestLog: WikipageFetchLog;
  readonly #retryBaseDelayMs: number;
  readonly #retryTimes: number;
  readonly #userAgent: string | undefined;
  readonly #wiki: string;

  public constructor(options: WikimediaClientOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#language = options.language;
    this.#requestLog = options.requestLog;
    this.#wiki = options.wiki;
    this.#userAgent = options.userAgent;
    this.#retryBaseDelayMs = Math.max(0, Math.floor(options.retryBaseDelayMs));
    this.#retryTimes = Math.max(0, Math.floor(options.retryTimes));
    this.#limiter = new RateLimiter({
      concurrency: options.concurrency,
      minRequestIntervalMs: options.minRequestIntervalMs,
    });
  }

  public async getEntities(
    qids: readonly string[],
  ): Promise<ReadonlyMap<string, WikidataEntityInfo>> {
    if (qids.length === 0) {
      return new Map();
    }

    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", qids.join("|"));
    url.searchParams.set("props", "labels|descriptions|sitelinks");
    url.searchParams.set("languages", listWikidataLanguages(this.#language));
    url.searchParams.set("sitefilter", SUPPORTED_WIKIS.join("|"));
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");

    const json = await this.#fetchJson(url);
    const entities = asRecord(json.entities);
    const results = new Map<string, WikidataEntityInfo>();

    for (const qid of qids) {
      const entity = asRecord(entities[qid]);
      const labels = asRecord(entity.labels);
      const descriptions = asRecord(entity.descriptions);

      results.set(qid, {
        ...(pickLocalizedValue(labels, this.#language) === undefined
          ? {}
          : { label: pickLocalizedValue(labels, this.#language)! }),
        ...(pickLocalizedValue(descriptions, this.#language) === undefined
          ? {}
          : { description: pickLocalizedValue(descriptions, this.#language)! }),
        qid,
        sitelinks: SUPPORTED_WIKIS.flatMap((wiki) => {
          const title = getNestedString(entity, ["sitelinks", wiki, "title"]);

          return title === undefined ? [] : [{ title, wiki }];
        }),
      });
    }

    return results;
  }

  public async getPagesByTitles(
    titles: readonly string[],
    wiki: SupportedWiki = normalizeWiki(this.#wiki) ?? "enwiki",
  ): Promise<ReadonlyMap<string, WikiPageInfo>> {
    if (titles.length === 0) {
      return new Map();
    }

    const url = new URL(`${wikiApiBaseURL(wiki)}w/api.php`);
    url.searchParams.set("action", "query");
    url.searchParams.set("titles", titles.join("|"));
    url.searchParams.set("prop", "pageprops");
    url.searchParams.set("ppprop", "disambiguation|wikibase_item");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");

    const json = await this.#fetchJson(url);
    const pages = asArray(asRecord(asRecord(json.query).pages));
    const results = new Map<string, WikiPageInfo>();

    for (const pageValue of pages) {
      const page = asRecord(pageValue) as MediaWikiPage;
      const title = getString(page.title);

      if (title === undefined) {
        continue;
      }

      results.set(title, {
        isDisambiguation: asRecord(page.pageprops).disambiguation !== undefined,
        ...(getNumber(page.pageid) === undefined
          ? {}
          : { pageId: getNumber(page.pageid)! }),
        title,
        wiki,
        ...(getString(asRecord(page.pageprops).wikibase_item) === undefined
          ? {}
          : {
              wikibaseItem: getString(asRecord(page.pageprops).wikibase_item)!,
            }),
      });
    }

    return results;
  }

  public async parseDisambiguationPage(
    title: string,
    wiki: SupportedWiki,
  ): Promise<ParsedDisambiguationPage> {
    const url = new URL(`${wikiApiBaseURL(wiki)}w/api.php`);
    url.searchParams.set("action", "parse");
    url.searchParams.set("page", title);
    url.searchParams.set("prop", "text|properties");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");

    const json = await this.#fetchJson(url);
    const parse = asRecord(json.parse);
    const rendered = renderDisambiguationHtml(getNestedString(parse, ["text"]));

    return {
      linkedTitles: rendered.linkedTitles,
      ...(getNumber(parse.pageid) === undefined
        ? {}
        : { pageId: getNumber(parse.pageid)! }),
      text: rendered.text,
      title: getString(parse.title) ?? title,
      wiki,
    };
  }

  async #fetchJson(url: URL): Promise<Record<string, unknown>> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#retryTimes; attempt += 1) {
      try {
        return await this.#limiter.use(
          async () => await this.#fetchJsonOnce(url, attempt + 1),
        );
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error) || attempt >= this.#retryTimes) {
          this.#requestLog.warnFailed();
          throw error;
        }

        await delay(getRetryDelayMs(error, attempt, this.#retryBaseDelayMs));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async #fetchJsonOnce(
    url: URL,
    attempt: number,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await this.#fetch(
        url,
        this.#userAgent === undefined
          ? undefined
          : {
              headers: {
                "User-Agent": this.#userAgent,
              },
            },
      );
    } catch (error) {
      await this.#appendFetchLog({
        attempt,
        durationMs: Date.now() - startedAt,
        error,
        startedAt,
        url,
      });
      throw error;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));

    if (retryAfterMs !== undefined) {
      this.#limiter.blockFor(retryAfterMs);
    }
    if (!response.ok) {
      const responseText = isTextResponse(response)
        ? await response.text()
        : undefined;

      await this.#appendFetchLog({
        attempt,
        durationMs: Date.now() - startedAt,
        response,
        ...(responseText === undefined ? {} : { responseText }),
        startedAt,
        url,
      });
      throw new WikimediaRequestError(url, response.status, retryAfterMs);
    }

    await this.#appendFetchLog({
      attempt,
      durationMs: Date.now() - startedAt,
      response,
      startedAt,
      url,
    });

    return asRecord(await response.json());
  }

  async #appendFetchLog(
    entry: Parameters<WikipageFetchLog["append"]>[0],
  ): Promise<void> {
    try {
      await this.#requestLog.append(entry);
    } catch (error) {
      getLogger({ component: "wikipage" }).warn(
        `Failed to write wikipage fetch log entry: ${formatError(error)}`,
      );
    }
  }
}

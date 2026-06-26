import { RateLimiter, parseRetryAfterMs } from "./rate-limiter.js";

export interface WikimediaClientOptions {
  readonly concurrency: number;
  readonly fetch?: typeof fetch;
  readonly language: string;
  readonly minRequestIntervalMs: number;
  readonly userAgent?: string;
  readonly wiki: string;
}

export interface WikidataEntityInfo {
  readonly description?: string;
  readonly label?: string;
  readonly qid: string;
  readonly sitelinkTitle?: string;
  readonly sitelinkWiki?: string;
}

export interface WikiPageInfo {
  readonly isDisambiguation: boolean;
  readonly pageId?: number;
  readonly title: string;
  readonly wikibaseItem?: string;
}

export interface ParsedDisambiguationPage {
  readonly links: readonly ParsedPageLink[];
  readonly pageId?: number;
  readonly title: string;
}

export interface ParsedPageLink {
  readonly hint?: string;
  readonly title: string;
}

interface MediaWikiPage {
  readonly links?: ReadonlyArray<{ readonly title?: unknown }>;
  readonly ns?: unknown;
  readonly pageid?: unknown;
  readonly pageprops?: {
    readonly disambiguation?: unknown;
    readonly wikibase_item?: unknown;
  };
  readonly title?: unknown;
}

interface ParseLink {
  readonly ns?: unknown;
  readonly title?: unknown;
}

export class WikimediaClient {
  readonly #fetch: typeof fetch;
  readonly #language: string;
  readonly #limiter: RateLimiter;
  readonly #userAgent: string | undefined;
  readonly #wiki: string;

  public constructor(options: WikimediaClientOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#language = options.language;
    this.#wiki = options.wiki;
    this.#userAgent = options.userAgent;
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
    url.searchParams.set("languages", this.#language);
    url.searchParams.set("sitefilter", this.#wiki);
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");

    const json = await this.#fetchJson(url);
    const entities = asRecord(json.entities);
    const results = new Map<string, WikidataEntityInfo>();

    for (const qid of qids) {
      const entity = asRecord(entities[qid]);
      const label = getNestedString(entity, [
        "labels",
        this.#language,
        "value",
      ]);
      const description = getNestedString(entity, [
        "descriptions",
        this.#language,
        "value",
      ]);
      const sitelinkTitle = getNestedString(entity, [
        "sitelinks",
        this.#wiki,
        "title",
      ]);

      results.set(qid, {
        ...(description === undefined ? {} : { description }),
        ...(label === undefined ? {} : { label }),
        qid,
        ...(sitelinkTitle === undefined
          ? {}
          : { sitelinkTitle, sitelinkWiki: this.#wiki }),
      });
    }

    return results;
  }

  public async getPagesByTitles(
    titles: readonly string[],
  ): Promise<ReadonlyMap<string, WikiPageInfo>> {
    if (titles.length === 0) {
      return new Map();
    }

    const url = new URL(`${this.#wikiApiBaseURL()}w/api.php`);
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
  ): Promise<ParsedDisambiguationPage> {
    const url = new URL(`${this.#wikiApiBaseURL()}w/api.php`);
    url.searchParams.set("action", "parse");
    url.searchParams.set("page", title);
    url.searchParams.set("prop", "links|text");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");

    const json = await this.#fetchJson(url);
    const parse = asRecord(json.parse);
    const links = asArray(parse.links)
      .map((value) => asRecord(value) as ParseLink)
      .filter((link) => getNumber(link.ns) === 0)
      .map((link) => getString(link.title))
      .filter((linkTitle): linkTitle is string => linkTitle !== undefined);
    const hints = extractLinkHints(getNestedString(parse, ["text"]) ?? "");
    const uniqueLinks = [...new Set(links)];

    return {
      links: uniqueLinks.map((linkTitle) => ({
        ...(hints.get(linkTitle) === undefined
          ? {}
          : {
              hint: hints.get(linkTitle)!,
            }),
        title: linkTitle,
      })),
      ...(getNumber(parse.pageid) === undefined
        ? {}
        : { pageId: getNumber(parse.pageid)! }),
      title: getString(parse.title) ?? title,
    };
  }

  async #fetchJson(url: URL): Promise<Record<string, unknown>> {
    return await this.#limiter.use(async () => {
      const response = await this.#fetch(
        url,
        this.#userAgent === undefined
          ? undefined
          : {
              headers: {
                "User-Agent": this.#userAgent,
              },
            },
      );

      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("retry-after"),
      );

      if (retryAfterMs !== undefined) {
        this.#limiter.blockFor(retryAfterMs);
      }
      if (!response.ok) {
        throw new Error(
          `Wikimedia request failed with ${response.status}: ${url.toString()}`,
        );
      }

      return asRecord(await response.json());
    });
  }

  #wikiApiBaseURL(): string {
    return `https://${this.#language}.wikipedia.org/`;
  }
}

function extractLinkHints(html: string): ReadonlyMap<string, string> {
  const hints = new Map<string, string>();
  const itemPattern = /<li\b[^>]*>(.*?)<\/li>/gis;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemPattern.exec(html)) !== null) {
    const itemHtml = itemMatch[1] ?? "";
    const title = extractFirstTitle(itemHtml);

    if (title === undefined || hints.has(title)) {
      continue;
    }

    const hint = stripHtml(itemHtml)
      .replace(/\s+/gu, " ")
      .replace(/\s+([,.;:!?])/gu, "$1")
      .trim();

    if (hint !== "") {
      hints.set(title, hint);
    }
  }

  return hints;
}

function extractFirstTitle(html: string): string | undefined {
  const match = /<a\b[^>]*\btitle="([^"]+)"/iu.exec(html);

  return match === null ? undefined : decodeHtml(match[1] ?? "");
}

function stripHtml(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/gu, " "));
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getNestedString(
  value: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  let current: unknown = value;

  for (const part of path) {
    current = asRecord(current)[part];
  }

  return getString(current);
}

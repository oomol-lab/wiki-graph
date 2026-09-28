import type {
  EntityData,
  PageMeta,
  ParsedPage,
  Wiki,
  WikimediaClient,
} from "./types.js";

export class UpstreamError extends Error {
  public constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | undefined,
    message: string,
    public readonly kind: "http" | "maxlag" = "http",
  ) {
    super(message);
  }
}

const API: Record<Wiki, string> = {
  zhwiki: "https://zh.wikipedia.org/w/api.php",
  enwiki: "https://en.wikipedia.org/w/api.php",
};

export class MediaWikiClient implements WikimediaClient {
  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly userAgent =
      "wg-wikimedia/0.1 (https://github.com/oomol/wiki-graph; contact via repository)",
  ) {}

  async entities(qids: readonly string[]): Promise<readonly EntityData[]> {
    if (qids.length === 0) return [];
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", qids.join("|"));
    url.searchParams.set("props", "labels|descriptions|sitelinks");
    url.searchParams.set("languages", "zh|en");
    url.searchParams.set("sitefilter", "zhwiki|enwiki");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    const json = await this.get(url);
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
        // Kept for adapter compatibility. Resolve uses the WikiSpine flag
        // supplied by the caller rather than re-deriving it from live data.
        wikispineDisambiguation: false,
      };
    });
  }

  async pages(
    wiki: Wiki,
    titles: readonly string[],
  ): Promise<readonly PageMeta[]> {
    if (titles.length === 0) return [];
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
    const json = await this.get(url);
    const redirects = new Map<string, string>(
      ((json.query?.redirects ?? []) as any[]).map((item) => [item.from, item.to]),
    );
    const requestedByCanonical = new Map<string, string>();
    for (const requested of titles) {
      requestedByCanonical.set(redirects.get(requested) ?? requested, requested);
    }

    return ((json.query?.pages ?? []) as any[]).flatMap((page) =>
      page.missing
        ? []
        : [{
            wiki,
            title: page.title,
            requestedTitle: requestedByCanonical.get(page.title) ?? page.title,
            pageId: page.pageid,
            revisionId: page.revisions?.[0]?.revid ?? 0,
            url: page.canonicalurl ?? page.fullurl,
            description: page.description ?? null,
            isDisambiguation: page.pageprops?.disambiguation !== undefined,
          }],
    );
  }

  async disambiguation(page: PageMeta): Promise<ParsedPage> {
    const parseUrl = new URL(API[page.wiki]);
    parseUrl.searchParams.set("action", "parse");
    parseUrl.searchParams.set("oldid", String(page.revisionId));
    parseUrl.searchParams.set("prop", "text");
    parseUrl.searchParams.set("format", "json");
    parseUrl.searchParams.set("formatversion", "2");

    const [parsed, targetQids] = await Promise.all([
      this.get(parseUrl),
      this.getLinkedTargetQids(page),
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
  ): Promise<ReadonlyMap<string, string>> {
    const qids = new Map<string, string>();
    let continuation: string | undefined;
    do {
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
      if (continuation !== undefined) url.searchParams.set("gplcontinue", continuation);
      const json = await this.get(url);
      const redirects = new Map<string, string>(
        ((json.query?.redirects ?? []) as any[]).map((item) => [item.from, item.to]),
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

  private async get(url: URL): Promise<any> {
    url.searchParams.set("maxlag", "1");
    const response = await this.fetcher(url, {
      headers: { "User-Agent": this.userAgent, "Accept-Encoding": "gzip" },
    });
    const retry = Number(response.headers.get("retry-after") ?? 0);
    const retryAfterMs = retry > 0 ? retry * 1000 : undefined;
    if (!response.ok) {
      throw new UpstreamError(
        response.status === 429 || response.status === 503 ? response.status : 502,
        retryAfterMs,
        `Wikimedia ${response.status}`,
      );
    }
    const json = await response.json();
    if (json.error?.code === "maxlag") {
      throw new UpstreamError(503, retryAfterMs ?? 5000, "Wikimedia maxlag", "maxlag");
    }
    return json;
  }
}

function parseListItems(
  html: string,
  qids: ReadonlyMap<string, string>,
): ParsedPage["items"] {
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)].flatMap((match) => {
    const body = match[1] ?? "";
    const links = [...body.matchAll(/<a\b[^>]*\btitle="([^"]+)"[^>]*>/giu)]
      .map((link) => {
        const title = decodeHtml(link[1]!);
        return { title, qid: qids.get(title) };
      })
      .filter((link): link is { title: string; qid: string } => link.qid !== undefined);
    const text = decodeHtml(body.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
    return text === "" || links.length === 0 ? [] : [{ text, links }];
  });
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
  return [...new Map(links.map((link) => [`${link.title}\0${link.qid}`, link])).values()];
}


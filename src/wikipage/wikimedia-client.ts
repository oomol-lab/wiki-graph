import { DomUtils, parseDocument } from "htmlparser2";

import { RateLimiter, parseRetryAfterMs } from "./rate-limiter.js";

export type SupportedWiki = "enwiki" | "zhwiki";

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
  readonly sitelinks: readonly WikidataSitelinkInfo[];
}

export interface WikidataSitelinkInfo {
  readonly title: string;
  readonly wiki: SupportedWiki;
}

export interface WikiPageInfo {
  readonly isDisambiguation: boolean;
  readonly pageId?: number;
  readonly title: string;
  readonly wiki: SupportedWiki;
  readonly wikibaseItem?: string;
}

export interface ParsedDisambiguationPage {
  readonly linkedTitles: readonly string[];
  readonly pageId?: number;
  readonly text: string;
  readonly title: string;
  readonly wiki: SupportedWiki;
}

interface MediaWikiPage {
  readonly ns?: unknown;
  readonly pageid?: unknown;
  readonly pageprops?: {
    readonly disambiguation?: unknown;
    readonly wikibase_item?: unknown;
  };
  readonly title?: unknown;
}

const SUPPORTED_WIKIS: readonly SupportedWiki[] = ["zhwiki", "enwiki"];
const TITLE_URI_PREFIX = "wikigraph-title://";

interface HtmlElement {
  readonly attribs: Record<string, string | undefined>;
  readonly children?: readonly unknown[];
  readonly name: string;
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
}

export function replaceTitleUriWithQidUri(
  text: string,
  titleToQid: ReadonlyMap<string, string>,
): string {
  return text.replace(
    /\[\[([^\]|]+)\|wikigraph-title:\/\/([^\]\s]+)\]\]/gu,
    (_match: string, label: string, encodedTitle: string) => {
      const title = decodeURIComponent(encodedTitle);
      const qid = titleToQid.get(title);

      return qid === undefined
        ? label
        : `[[${label}|wikigraph://qid=${qid}]]`;
    },
  );
}

function renderDisambiguationHtml(html: string | undefined): {
  readonly linkedTitles: readonly string[];
  readonly text: string;
} {
  if (html === undefined || html.trim() === "") {
    return {
      linkedTitles: [],
      text: "",
    };
  }

  const linkedTitles = new Set<string>();
  const document = parseDocument(html);
  const text = renderNodes(DomUtils.getChildren(document), {
    linkedTitles,
    listDepth: 0,
  })
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return {
    linkedTitles: [...linkedTitles],
    text,
  };
}

function renderNodes(
  nodes: readonly unknown[],
  context: {
    readonly linkedTitles: Set<string>;
    readonly listDepth: number;
  },
): string {
  return nodes.map((node) => renderNode(node, context)).join("");
}

function renderNode(
  node: unknown,
  context: {
    readonly linkedTitles: Set<string>;
    readonly listDepth: number;
  },
): string {
  const record = asRecord(node);
  const nodeType = getString(record.type);

  if (nodeType === "text") {
    return normalizeInlineText(getString(record.data) ?? "");
  }
  if (nodeType !== "tag" && nodeType !== "script" && nodeType !== "style") {
    return "";
  }

  const element = node as HtmlElement;
  if (shouldSkipElement(element)) {
    return "";
  }

  const name = element.name.toLowerCase();

  if (name === "a") {
    return renderLink(element, context);
  }
  if (/^h[1-6]$/u.test(name)) {
    const level = Math.min(6, Math.max(1, Number(name.slice(1))));
    const marker = "=".repeat(level);
    const heading = renderNodes(element.children ?? [], context).trim();

    return heading === "" ? "" : `\n${marker} ${heading} ${marker}\n`;
  }
  if (name === "li") {
    const indent = "  ".repeat(Math.max(0, context.listDepth - 1));
    const content = renderNodes(element.children ?? [], {
      ...context,
      listDepth: context.listDepth + 1,
    }).trim();

    return content === "" ? "" : `\n${indent}* ${content}`;
  }
  if (name === "ul" || name === "ol") {
    return `${renderNodes(element.children ?? [], context)}\n`;
  }
  if (isBlockElement(name)) {
    const content = renderNodes(element.children ?? [], context).trim();

    return content === "" ? "" : `\n${content}\n`;
  }

  return renderNodes(element.children ?? [], context);
}

function renderLink(
  node: HtmlElement,
  context: {
    readonly linkedTitles: Set<string>;
    readonly listDepth: number;
  },
): string {
  const content = renderNodes(node.children ?? [], context).trim();
  const title = extractWikiLinkTitle(node);

  if (title === undefined) {
    return content;
  }

  context.linkedTitles.add(title);

  return `[[${content === "" ? title : content}|${TITLE_URI_PREFIX}${encodeURIComponent(title)}]]`;
}

function extractWikiLinkTitle(node: HtmlElement): string | undefined {
  const title = node.attribs.title;
  const href = node.attribs.href;

  if (title !== undefined && title !== "" && !title.includes(":")) {
    return title;
  }
  if (href === undefined || !href.startsWith("/wiki/")) {
    return undefined;
  }

  const decoded = decodeURIComponent(href.slice("/wiki/".length)).replaceAll(
    "_",
    " ",
  );

  return decoded === "" || decoded.includes(":") ? undefined : decoded;
}

function shouldSkipElement(node: HtmlElement): boolean {
  const name = node.name.toLowerCase();

  if (["script", "style", "table", "sup"].includes(name)) {
    return true;
  }

  const className = node.attribs.class ?? "";

  return [
    "catlinks",
    "metadata",
    "mw-editsection",
    "mw-empty-elt",
    "navbox",
    "noprint",
    "reference",
    "reflist",
    "shortdescription",
    "toc",
  ].some((item) => className.split(/\s+/u).includes(item));
}

function isBlockElement(name: string): boolean {
  return [
    "blockquote",
    "br",
    "dd",
    "div",
    "dl",
    "dt",
    "p",
    "section",
  ].includes(name);
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/gu, " ");
}

function listWikidataLanguages(language: string): string {
  return [...new Set([language, "zh", "en"])].join("|");
}

function pickLocalizedValue(
  values: Record<string, unknown>,
  language: string,
): string | undefined {
  for (const candidate of [language, "zh", "en"]) {
    const value = getNestedString(values, [candidate, "value"]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function wikiApiBaseURL(wiki: SupportedWiki): string {
  return wiki === "zhwiki"
    ? "https://zh.wikipedia.org/"
    : "https://en.wikipedia.org/";
}

function normalizeWiki(value: string): SupportedWiki | undefined {
  return value === "zhwiki" || value === "enwiki" ? value : undefined;
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

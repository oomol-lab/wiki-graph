import type { WikipageFetchLog } from "../fetch-log.js";
import { getNestedString } from "./json.js";

export type SupportedWiki = "enwiki" | "zhwiki";

export interface WikimediaClientOptions {
  readonly concurrency: number;
  readonly fetch?: typeof fetch;
  readonly language: string;
  readonly minRequestIntervalMs: number;
  readonly requestLog: WikipageFetchLog;
  readonly retryBaseDelayMs: number;
  readonly retryTimes: number;
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

export interface MediaWikiPage {
  readonly ns?: unknown;
  readonly pageid?: unknown;
  readonly pageprops?: {
    readonly disambiguation?: unknown;
    readonly wikibase_item?: unknown;
  };
  readonly title?: unknown;
}
export const SUPPORTED_WIKIS: readonly SupportedWiki[] = ["zhwiki", "enwiki"];
export function listWikidataLanguages(language: string): string {
  return [...new Set([language, "zh", "en"])].join("|");
}

export function pickLocalizedValue(
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

export function wikiApiBaseURL(wiki: SupportedWiki): string {
  return wiki === "zhwiki"
    ? "https://zh.wikipedia.org/"
    : "https://en.wikipedia.org/";
}

export function normalizeWiki(value: string): SupportedWiki | undefined {
  return value === "zhwiki" || value === "enwiki" ? value : undefined;
}

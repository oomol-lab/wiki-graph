export type Wiki = "zhwiki" | "enwiki";

export interface WikimediaResolveInput {
  readonly disambiguation: boolean;
  readonly qid: string;
}

export interface WikimediaLanguageProfile {
  readonly description: string | null;
  readonly label: string | null;
  readonly url: string | null;
}

export interface WikimediaDisambiguationItem {
  readonly information: string;
  readonly qid: string;
}

export interface WikimediaResolution {
  readonly disambiguation?: readonly WikimediaDisambiguationItem[];
  readonly en: WikimediaLanguageProfile;
  readonly qid: string;
  readonly zh: WikimediaLanguageProfile;
}

export interface WikimediaResolver {
  readonly resolve: (
    input: readonly WikimediaResolveInput[],
  ) => Promise<readonly WikimediaResolution[]>;
}

export interface PageMeta {
  readonly wiki: Wiki;
  readonly title: string;
  readonly requestedTitle?: string;
  readonly pageId: number;
  readonly revisionId: number;
  readonly url: string;
  readonly description: string | null;
  readonly isDisambiguation: boolean;
}

export interface EntityData {
  readonly qid: string;
  readonly labels: Partial<Record<"zh" | "en", string>>;
  readonly descriptions: Partial<Record<"zh" | "en", string>>;
  readonly sitelinks: Partial<Record<Wiki, string>>;
}

export interface ParsedPage {
  readonly title: string;
  readonly pageId: number;
  readonly revisionId: number;
  readonly text: string;
  readonly links: readonly { readonly title: string; readonly qid: string }[];
  readonly items: readonly {
    readonly text: string;
    readonly links: readonly { readonly title: string; readonly qid: string }[];
  }[];
}

export interface DisambiguationProfile {
  readonly meanings: readonly WikimediaDisambiguationItem[];
}

export interface CachedWikimediaSite {
  readonly output: WikimediaLanguageProfile;
  readonly page?: PageMeta;
  readonly parsedPage?: ParsedPage;
  readonly profile?: DisambiguationProfile;
  readonly sourceTitle?: string;
  readonly wiki: Wiki;
}

export interface CachedWikimediaQid {
  readonly disambiguation: boolean;
  readonly qid: string;
  readonly refreshedAt: string;
  readonly sites: readonly CachedWikimediaSite[];
}

export interface WikimediaCache {
  readonly get: (
    qids: readonly string[],
  ) => Promise<ReadonlyMap<string, CachedWikimediaQid>>;
  readonly put: (records: readonly CachedWikimediaQid[]) => Promise<void>;
}

export interface WikimediaRequestGate {
  readonly use: <T>(operation: () => Promise<T>) => Promise<T>;
}

export interface WikimediaClient {
  entities(qids: readonly string[]): Promise<readonly EntityData[]>;
  pages(wiki: Wiki, titles: readonly string[]): Promise<readonly PageMeta[]>;
  disambiguation(page: PageMeta): Promise<ParsedPage>;
}

export interface WikimediaLlmMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export type WikimediaLlmRequest = (
  messages: readonly WikimediaLlmMessage[],
  retryIndex: number,
  retryMax: number,
) => Promise<string | undefined>;

export interface DisambiguationNormalizer {
  readonly normalize: (input: {
    readonly page: ParsedPage;
    readonly sourceQid: string;
    readonly wiki: Wiki;
  }) => Promise<DisambiguationProfile>;
}

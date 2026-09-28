import type {
  WikimediaDisambiguationItem,
  WikimediaLanguageProfile,
  WikimediaResolution,
  WikimediaResolveInput,
} from "wiki-graph-core";

export type Wiki = "zhwiki" | "enwiki";
export type ResolveInput = WikimediaResolveInput;
export type SiteOutput = WikimediaLanguageProfile;
export type DisambiguationItem = WikimediaDisambiguationItem;
export type EntityOutput = WikimediaResolution;
export interface PageMeta { readonly wiki: Wiki; readonly title: string; readonly requestedTitle?: string; readonly pageId: number; readonly revisionId: number; readonly url: string; readonly description: string | null; readonly isDisambiguation: boolean; }
export interface EntityData { readonly qid: string; readonly labels: Partial<Record<"zh" | "en", string>>; readonly descriptions: Partial<Record<"zh" | "en", string>>; readonly sitelinks: Partial<Record<Wiki, string>>; readonly wikispineDisambiguation: boolean; }
export interface ParsedPage { readonly title: string; readonly pageId: number; readonly revisionId: number; readonly text: string; readonly links: readonly { title: string; qid: string }[]; readonly items: readonly { text: string; links: readonly { title: string; qid: string }[] }[]; }
export interface Profile { readonly meanings: readonly DisambiguationItem[]; }
export interface WikimediaClient { entities(qids: readonly string[]): Promise<readonly EntityData[]>; pages(wiki: Wiki, titles: readonly string[]): Promise<readonly PageMeta[]>; disambiguation(page: PageMeta): Promise<ParsedPage>; }
export interface ProfileNormalizer { normalize(input: { sourceQid: string; wiki: Wiki; page: ParsedPage }): Promise<Profile>; }

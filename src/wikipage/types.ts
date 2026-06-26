export interface WikipageResolverOptions {
  readonly cacheDatabasePath?: string;
  readonly concurrency?: number;
  readonly fetch?: typeof fetch;
  readonly language?: string;
  readonly maxBatchSize?: number;
  readonly minRequestIntervalMs?: number;
  readonly userAgent?: string;
  readonly wiki?: string;
}

export interface QidResolution {
  readonly description?: string;
  readonly disambiguation?: DisambiguationExpansion;
  readonly isDisambiguation: boolean;
  readonly label?: string;
  readonly qid: string;
  readonly sitelink?: WikipageSitelink;
}

export interface WikipageSitelink {
  readonly title: string;
  readonly wiki: string;
}

export interface DisambiguationExpansion {
  readonly checkedAt: string;
  readonly disambiguationQid: string;
  readonly language: string;
  readonly options: readonly DisambiguationOption[];
  readonly pageId?: number;
  readonly pageTitle: string;
  readonly wiki: string;
}

export interface DisambiguationOption {
  readonly description?: string;
  readonly hint?: string;
  readonly isDisambiguation?: boolean;
  readonly label?: string;
  readonly qid: string;
  readonly sourceLine?: string;
  readonly title: string;
}

export interface CachedQidRecord {
  readonly checkedAt: string;
  readonly description?: string;
  readonly isDisambiguation: boolean;
  readonly label?: string;
  readonly pageId?: number;
  readonly qid: string;
  readonly sitelinkTitle?: string;
  readonly sitelinkWiki?: string;
  readonly updatedAt: string;
}

export interface CachedDisambiguationRecord {
  readonly checkedAt: string;
  readonly disambiguationQid: string;
  readonly language: string;
  readonly options: readonly DisambiguationOption[];
  readonly pageId?: number;
  readonly pageTitle: string;
  readonly wiki: string;
}

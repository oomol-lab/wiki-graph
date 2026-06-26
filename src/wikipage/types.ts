export interface WikipageResolverOptions {
  readonly cacheDatabasePath?: string;
  readonly concurrency?: number;
  readonly fetch?: typeof fetch;
  readonly language?: string;
  readonly maxBatchSize?: number;
  readonly minRequestIntervalMs?: number;
  readonly normalizer?: DisambiguationProfileNormalizer;
  readonly userAgent?: string;
  readonly wiki?: string;
}

export interface QidResolution {
  readonly description?: string;
  readonly disambiguation?: DisambiguationExpansion;
  readonly disambiguationPages?: readonly DisambiguationPageText[];
  readonly isDisambiguation: boolean;
  readonly label?: string;
  readonly qid: string;
  readonly sitelink?: WikipageSitelink;
  readonly sitelinks?: readonly WikipageSitelink[];
}

export interface WikipageSitelink {
  readonly title: string;
  readonly wiki: string;
}

export interface DisambiguationExpansion {
  readonly checkedAt: string;
  readonly disambiguationQid: string;
  readonly linkedQids: readonly DisambiguationLinkedQid[];
  readonly pages: readonly DisambiguationPageText[];
  readonly profile?: DisambiguationProfile;
}

export interface DisambiguationPageText {
  readonly linkedQids: readonly DisambiguationLinkedQid[];
  readonly pageId?: number;
  readonly text: string;
  readonly title: string;
  readonly wiki: "enwiki" | "zhwiki";
}

export interface DisambiguationLinkedQid {
  readonly qid: string;
  readonly title: string;
}

export interface CachedQidRecord {
  readonly checkedAt: string;
  readonly description?: string;
  readonly label?: string;
  readonly qid: string;
  readonly sitelinks: readonly CachedPageRecord[];
  readonly updatedAt: string;
}

export interface CachedDisambiguationRecord {
  readonly checkedAt: string;
  readonly disambiguationQid: string;
  readonly pages: readonly DisambiguationPageText[];
  readonly profile?: DisambiguationProfile;
}

export interface CachedPageRecord {
  readonly isDisambiguation: boolean;
  readonly pageId?: number;
  readonly title: string;
  readonly wiki: "enwiki" | "zhwiki";
}

export type DisambiguationMeaningPriority = "other" | "primary" | "secondary";

export interface DisambiguationProfile {
  readonly meanings: readonly DisambiguationProfileMeaning[];
  readonly sourceQid: string;
  readonly surface?: string;
}

export interface DisambiguationProfileMeaning {
  readonly category?: string;
  readonly information: string;
  readonly name: string;
  readonly priority: DisambiguationMeaningPriority;
  readonly qid: string;
}

export type DisambiguationProfileNormalizer = (
  input: DisambiguationProfileNormalizerInput,
) => Promise<DisambiguationProfile>;

export interface DisambiguationProfileNormalizerInput {
  readonly pageQidLinks: readonly DisambiguationLinkedQid[];
  readonly pages: readonly DisambiguationPageText[];
  readonly sourceQid: string;
  readonly surface?: string;
}

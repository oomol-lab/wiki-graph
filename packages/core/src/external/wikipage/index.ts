export { runWikipageCacheGc, WikipageCache } from "./cache.js";
export {
  createDisambiguationProfileNormalizer,
  type CreateDisambiguationProfileNormalizerOptions,
} from "./normalizer.js";
export { RateLimiter, parseRetryAfterMs } from "./rate-limiter.js";
export { WikipageResolver } from "./resolver.js";
export { WikimediaClient } from "./wikimedia-client/index.js";
export type {
  CachedDisambiguationRecord,
  CachedPageRecord,
  CachedQidRecord,
  DisambiguationExpansion,
  DisambiguationLinkedQid,
  DisambiguationPageText,
  DisambiguationMeaningPriority,
  DisambiguationProfile,
  DisambiguationProfileMeaning,
  DisambiguationProfileNormalizer,
  DisambiguationProfileNormalizerInput,
  QidResolution,
  WikipageResolveProgress,
  WikipageResolveProgressDetail,
  WikipageResolveProgressReporter,
  WikipageResolverOptions,
  WikipageSitelink,
} from "./types.js";

export const WIKG_MUTATION_TOKEN_PATH = ".wikg-mutation-token";
export const WIKG_MANIFEST_PATH = "manifest.json";
export const SEARCH_INDEX_DATABASE_PATH = "fts.db";

export const WIKG_ARCHIVE_PATTERNS = [
  /^\.wikg-mutation-token$/u,
  /^manifest\.json$/u,
  /^database\.db$/u,
  /^fts\.db$/u,
  /^toc\.json$/u,
  /^cover\/(?:data\.bin|info\.json)$/u,
  /^texts\/(?:source|summary)\/\d+\.txt$/u,
] as const;

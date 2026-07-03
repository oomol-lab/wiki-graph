export {
  ensureSearchIndex,
  isSearchIndexCurrent,
  querySearchIndex,
  readArchiveIndexSettings,
  SEARCH_INDEX_FTS_HIT_LIMIT,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  setFtsIndexEmbedded,
  TEXT_SENTENCE_KIND,
} from "./search-index.js";
export type {
  ArchiveIndexSettings,
  SearchIndexInput,
  SearchIndexObjectHit,
  SearchIndexProgressEvent,
  SearchIndexProgressPhase,
  SearchIndexProgressReporter,
  SearchIndexQueryResult,
  SearchIndexTextHit,
  SearchObjectPropertyKind,
  SearchObjectPropertyOwnerKind,
  TextSentenceKind,
} from "./search-index.js";

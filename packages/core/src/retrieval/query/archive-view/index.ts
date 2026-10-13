export { findArchiveObjects, grepArchiveObjects } from "./search/index.js";
export { readArchivePage, readArchiveText } from "./pages.js";
export {
  listAllArchiveLinks,
  listArchiveLinks,
  listRelatedArchiveObjects,
} from "./related/index.js";
export type { ArchivePageOptions } from "./pages.js";

export {
  ArchiveQueryNotReadyError,
  assertArchiveQueryReady,
  resolveIndexedArchiveChapterScope,
  clearDirtyArchiveSearchIndex,
  assertArchiveIndexArtifactsReady,
  buildArchiveIndexProjection,
  createArchiveSearchIndexFingerprint,
  isArchiveSearchIndexCurrent,
  listArchiveQueryableChapterIds,
  readArchiveSearchIndexStatus,
  rebuildArchiveSearchIndex,
  writeArchiveIndexProjectionFromArtifacts,
} from "./index-state.js";

export {
  formatChapterId,
  formatEdgeId,
  formatNodeId,
  formatSummaryId,
} from "./references.js";

export {
  getArchiveIndex,
  listArchiveCollection,
  listArchiveObjects,
} from "./collection.js";
export { listArchiveEvidence } from "./evidence.js";
export {
  isSourceLocatorScopeUri,
  listArchiveSourceLocators,
} from "./source-locators.js";
export { packArchiveContext } from "./pack.js";

export type {
  ArchiveBacklinkBucket,
  ArchiveBacklinks,
  ArchiveCollectionOptions,
  ArchiveCollectionResult,
  ArchiveCollectionType,
  ArchiveEntityWikipageLocale,
  ArchiveEvidence,
  ArchiveEvidenceItem,
  ArchiveEvidenceOptions,
  ArchiveFindEvidencePreview,
  ArchiveFindField,
  ArchiveFindFilterType,
  ArchiveFindHit,
  ArchiveFindLens,
  ArchiveFindLensHint,
  ArchiveFindMatch,
  ArchiveFindObjectType,
  ArchiveFindOptions,
  ArchiveFindOrder,
  ArchiveFindPosition,
  ArchiveFindResult,
  ArchiveIndex,
  ArchiveLibrarySource,
  ArchiveListItem,
  ArchiveListKind,
  ArchiveNodeLabel,
  ArchiveNodeSourceFragment,
  ArchiveObjectType,
  ArchivePack,
  ArchivePage,
  ArchiveRelatedOptions,
  ArchiveRelatedResult,
  ArchiveRelatedRole,
  ArchiveSourceFragment,
  ArchiveSourceLocator,
  ArchiveSourceLocatorOptions,
  ArchiveSourceLocatorResult,
  ArchiveTriplePattern,
} from "./types.js";

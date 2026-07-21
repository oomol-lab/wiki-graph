export enum WikiGraphScope {
  EditorCompress = "serial-generation/editor-compress",
  EditorReview = "serial-generation/editor-review",
  EditorReviewGuide = "serial-generation/editor-review-guide",
  ReaderChoice = "serial-generation/reader-choice",
  ReaderExtraction = "serial-generation/reader-extraction",
}

export const WIKI_GRAPH_SCOPES = Object.freeze([
  WikiGraphScope.EditorCompress,
  WikiGraphScope.EditorReview,
  WikiGraphScope.EditorReviewGuide,
  WikiGraphScope.ReaderChoice,
  WikiGraphScope.ReaderExtraction,
] as const);

export const WIKI_GRAPH_EDITOR_SCOPES = Object.freeze({
  compress: WikiGraphScope.EditorCompress,
  review: WikiGraphScope.EditorReview,
  reviewGuide: WikiGraphScope.EditorReviewGuide,
});

export const WIKI_GRAPH_READER_SCOPES = Object.freeze({
  choice: WikiGraphScope.ReaderChoice,
  extraction: WikiGraphScope.ReaderExtraction,
});

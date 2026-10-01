export type WikiGraphErrorCode =
  | "chapter_has_children"
  | "chapter_key_missing"
  | "chapter_not_found_ids"
  | "chapter_not_found_uris"
  | "chapter_summary_missing_source"
  | "chapter_summary_missing_tree"
  | "graph_node_not_found"
  | "home_upgrade_blocked"
  | "library_query_unindexed"
  | "parent_chapter_not_found"
  | "summary_not_completed"
  | "uri_expected";

export class WikiGraphError extends Error {
  public readonly code: WikiGraphErrorCode;
  public readonly details: Readonly<Record<string, string | number>>;

  public constructor(
    code: WikiGraphErrorCode,
    message: string,
    details: Readonly<Record<string, string | number>> = {},
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "WikiGraphError";
    this.code = code;
    this.details = details;
  }
}

export type WikiGraphErrorCode =
  | "schema_version_incompatible"
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

export type SchemaVersionTarget =
  | { readonly kind: "home" }
  | { readonly kind: "archive"; readonly path: string }
  | { readonly kind: "library"; readonly uri: string };

/** Only a successfully read, incompatible version produces this error. */
export class WikiGraphSchemaVersionError extends WikiGraphError {
  public readonly target: SchemaVersionTarget;
  public readonly actualVersion: number;
  public readonly supportedVersion: number;
  public readonly reason: "upgrade-required" | "newer-version";

  public constructor(
    target: SchemaVersionTarget,
    actualVersion: number,
    supportedVersion: number,
  ) {
    const reason =
      actualVersion < supportedVersion ? "upgrade-required" : "newer-version";
    super(
      "schema_version_incompatible",
      `Wiki Graph ${target.kind}${target.kind === "home" ? "" : ` ${target.kind === "archive" ? target.path : target.uri}`} schema v${actualVersion} is incompatible with supported v${supportedVersion}.`,
      { actualVersion, supportedVersion, reason },
    );
    this.name = "WikiGraphSchemaVersionError";
    this.target = target;
    this.actualVersion = actualVersion;
    this.supportedVersion = supportedVersion;
    this.reason = reason;
  }
}

/** Recognizes instances from duplicate packages and intact serialized error records. */
export type WikiGraphSchemaVersionErrorInfo = Pick<
  WikiGraphSchemaVersionError,
  "code" | "target" | "actualVersion" | "supportedVersion" | "reason"
>;

export function isWikiGraphSchemaVersionError(
  value: unknown,
): value is WikiGraphSchemaVersionErrorInfo {
  if (typeof value !== "object" || value === null) return false;
  const error = value as Partial<WikiGraphSchemaVersionError>;
  const target = error.target;
  return (
    error.code === "schema_version_incompatible" &&
    Number.isInteger(error.actualVersion) &&
    Number.isInteger(error.supportedVersion) &&
    typeof error.actualVersion === "number" &&
    error.actualVersion > 0 &&
    typeof error.supportedVersion === "number" &&
    error.supportedVersion > 0 &&
    error.actualVersion !== error.supportedVersion &&
    error.reason ===
      (error.actualVersion < error.supportedVersion
        ? "upgrade-required"
        : "newer-version") &&
    typeof target === "object" &&
    target !== null &&
    (target.kind === "home" ||
      (target.kind === "archive" && typeof target.path === "string") ||
      (target.kind === "library" && typeof target.uri === "string"))
  );
}

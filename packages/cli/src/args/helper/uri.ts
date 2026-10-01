import {
  CLI_HELP_ROUTES,
  parseLocatedWikiGraphUri,
  withHelpRoute,
} from "../../support/index.js";
import {
  parseLocalConfigSection,
  type LocalConfigSection,
} from "../../runtime/local-config.js";
import { parseWikiGraphUriSyntax, WIKI_GRAPH_URI_PREFIX } from "wiki-graph-sdk";
import type { CLIArchiveAction } from "../types.js";

export function validateArchiveCommandUriInput(
  action: CLIArchiveAction,
  value: string,
): void {
  if (
    action === "create" ||
    action === "export" ||
    action === "inspect" ||
    action === "next"
  ) {
    return;
  }

  if (isWikiGraphUri(value)) {
    if (parseLocatedWikiGraphUri(value).archivePath === undefined) {
      throw new Error(formatMissingArchiveLocatorMessage(value));
    }
    return;
  }

  if (!looksLikeWikgPath(value)) {
    return;
  }

  throw new Error(formatPathAsUriMessage(value));
}

export function parseArchiveInspectChapterId(
  uri: string | undefined,
): number | undefined {
  if (uri === undefined || !isWikiGraphUri(uri)) {
    return undefined;
  }

  const objectUri = parseLocatedWikiGraphUri(uri).objectUri;
  const match =
    objectUri === undefined
      ? undefined
      : /^wikg:\/\/chapter\/([1-9][0-9]*)$/u.exec(objectUri);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export function validatePackTargetUri(uri: string, helpRoute: string): void {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(
      withHelpRoute(formatMissingArchiveLocatorMessage(uri), helpRoute),
    );
  }
  if (parsed.objectUri === undefined) {
    throw new Error(
      withHelpRoute(formatPackObjectMismatchMessage(uri), CLI_HELP_ROUTES.uri),
    );
  }
  if (!isPackableObjectUri(parsed.objectUri)) {
    throw new Error(
      withHelpRoute(formatPackObjectMismatchMessage(uri), helpRoute),
    );
  }
}

export function validateRelatedTargetUri(
  uri: string,
  helpRoute: string,
): "chunk" | "entity" {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(
      withHelpRoute(formatMissingArchiveLocatorMessage(uri), helpRoute),
    );
  }
  if (parsed.objectUri === undefined) {
    throw new Error(
      withHelpRoute(
        `Related requires a chunk or entity URI: ${uri}`,
        CLI_HELP_ROUTES.uri,
      ),
    );
  }
  const targetType = getRelatedObjectUriType(parsed.objectUri);

  if (targetType === undefined) {
    throw new Error(
      withHelpRoute(
        `Related is only available for chunk and entity objects: ${uri}`,
        helpRoute,
      ),
    );
  }

  return targetType;
}

export function validateEvidenceTargetUri(
  uri: string,
  helpRoute: string,
): void {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(
      withHelpRoute(formatMissingArchiveLocatorMessage(uri), helpRoute),
    );
  }
  if (
    parsed.objectUri === undefined ||
    !isEvidenceObjectUri(parsed.objectUri)
  ) {
    throw new Error(
      withHelpRoute(
        `Evidence is only available for chunk, entity, and triple objects: ${uri}`,
        helpRoute,
      ),
    );
  }
}

export function isEvidenceObjectUri(objectUri: string): boolean {
  const path = stripObjectUriPrefix(objectUri);
  const normalized = path.startsWith("chapter/")
    ? /^chapter\/[1-9][0-9]*\/(.+)$/u.exec(path)?.[1]
    : path;
  if (normalized === undefined) {
    return false;
  }
  const parts = normalized.split("/");
  return (
    (parts[0] === "chunk" && parts.length === 2) ||
    (parts[0] === "entity" && parts.length === 2) ||
    (parts[0] === "triple" && parts.length === 4)
  );
}

export function isPackableObjectUri(objectUri: string): boolean {
  return (
    /^wikg:\/\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wikg:\/\/entity\/[^/]+$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/entity\/[^/]+$/u.test(objectUri)
  );
}

export function getRelatedObjectUriType(
  objectUri: string,
): "chunk" | "entity" | undefined {
  if (
    /^wikg:\/\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/chunk\/[1-9][0-9]*$/u.test(objectUri)
  ) {
    return "chunk";
  }
  if (
    /^wikg:\/\/entity\/[^/]+$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/entity\/[^/]+$/u.test(objectUri)
  ) {
    return "entity";
  }

  return undefined;
}

export function formatUnknownCommandMessage(command: string): string {
  if (looksLikeWikgPath(command)) {
    return formatPathAsUriMessage(command);
  }

  return withHelpRoute(`Unknown command: ${command}.`, CLI_HELP_ROUTES.command);
}

export function looksLikeWikgPath(value: string): boolean {
  const normalized = normalizeWikgPathSeparators(value);

  return (
    normalized.endsWith(".wikg") ||
    normalized.includes(".wikg/") ||
    normalized.includes(".wikg#")
  );
}

export function formatPathAsUriMessage(path: string): string {
  const normalized = normalizeWikgPathSeparators(path);
  const [archivePath = normalized, suffix = ""] = splitWikgPath(normalized);
  const uri = archivePath.startsWith("/")
    ? `wikg://${archivePath}${suffix}`
    : `wikg://${archivePath.replace(/^\.\/+/u, "")}${suffix}`;

  return [
    `Expected a Wiki Graph URI, not a filesystem path: ${path}`,
    `Use: ${uri}`,
    "See: wg help uri",
  ].join("\n");
}

export function splitWikgPath(path: string): readonly [string, string] {
  const archiveEnd = path.indexOf(".wikg") + ".wikg".length;

  return [path.slice(0, archiveEnd), path.slice(archiveEnd)];
}

export function normalizeWikgPathSeparators(path: string): string {
  return path.replace(/\\/gu, "/");
}

export function formatMissingArchiveLocatorMessage(uri: string): string {
  return [
    `Expected a located Wiki Graph URI with a .wikg archive locator: ${uri}`,
    "Short object URIs from output are archive-relative handles.",
    "Example: wikg://book.wikg/entity/Q9957",
    "See: wg help uri",
  ].join("\n");
}

export function formatPackObjectMismatchMessage(uri: string): string {
  return [
    `Pack requires a graph object URI: ${uri}`,
    "Supported pack targets are chunk and entity objects.",
    "Use `wg <uri> --help` to inspect valid predicates.",
  ].join("\n");
}

export function formatMissingArchiveInputMessage(
  action: CLIArchiveAction,
): string {
  switch (action) {
    case "create":
      return "Missing archive URI. Use `wg wikg://<archive.wikg> create`.";
    case "export":
      return "Missing archive URI. Use `wg wikg://<archive.wikg> export --output-format <format>`.";
    case "inspect":
      return "Missing archive URI. Use `wg wikg://<archive.wikg> inspect`.";
    case "search":
      return "Missing scope URI with .wikg locator. Use `wg wikg://<archive.wikg> --query <query>`.";
    case "list":
      return "Missing scope URI with .wikg locator. Use `wg wikg://<archive.wikg>`.";
    case "get":
      return "Missing object URI with .wikg locator. Use `wg wikg://<archive.wikg>/<object>`.";
    case "related":
    case "evidence":
    case "pack":
      return `Missing object URI. Use \`wg wikg://<archive.wikg>/<object> ${action}\`.`;
    case "next":
      return "Missing continuation cursor. Use `wg next <cursor>`.";
  }
}
export function isWikiGraphUri(value: string | undefined): boolean {
  return value?.startsWith(WIKI_GRAPH_URI_PREFIX) === true;
}

export function stripObjectUriPrefix(objectUri: string): string {
  const prefix = getWikiGraphUriPrefix(objectUri);

  if (prefix === undefined) {
    throw new Error(`Expected Wiki Graph object URI: ${objectUri}`);
  }

  return objectUri.slice(prefix.length).replace(/^\/+|\/+$/gu, "");
}

export function isWikiGraphJobUri(value: string | undefined): boolean {
  return isWikiGraphLocalJobUri(value);
}

export function isWikiGraphLocalConfigUri(value: string | undefined): boolean {
  const path = parseWikiGraphPath(value);
  return path?.[0] === "local" && path[1] === "config" && path.length >= 2;
}

export function parseLocalConfigUriSection(
  uri: string,
): LocalConfigSection | undefined {
  const path = parseWikiGraphPath(uri);
  if (path?.[0] !== "local" || path[1] !== "config") {
    return undefined;
  }
  const section = path[2];

  return parseLocalConfigSection(section);
}

export function parseWikiGraphJobUri(uri: string): string | undefined {
  const body = parseWikiGraphJobUriBody(uri);

  if (body === undefined) {
    throw new Error(
      withHelpRoute(
        `Expected a Wiki Graph job URI: ${uri}`,
        "wg wikg://local/job --help",
      ),
    );
  }

  const jobId = stripLeadingSlash(body).trim();
  if (jobId === "") {
    return undefined;
  }

  return jobId;
}

export function parseWikiGraphJobTargetUri(
  uri: string | undefined,
): string | undefined {
  if (uri === undefined) {
    return undefined;
  }

  const body = parseWikiGraphJobUriBody(uri);
  if (body === undefined) {
    return undefined;
  }
  if (!body.endsWith("/target")) {
    return undefined;
  }

  const jobId = stripLeadingSlash(body.slice(0, -"/target".length)).trim();
  if (jobId === "") {
    throw new Error(
      withHelpRoute(
        `Expected a job id before /target: ${uri}`,
        "wg wikg://local/job/<job-id>/target set --help",
      ),
    );
  }

  return jobId;
}

export function getWikiGraphUriPrefix(uri: string): string | undefined {
  if (uri.startsWith(WIKI_GRAPH_URI_PREFIX)) {
    return WIKI_GRAPH_URI_PREFIX;
  }

  return undefined;
}

export function isWikiGraphLocalJobUri(value: string | undefined): boolean {
  const path = parseWikiGraphPath(value);
  return path?.[0] === "local" && path[1] === "job";
}

export function parseWikiGraphJobUriBody(uri: string): string | undefined {
  const path = parseWikiGraphPath(uri);
  if (path?.[0] !== "local" || path[1] !== "job") {
    return undefined;
  }
  if (path.length === 2) {
    return "";
  }

  return `/${path.slice(2).join("/")}`;
}

export function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/u, "");
}

function parseWikiGraphPath(
  value: string | undefined,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const parsed = parseWikiGraphUriSyntax(value);
    return parsed.protocol === "wikg" ? parsed.path : undefined;
  } catch {
    return undefined;
  }
}

export function requireArchiveUriPath(uri: string, helpRoute: string): string {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined || parsed.objectUri !== undefined) {
    throw new Error(
      withHelpRoute(`Expected an archive Wiki Graph URI: ${uri}`, helpRoute),
    );
  }

  return parsed.archivePath;
}

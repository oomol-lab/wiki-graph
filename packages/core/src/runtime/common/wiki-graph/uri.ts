import { RESERVED_LIBRARY_URI_SEGMENTS } from "../../../library/segments.js";

export const WIKI_GRAPH_URI_PREFIX = "wikg://";
export const WIKI_GRAPH_JOB_URI_PREFIX = "wikg://local/job";
export const WIKI_GRAPH_ARCHIVE_EXTENSION = ".wikg";

export interface ParsedWikiGraphUri {
  readonly protocol: string;
  readonly path: readonly string[];
  readonly fragment?:
    | number
    | { readonly begin: number; readonly end: number }
    | { readonly raw: string };
}

export interface LocatedWikiGraphUri {
  readonly archivePath?: string;
  readonly objectUri?: string;
}

export function isWikiGraphUri(value: string | undefined): value is string {
  return isWikiGraphUriPrefix(value);
}

export function isWikiGraphJobUri(value: string | undefined): value is string {
  return isWikiGraphLocalJobUri(value);
}

export function parseLocatedWikiGraphUri(uri: string): LocatedWikiGraphUri {
  const parsed = parseWikiGraphUriSyntax(uri);

  if (parsed.protocol !== "wikg") {
    throw new Error(formatWikiGraphUriExpectedError(uri));
  }

  const libraryArchive = parseLibraryArchiveLocatorPath(
    parsed.path,
    parsed.fragment,
  );
  if (libraryArchive !== undefined) {
    return libraryArchive;
  }
  const parts = parsed.path;
  const archiveIndex = parts.findIndex((part) =>
    part.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION),
  );

  if (archiveIndex < 0) {
    return {
      objectUri: formatWikiGraphObjectUri(
        parts.join("/"),
        formatWikiGraphUriFragment(parsed.fragment),
      ),
    };
  }

  const archivePath = formatArchivePathFromUriSegments(
    parts.slice(0, archiveIndex + 1),
  );
  const objectPath = parts.slice(archiveIndex + 1).join("/");

  if (archivePath === "") {
    throw new Error(`Invalid Wiki Graph archive URI: ${uri}`);
  }

  return {
    archivePath: resolveArchivePath(archivePath),
    ...(objectPath === ""
      ? {}
      : {
          objectUri: formatWikiGraphObjectUri(
            objectPath,
            formatWikiGraphUriFragment(parsed.fragment),
          ),
        }),
  };
}

export function parseWikiGraphUriSyntax(uri: string): ParsedWikiGraphUri {
  const separatorIndex = uri.indexOf("://");
  if (separatorIndex <= 0) {
    throw new Error(formatWikiGraphUriExpectedError(uri));
  }

  const protocol = uri.slice(0, separatorIndex);
  const body = uri.slice(separatorIndex + "://".length);
  const hashIndex = body.indexOf("#");
  const rawPath = hashIndex < 0 ? body : body.slice(0, hashIndex);
  const rawFragment = hashIndex < 0 ? undefined : body.slice(hashIndex + 1);

  if (rawFragment?.includes("#") === true) {
    throw new Error(`Invalid Wiki Graph URI fragment: ${uri}`);
  }

  const path = parseWikiGraphUriPath(rawPath, uri);

  const parsedFragment = optionalWikiGraphUriFragment(rawFragment, uri, path);
  return parsedFragment === undefined
    ? { protocol, path }
    : { fragment: parsedFragment, protocol, path };
}

function parseWikiGraphUriPath(path: string, uri: string): readonly string[] {
  const trimmed = path.replace(/\/+$/u, "");
  if (trimmed === "") {
    return [];
  }

  if (trimmed.startsWith("/")) {
    const absoluteTail = trimmed.slice(1);
    if (absoluteTail === "") {
      return ["/"];
    }
    const segments = absoluteTail.split("/");
    rejectEmptyUriSegments(segments, uri);
    return ["/", ...segments];
  }

  const segments = trimmed.split("/");
  rejectEmptyUriSegments(segments, uri);
  return segments;
}

function rejectEmptyUriSegments(
  segments: readonly string[],
  uri: string,
): void {
  if (segments.includes("")) {
    throw new Error(
      `Invalid Wiki Graph URI path: empty path segment in ${uri}`,
    );
  }
}

function optionalWikiGraphUriFragment(
  fragment: string | undefined,
  uri: string,
  path: readonly string[],
): NonNullable<ParsedWikiGraphUri["fragment"]> | undefined {
  if (fragment === undefined) {
    return undefined;
  }
  if (fragment === "") {
    throw new Error(`Invalid Wiki Graph URI fragment: ${uri}`);
  }

  const range = /^(?<begin>[0-9]+)\.\.(?<end>[0-9]+)$/u.exec(fragment);
  if (range?.groups !== undefined) {
    const begin = Number(range.groups.begin);
    const end = Number(range.groups.end);
    return { begin, end };
  }

  if (/^[0-9]+$/u.test(fragment)) {
    return Number(fragment);
  }

  if (
    path.at(-2) === "artifact" &&
    /^[0-9a-f]{12,64}$/iu.test(path.at(-1) ?? "")
  ) {
    return { raw: fragment };
  }

  throw new Error(`Invalid Wiki Graph URI fragment: ${uri}`);
}

function parseLibraryArchiveLocatorPath(
  path: readonly string[],
  fragment: ParsedWikiGraphUri["fragment"],
): LocatedWikiGraphUri | undefined {
  if (path[0] !== "lib") {
    return undefined;
  }

  const arcIndex = path[1] === "arc" ? 1 : path[2] === "arc" ? 2 : -1;
  if (arcIndex < 0) {
    return undefined;
  }

  const library = arcIndex === 2 ? path[1] : undefined;
  const archive = path[arcIndex + 1];
  if (
    archive === undefined ||
    archive.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION) ||
    isLibraryScopeSegment(archive)
  ) {
    return undefined;
  }
  const archivePath = `${WIKI_GRAPH_URI_PREFIX}lib/${
    library === undefined ? "" : `${library}/`
  }arc/${archive}`;
  const objectPath = path.slice(arcIndex + 2).join("/");

  return {
    archivePath,
    ...(objectPath === ""
      ? {}
      : {
          objectUri: formatWikiGraphObjectUri(
            objectPath,
            formatWikiGraphUriFragment(fragment),
          ),
        }),
  };
}

function formatArchivePathFromUriSegments(segments: readonly string[]): string {
  if (segments[0] === "/") {
    return `/${segments.slice(1).join("/")}`;
  }

  return segments.join("/");
}

function formatWikiGraphUriFragment(
  fragment: ParsedWikiGraphUri["fragment"],
): string | undefined {
  if (fragment === undefined) {
    return undefined;
  }
  if (typeof fragment === "number") {
    return String(fragment);
  }
  if ("raw" in fragment) {
    return fragment.raw;
  }

  return `${fragment.begin}..${fragment.end}`;
}

function isLibraryScopeSegment(segment: string): boolean {
  return RESERVED_LIBRARY_URI_SEGMENTS.has(segment);
}

function resolveArchivePath(archivePath: string): string {
  return archivePath.replaceAll("\\", "/");
}

export function formatLocatedWikiGraphUri(
  archivePath: string,
  objectUri?: string,
): string {
  const uriArchivePath = archivePath.replace(/\\/gu, "/");

  if (objectUri === undefined || objectUri === WIKI_GRAPH_URI_PREFIX) {
    return `${WIKI_GRAPH_URI_PREFIX}${uriArchivePath}`;
  }

  return `${WIKI_GRAPH_URI_PREFIX}${uriArchivePath}/${stripWikiGraphUriPrefix(
    objectUri,
  )}`;
}

export function formatWikiGraphCommandUri(
  archivePath: string,
  objectUri?: string,
  _cwd?: string,
): string {
  return formatLocatedWikiGraphUri(archivePath, objectUri);
}

export function formatLocatedChapterUri(
  archivePath: string,
  chapterPath: string,
): string {
  return formatLocatedWikiGraphUri(
    archivePath,
    formatWikiGraphObjectUri(`chapter/${chapterPath}`),
  );
}

export function formatLocatedChapterResourceUri(
  archivePath: string,
  chapterPath: string,
  resource: "source" | "summary" | "title",
): string {
  return formatLocatedWikiGraphUri(
    archivePath,
    formatWikiGraphObjectUri(`chapter/${chapterPath}/${resource}`),
  );
}

export function formatLocatedChapterSourceCollectionUri(
  archivePath: string,
  chapterPath: string,
): string {
  return formatLocatedWikiGraphUri(
    archivePath,
    formatWikiGraphObjectUri(`chapter/${chapterPath}/source`),
  );
}

export function formatWikiGraphObjectUri(path: string, hash?: string): string {
  const normalizedPath = path.replace(/^\/+/u, "").replace(/\/+$/u, "");

  return `${WIKI_GRAPH_URI_PREFIX}${normalizedPath}${
    hash === undefined ? "" : `#${hash}`
  }`;
}

export function requireArchiveUri(uri: string): string {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined || parsed.objectUri !== undefined) {
    throw new Error(
      `${formatWikiGraphUriExpectedError(uri)} Expected a .wikg archive locator.`,
    );
  }

  return parsed.archivePath;
}

export function requireLocatedObjectUri(uri: string): {
  readonly archivePath: string;
  readonly objectUri: string;
} {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined || parsed.objectUri === undefined) {
    throw new Error(
      `${formatWikiGraphUriExpectedError(uri)} Expected an object URI with a .wikg archive locator.`,
    );
  }

  return {
    archivePath: parsed.archivePath,
    objectUri: parsed.objectUri,
  };
}

export function requireLocatedObjectOrArchiveUri(uri: string): {
  readonly archivePath: string;
  readonly objectUri?: string;
} {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(formatWikiGraphUriExpectedError(uri));
  }

  return {
    archivePath: parsed.archivePath,
    ...(parsed.objectUri === undefined ? {} : { objectUri: parsed.objectUri }),
  };
}

export function formatWikiGraphUriExpectedError(value: string): string {
  const example =
    value.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION) && value.startsWith("/")
      ? `${WIKI_GRAPH_URI_PREFIX}${value}`
      : "wikg:///absolute/path/book.wikg";

  return [
    `Expected a Wiki Graph URI with a .wikg archive locator: ${value}`,
    `Example: ${example}`,
  ].join("\n");
}

function stripWikiGraphUriPrefix(uri: string): string {
  const prefix = getWikiGraphUriPrefix(uri);

  if (prefix === undefined) {
    throw new Error(`Expected a Wiki Graph object URI: ${uri}`);
  }

  return uri.slice(prefix.length).replace(/^\/+/u, "");
}

function getWikiGraphUriPrefix(uri: string): string | undefined {
  if (uri.startsWith(WIKI_GRAPH_URI_PREFIX)) {
    return WIKI_GRAPH_URI_PREFIX;
  }

  return undefined;
}

function isWikiGraphUriPrefix(value: string | undefined): value is string {
  return value?.startsWith(WIKI_GRAPH_URI_PREFIX) === true;
}

function isWikiGraphLocalJobUri(value: string | undefined): boolean {
  return (
    value === WIKI_GRAPH_JOB_URI_PREFIX ||
    value?.startsWith(`${WIKI_GRAPH_JOB_URI_PREFIX}/`) === true
  );
}

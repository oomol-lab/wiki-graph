import { resolve } from "path";

export const WIKI_GRAPH_URI_PREFIX = "wikg://";
export const WIKI_GRAPH_JOB_URI_PREFIX = "wikg://local/job";
export const WIKI_GRAPH_ARCHIVE_EXTENSION = ".wikg";

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
  const prefix = getWikiGraphUriPrefix(uri);

  if (prefix === undefined) {
    throw new Error(formatWikiGraphUriExpectedError(uri));
  }

  const body = uri.slice(prefix.length);
  const split = body.split("#", 2);
  const path = split[0] ?? "";
  const hash = split[1] ?? "";
  const parts = path.split("/");
  const archiveIndex = parts.findIndex((part) =>
    part.endsWith(WIKI_GRAPH_ARCHIVE_EXTENSION),
  );

  if (archiveIndex < 0) {
    return { objectUri: uri };
  }

  const archivePath = parts.slice(0, archiveIndex + 1).join("/");
  const objectPath = parts.slice(archiveIndex + 1).join("/");

  if (archivePath === "") {
    throw new Error(`Invalid Wiki Graph archive URI: ${uri}`);
  }

  return {
    archivePath: resolve(archivePath),
    ...(objectPath === ""
      ? {}
      : {
          objectUri: formatWikiGraphObjectUri(
            objectPath,
            hash === "" ? undefined : hash,
          ),
        }),
  };
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

export function formatLocatedChapterUri(
  archivePath: string,
  chapterId: number,
): string {
  return formatLocatedWikiGraphUri(
    archivePath,
    formatWikiGraphObjectUri(`chapter/${chapterId}`),
  );
}

export function formatLocatedChapterResourceUri(
  archivePath: string,
  chapterId: number,
  resource: "source" | "summary" | "title",
): string {
  return formatLocatedWikiGraphUri(
    archivePath,
    formatWikiGraphObjectUri(`chapter/${chapterId}/${resource}`),
  );
}

export function formatLocatedChapterSourceCollectionUri(
  archivePath: string,
  chapterId: number,
): string {
  return formatLocatedWikiGraphUri(
    archivePath,
    formatWikiGraphObjectUri(`chapter/${chapterId}/source`),
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
    "See: wikigraph help uri",
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

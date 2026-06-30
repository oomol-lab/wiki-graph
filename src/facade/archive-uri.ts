import { resolve } from "path";

export interface LocatedWikiGraphUri {
  readonly archivePath?: string;
  readonly objectUri?: string;
}

export function parseLocatedWikiGraphUri(uri: string): LocatedWikiGraphUri {
  const prefix = "wkg://";

  if (!uri.startsWith(prefix)) {
    throw new Error(formatWikiGraphUriExpectedError(uri));
  }

  const body = uri.slice(prefix.length);
  const split = body.split("#", 2);
  const path = split[0] ?? "";
  const hash = split[1] ?? "";
  const parts = path.split("/");
  const archiveIndex = parts.findIndex((part) => part.endsWith(".sdpub"));

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
    ...(objectPath === "" && !path.endsWith("/")
      ? {}
      : {
          objectUri: `wkg://${objectPath}${hash === "" ? "" : `#${hash}`}`,
        }),
  };
}

export function requireArchiveUri(uri: string): string {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined || parsed.objectUri !== undefined) {
    throw new Error(
      `${formatWikiGraphUriExpectedError(uri)} Expected an archive URI ending in .sdpub.`,
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
      `${formatWikiGraphUriExpectedError(uri)} Expected an object URI with a .sdpub archive locator.`,
    );
  }

  return {
    archivePath: parsed.archivePath,
    objectUri: parsed.objectUri,
  };
}

function formatWikiGraphUriExpectedError(value: string): string {
  const example =
    value.endsWith(".sdpub") && value.startsWith("/")
      ? `wkg://${value}`
      : "wkg:///absolute/path/book.sdpub";

  return [
    `Expected a Wiki Graph URI with a .sdpub archive locator: ${value}`,
    `Example: ${example}`,
    "See: wikigraph help uri",
  ].join("\n");
}

import { homedir } from "os";
import { isAbsolute, relative, resolve } from "path";

import {
  formatWikiGraphCommandUri as formatPortableWikiGraphCommandUri,
  parseLocatedWikiGraphUri as parsePortableLocatedWikiGraphUri,
  type LocatedWikiGraphUri,
} from "wiki-graph-sdk";

import { getCLICwd, getCLIEnvValue } from "../runtime/context.js";

export interface RelativeArchiveUriResolution {
  readonly inputUri: string;
  readonly resolvedArchivePath: string;
  readonly workingDirectory: string;
}

/** Apply Node path semantics at the CLI boundary, after Core parses URI syntax. */
export function parseLocatedWikiGraphUri(uri: string): LocatedWikiGraphUri {
  const parsed = parsePortableLocatedWikiGraphUri(uri);
  if (
    parsed.archivePath === undefined ||
    parsed.archivePath.startsWith("wikg://lib/")
  ) {
    return parsed;
  }
  return {
    ...parsed,
    archivePath: resolveCLIArchivePath(parsed.archivePath),
  };
}

export function formatWikiGraphCommandUri(
  archivePath: string,
  objectUri?: string,
  cwd = getCLICwd(),
): string {
  let locator = archivePath;
  if (isAbsolute(archivePath)) {
    const candidate = relative(cwd, archivePath);
    if (
      candidate !== "" &&
      !candidate.startsWith("..") &&
      !isAbsolute(candidate)
    ) {
      locator = candidate;
    }
  }
  return formatPortableWikiGraphCommandUri(locator, objectUri);
}

export function getRelativeArchiveUriResolution(
  uri: string,
): RelativeArchiveUriResolution | undefined {
  let parsed: LocatedWikiGraphUri;
  try {
    parsed = parsePortableLocatedWikiGraphUri(uri);
  } catch {
    return undefined;
  }

  const locator = parsed.archivePath;
  if (
    locator === undefined ||
    locator === "~" ||
    locator.startsWith("~/") ||
    locator.startsWith("wikg://lib/") ||
    isAbsolute(locator)
  ) {
    return undefined;
  }

  const workingDirectory = getCLICwd();
  return {
    inputUri: uri,
    resolvedArchivePath: resolve(workingDirectory, locator),
    workingDirectory,
  };
}

function resolveCLIArchivePath(locator: string): string {
  if (locator === "~") return getCLIHomeDirectory();
  if (locator.startsWith("~/")) {
    return resolve(getCLIHomeDirectory(), locator.slice(2));
  }
  return resolve(getCLICwd(), locator);
}

function getCLIHomeDirectory(): string {
  const environmentHome = getCLIEnvValue("HOME")?.trim();
  return environmentHome === undefined || environmentHome === ""
    ? homedir()
    : environmentHome;
}

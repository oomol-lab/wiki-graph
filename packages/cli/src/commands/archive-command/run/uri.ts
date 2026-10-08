import { parseWikiGraphLibraryUri, type QueryIndexScope } from "wiki-graph-sdk";
import { parseLocatedWikiGraphUri } from "../../../support/index.js";

import type { CLIArchiveArguments } from "../../../args/index.js";
export function resolveArchiveCommandRuntimeArguments(
  args: CLIArchiveArguments,
): CLIArchiveArguments {
  if (args.action === "create" || args.action === "export") {
    return { ...args, archivePath: getArchivePath(args.archivePath) };
  }
  return args;
}

export function getArchivePath(uri: string): string {
  if (!uri.includes("://")) return uri;
  const libraryTarget = parseWikiGraphLibraryUri(uri);
  if (
    libraryTarget?.kind === "scope" ||
    libraryTarget?.kind === "archive-collection"
  ) {
    return uri;
  }

  const archivePath = parseLocatedWikiGraphUri(uri).archivePath;
  if (archivePath === undefined) {
    throw new Error(`Missing archive locator in URI: ${uri}`);
  }
  return archivePath;
}

export function getArchiveIndexScope(uri: string): QueryIndexScope {
  const libraryTarget = parseWikiGraphLibraryUri(uri);
  if (
    libraryTarget?.kind === "scope" ||
    libraryTarget?.kind === "archive-collection"
  ) {
    return { kind: "library-index", libraryId: -1 };
  }

  const archivePath = getArchivePath(uri);
  return { archiveKey: archivePath, archivePath, kind: "archive-index" };
}

export function getObjectUri(uri: string): string {
  const libraryTarget = parseWikiGraphLibraryUri(uri);
  if (
    libraryTarget?.kind === "scope" &&
    libraryTarget.objectUri !== undefined
  ) {
    return libraryTarget.objectUri;
  }

  const parsed = parseLocatedWikiGraphUri(uri);

  return parsed.objectUri ?? "wikg://";
}

export function isArchiveRootGet(args: CLIArchiveArguments): boolean {
  return (
    args.objectId !== undefined &&
    parseLocatedWikiGraphUri(args.objectId).objectUri === undefined
  );
}

export function parseChapterScope(uri: string): number | undefined {
  const match = /^wikg:\/\/chapter\/([1-9][0-9]*)(?:\/|$)/u.exec(uri);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

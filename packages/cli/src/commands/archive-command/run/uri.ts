import {
  parseWikiGraphLibraryUri,
  resolveWikiGraphArchiveLocation,
  type WikiGraphArchiveLocation,
  type QueryIndexScope,
} from "wiki-graph-sdk";
import { parseLocatedWikiGraphUri } from "../../../support/index.js";

import type { CLIArchiveArguments } from "../../../args/index.js";
export type ArchiveRuntimeLocation = WikiGraphArchiveLocation;

export async function resolveArchiveRuntimeLocation(
  uriOrPath: string,
): Promise<ArchiveRuntimeLocation> {
  return await resolveWikiGraphArchiveLocation(uriOrPath);
}

export async function resolveArchiveCommandRuntimeArguments(
  args: CLIArchiveArguments,
): Promise<CLIArchiveArguments> {
  if (
    args.action === "create" ||
    args.action === "export"
  ) {
    const location = await resolveArchiveRuntimeLocation(args.archivePath);
    return { ...args, archivePath: location.archivePath };
  }
  if (args.action === "inspect" || args.action === "next") return args;
  if (!args.archivePath.startsWith("wikg://lib/")) {
    return args;
  }

  const location = await resolveArchiveRuntimeLocation(args.archivePath);
  return {
    ...args,
    archivePath: location.locatedUri,
    ...(args.objectId === args.archivePath
      ? { objectId: location.locatedUri }
      : {}),
  };
}

export function getArchivePath(uri: string): string {
  if (parseWikiGraphLibraryUri(uri)?.kind === "scope") {
    return uri;
  }

  const archivePath = parseLocatedWikiGraphUri(uri).archivePath;
  if (archivePath === undefined) {
    throw new Error(`Missing archive locator in URI: ${uri}`);
  }
  return archivePath;
}

export function getArchiveIndexScope(uri: string): QueryIndexScope {
  if (parseWikiGraphLibraryUri(uri)?.kind === "scope") {
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

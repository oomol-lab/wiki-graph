import {
  formatLocatedWikiGraphUri,
  parseWikiGraphLibraryUri,
  parseLocatedWikiGraphUri,
  requireLocatedObjectOrArchiveUri,
  resolveWikiGraphLibraryArchivePath,
  type ParsedWikiGraphLibraryUri,
  type QueryIndexScope,
} from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../../args/index.js";

export interface ArchiveRuntimeLocation {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly indexScope: QueryIndexScope;
  readonly libraryArchiveTarget?: ParsedWikiGraphLibraryUri;
  readonly libraryDirtyTarget?: ParsedWikiGraphLibraryUri;
  readonly locatedUri: string;
}

export async function resolveArchiveRuntimeLocation(
  uriOrPath: string,
): Promise<ArchiveRuntimeLocation> {
  if (!uriOrPath.startsWith("wikg://")) {
    return {
      archiveKey: uriOrPath,
      archivePath: uriOrPath,
      indexScope: {
        archiveKey: uriOrPath,
        archivePath: uriOrPath,
        kind: "archive-index",
      },
      locatedUri: formatLocatedWikiGraphUri(uriOrPath),
    };
  }

  const parsed = parseLocatedWikiGraphUri(uriOrPath);
  const archiveLocator = parsed.archivePath ?? uriOrPath;
  const libraryArchiveTarget = archiveLocator.startsWith("wikg://lib/")
    ? parseWikiGraphLibraryUri(archiveLocator)
    : undefined;
  const archivePath =
    libraryArchiveTarget?.kind === "archive"
      ? await resolveWikiGraphLibraryArchivePath(archiveLocator)
      : archiveLocator;

  return {
    archiveKey: archivePath,
    archivePath,
    indexScope: { archiveKey: archivePath, archivePath, kind: "archive-index" },
    ...(libraryArchiveTarget?.kind === "archive"
      ? {
          libraryArchiveTarget,
          libraryDirtyTarget: {
            isDefault: libraryArchiveTarget.isDefault,
            kind: "scope",
            ...(libraryArchiveTarget.publicId === undefined
              ? {}
              : { publicId: libraryArchiveTarget.publicId }),
          },
        }
      : {}),
    locatedUri: formatLocatedWikiGraphUri(archivePath, parsed.objectUri),
  };
}

export async function resolveArchiveCommandRuntimeArguments(
  args: CLIArchiveArguments,
): Promise<CLIArchiveArguments> {
  if (
    args.action === "create" ||
    args.action === "export" ||
    args.action === "inspect" ||
    args.action === "next"
  ) {
    return args;
  }
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

  return requireLocatedObjectOrArchiveUri(uri).archivePath;
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

  const parsed = requireLocatedObjectOrArchiveUri(uri);

  return parsed.objectUri ?? "wikg://";
}

export function isArchiveRootGet(args: CLIArchiveArguments): boolean {
  return (
    args.objectId !== undefined &&
    requireLocatedObjectOrArchiveUri(args.objectId).objectUri === undefined
  );
}

export function parseChapterScope(uri: string): number | undefined {
  const match = /^wikg:\/\/chapter\/([1-9][0-9]*)(?:\/|$)/u.exec(uri);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

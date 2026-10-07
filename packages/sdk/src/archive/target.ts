import { realpath, stat } from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";

import {
  formatLocatedWikiGraphUri,
  formatWikiGraphLibraryUri,
  listWikiGraphLibraries,
  listWikiGraphLibraryArchives,
  parseLocatedWikiGraphUri,
  parseWikiGraphLibraryUri,
  resolveWikiGraphLibrary,
  resolveWikiGraphLibraryArchiveFile,
  type ParsedWikiGraphLibraryUri,
  type QueryIndexScope,
  type File,
} from "wiki-graph-core";

import { getNodeResourcePath, NodeFile } from "../node-platform.js";
import { resolveWikiGraphRuntimePath } from "../runtime-path.js";

export type WikiGraphArchiveTarget =
  | {
      readonly kind: "standalone";
      readonly objectUri?: string;
      readonly path: string;
    }
  | {
      readonly kind: "library";
      readonly uri: string;
    };

export interface WikiGraphArchiveLocation {
  readonly archiveFile: File;
  readonly archiveKey: string;
  /** Logical archive locator. Never contains a managed archive's physical path. */
  readonly archivePath: string;
  readonly indexScope: QueryIndexScope;
  readonly libraryArchiveTarget?: ParsedWikiGraphLibraryUri;
  readonly libraryDirtyTarget?: ParsedWikiGraphLibraryUri;
  readonly locatedUri: string;
  readonly publicArchiveUri?: string;
  readonly target: WikiGraphArchiveTarget;
}

export class WikiGraphArchiveOwnershipError extends Error {
  public readonly code = "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH";

  public constructor(message: string) {
    super(message);
    this.name = "WikiGraphArchiveOwnershipError";
  }
}

export async function resolveWikiGraphArchiveLocation(
  target: WikiGraphArchiveTarget,
): Promise<WikiGraphArchiveLocation> {
  if (target.kind === "standalone") {
    return await resolveStandaloneLocation(target);
  }
  return await resolveLibraryLocation(target);
}

export async function assertStandaloneWikiGraphArchivePath(
  inputPath: string,
): Promise<string> {
  const path = resolveWikiGraphRuntimePath(inputPath);
  const candidate = await canonicalPath(path);
  const candidateIdentity = await readFileIdentity(path);
  for (const library of await listWikiGraphLibraries()) {
    const rootPath = getNodeResourcePath(library.folder);
    const root = await canonicalPath(rootPath);
    const archives = await listWikiGraphLibraryArchives({
      isDefault: library.isDefault,
      kind: "scope",
      ...(library.isDefault ? {} : { publicId: library.publicId }),
    });
    const member = await findMatchingMember(
      archives,
      candidate,
      candidateIdentity,
    );
    if (member === undefined && !isWithin(root, candidate)) continue;
    const hint =
      member === undefined
        ? "Scan the library, then address the archive by its library UUID URI."
        : `Use the library UUID URI ${member.uri} instead.`;
    throw new WikiGraphArchiveOwnershipError(
      `Standalone archive path belongs to registered library ${formatWikiGraphLibraryUri(
        library.isDefault ? undefined : library.publicId,
      )}: ${path}. ${hint}`,
    );
  }
  return path;
}

export function archiveTargetFromLogicalLocator(
  locator: string,
  objectUri?: string,
): WikiGraphArchiveTarget {
  if (locator.startsWith("wikg://lib/")) {
    return { kind: "library", uri: withObjectUri(locator, objectUri) };
  }
  return {
    kind: "standalone",
    path: locator,
    ...(objectUri === undefined ? {} : { objectUri }),
  };
}

export async function resolveWikiGraphArchiveTarget(
  file: File,
): Promise<WikiGraphArchiveTarget> {
  const path = getNodeResourcePath(file);
  const candidate = await canonicalPath(path);
  const candidateIdentity = await readFileIdentity(path);
  for (const library of await listWikiGraphLibraries()) {
    const archives = await listWikiGraphLibraryArchives({
      isDefault: library.isDefault,
      kind: "scope",
      ...(library.isDefault ? {} : { publicId: library.publicId }),
    });
    const member = await findMatchingMember(
      archives,
      candidate,
      candidateIdentity,
    );
    if (member !== undefined) return { kind: "library", uri: member.uri };
  }
  return { kind: "standalone", path: getNodeResourcePath(file) };
}

async function resolveStandaloneLocation(
  target: Extract<WikiGraphArchiveTarget, { readonly kind: "standalone" }>,
): Promise<WikiGraphArchiveLocation> {
  if (target.path.startsWith("wikg://lib/")) {
    throw new WikiGraphArchiveOwnershipError(
      `A library archive URI cannot be used as a standalone path: ${target.path}`,
    );
  }
  const path = await assertStandaloneWikiGraphArchivePath(target.path);
  const normalized: WikiGraphArchiveTarget = {
    kind: "standalone",
    path,
    ...(target.objectUri === undefined ? {} : { objectUri: target.objectUri }),
  };
  return {
    archiveFile: new NodeFile(path),
    archiveKey: path,
    archivePath: path,
    indexScope: { archiveKey: path, archivePath: path, kind: "archive-index" },
    locatedUri: formatLocatedWikiGraphUri(path, target.objectUri),
    target: normalized,
  };
}

async function resolveLibraryLocation(
  target: Extract<WikiGraphArchiveTarget, { readonly kind: "library" }>,
): Promise<WikiGraphArchiveLocation> {
  const parsedLocated = parseLocatedWikiGraphUri(target.uri);
  const archiveUri = parsedLocated.archivePath ?? target.uri;
  const parsed = parseWikiGraphLibraryUri(archiveUri);
  if (parsed?.kind !== "archive") {
    throw new WikiGraphArchiveOwnershipError(
      `Library archive target must be a UUID archive URI: ${target.uri}`,
    );
  }
  // Resolving the library first distinguishes a missing membership database
  // from an ordinary file path and prevents path fallback.
  await resolveWikiGraphLibrary(parsed);
  const archiveFile = await resolveWikiGraphLibraryArchiveFile(archiveUri);
  const normalized: WikiGraphArchiveTarget = {
    kind: "library",
    uri: target.uri,
  };
  return {
    archiveFile,
    archiveKey: archiveUri,
    archivePath: archiveUri,
    indexScope: {
      archiveKey: archiveUri,
      archivePath: archiveUri,
      kind: "archive-index",
    },
    libraryArchiveTarget: parsed,
    libraryDirtyTarget: {
      isDefault: parsed.isDefault,
      kind: "scope",
      ...(parsed.publicId === undefined ? {} : { publicId: parsed.publicId }),
    },
    locatedUri: target.uri,
    publicArchiveUri: archiveUri,
    target: normalized,
  };
}

function withObjectUri(archiveLocator: string, objectUri?: string): string {
  if (objectUri === undefined) return archiveLocator;
  const path = objectUri.replace(/^wikg:\/\//u, "");
  return `${archiveLocator.replace(/\/$/u, "")}/${path}`;
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const absolute = resolve(path);
    const parent = dirname(absolute);
    return parent === absolute
      ? absolute
      : join(await canonicalPath(parent), basename(absolute));
  }
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

async function findMatchingMember(
  archives: Awaited<ReturnType<typeof listWikiGraphLibraryArchives>>,
  candidate: string,
  candidateIdentity?: string,
) {
  for (const archive of archives) {
    if (archive.file === undefined) continue;
    const memberPath = getNodeResourcePath(archive.file);
    if (
      (await canonicalPath(memberPath)) === candidate ||
      (candidateIdentity !== undefined &&
        (await readFileIdentity(memberPath)) === candidateIdentity)
    ) {
      return archive;
    }
  }
  return undefined;
}

async function readFileIdentity(path: string): Promise<string | undefined> {
  try {
    const value = await stat(path);
    return `${value.dev}:${value.ino}`;
  } catch {
    return undefined;
  }
}

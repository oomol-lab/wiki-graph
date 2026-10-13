import { realpath, stat } from "fs/promises";
import { basename, dirname, join, resolve } from "path";

import {
  formatLocatedWikiGraphUri,
  formatWikiGraphLibraryUri,
  findWikiGraphLibraryByPhysicalIdentity,
  type listWikiGraphLibraryArchives,
  findWikiGraphLibraryArchivePhysicalAliases,
  parseLocatedWikiGraphUri,
  parseWikiGraphLibraryUri,
  resolveWikiGraphLibrary,
  resolveWikiGraphLibraryArchiveFile,
  isWikiGraphSchemaVersionError,
  WikiGraphSchemaVersionError,
  type ParsedWikiGraphLibraryUri,
  type QueryIndexScope,
  type File,
  type Directory,
} from "wiki-graph-core";

import {
  getNodeResourcePath,
  NodeFile,
  NodeDirectory,
} from "../node-platform.js";
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
  readonly archiveFile: File | Directory;
  readonly archiveKey: string;
  /** Logical archive locator. Never contains a managed archive's physical path. */
  readonly archivePath: string;
  readonly indexScope: QueryIndexScope;
  readonly libraryArchiveTarget?: ParsedWikiGraphLibraryUri;
  readonly locatedUri: string;
  readonly publicArchiveUri?: string;
  readonly target: WikiGraphArchiveTarget;
}

export function rethrowArchiveSchemaError(
  error: unknown,
  target: WikiGraphArchiveTarget,
): never {
  if (isWikiGraphSchemaVersionError(error) && error.target.kind === "archive") {
    throw new WikiGraphSchemaVersionError(
      target.kind === "standalone"
        ? { kind: "archive", path: resolveWikiGraphRuntimePath(target.path) }
        : { kind: "library", uri: target.uri.split("/arc/")[0]! },
      error.actualVersion,
      error.supportedVersion,
    );
  }
  throw error;
}

export function requireWikiGraphArchiveFile(
  location: WikiGraphArchiveLocation,
): File | Directory {
  return location.archiveFile;
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
  const matches = await findMatchingMembers(candidate, candidateIdentity);
  if (matches.length > 0) {
    const match = requireUnambiguousManagedMatch(path, matches);
    throw new WikiGraphArchiveOwnershipError(
      `Standalone archive path belongs to registered library ${formatWikiGraphLibraryUri(
        match.library.isDefault ? undefined : match.library.publicId,
      )}: ${path}. Use the library UUID URI ${match.archive.uri} instead.`,
    );
  }
  const ancestors = new Set<string>();
  for (const start of [candidate, resolve(path)]) {
    for (let parent = dirname(start); ; parent = dirname(parent)) {
      ancestors.add(parent);
      if (dirname(parent) === parent) break;
    }
  }
  for (const parent of ancestors) {
    const identity = await readFileIdentity(parent);
    const library = await findWikiGraphLibraryByPhysicalIdentity(
      identity,
      new NodeDirectory(parent).identity,
    );
    if (library !== undefined) {
      throw new WikiGraphArchiveOwnershipError(
        `Standalone archive path belongs to registered library ${formatWikiGraphLibraryUri(
          library.isDefault ? undefined : library.publicId,
        )}: ${path}. Scan the library, then address the archive by its library UUID URI.`,
      );
    }
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
  file: File | Directory,
): Promise<WikiGraphArchiveTarget> {
  const path = getNodeResourcePath(file);
  const candidate = await canonicalPath(path);
  const candidateIdentity = await readFileIdentity(path);
  const matches = await findMatchingMembers(candidate, candidateIdentity);
  if (matches.length > 0) {
    const match = requireUnambiguousManagedMatch(path, matches);
    return { kind: "library", uri: match.archive.uri };
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
  } catch (error) {
    if (
      !(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
    )
      throw error;
    const absolute = resolve(path);
    const parent = dirname(absolute);
    return parent === absolute
      ? absolute
      : join(await canonicalPath(parent), basename(absolute));
  }
}

type ListedLibrary = Awaited<ReturnType<typeof resolveWikiGraphLibrary>>;
type ListedArchive = Awaited<
  ReturnType<typeof listWikiGraphLibraryArchives>
>[number];

interface ManagedArchiveMatch {
  readonly archive: ListedArchive;
  readonly library: ListedLibrary;
  readonly memberPath: string;
}

async function findMatchingMembers(
  candidate: string,
  candidateIdentity?: string,
): Promise<readonly ManagedArchiveMatch[]> {
  if (candidateIdentity === undefined) return [];
  const archives =
    await findWikiGraphLibraryArchivePhysicalAliases(candidateIdentity);
  const members: ManagedArchiveMatch[] = [];
  for (const archive of archives) {
    const parsed = parseWikiGraphLibraryUri(archive.libraryUri)!;
    const library = await resolveWikiGraphLibrary(parsed);
    const physical = archive.file ?? archive.directory;
    if (library !== undefined && physical !== undefined)
      members.push({
        archive,
        library,
        memberPath: getNodeResourcePath(physical),
      });
  }
  const exact: ManagedArchiveMatch[] = [];
  for (const member of members) {
    if ((await canonicalPath(member.memberPath)) === candidate)
      exact.push(member);
  }
  return exact.length > 0 ? exact : members;
}

function requireUnambiguousManagedMatch(
  path: string,
  matches: readonly ManagedArchiveMatch[],
): ManagedArchiveMatch {
  if (matches.length === 1) return matches[0]!;
  throw new WikiGraphArchiveOwnershipError(
    `Archive file identity is ambiguous across managed archives: ${path}. Use an explicit library UUID URI (${matches
      .map((match) => match.archive.uri)
      .join(", ")}).`,
  );
}

async function readFileIdentity(path: string): Promise<string | undefined> {
  try {
    const value = await stat(path);
    return `${value.dev}:${value.ino}`;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return undefined;
    throw error;
  }
}

import { requireLocatedObjectOrArchiveUri } from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../../args.js";

export function getArchivePath(uri: string): string {
  return requireLocatedObjectOrArchiveUri(uri).archivePath;
}

export function getObjectUri(uri: string): string {
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

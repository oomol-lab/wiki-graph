import {
  LEGACY_SEARCH_INDEX_DATABASE_PATH,
  SEARCH_INDEX_DATABASE_PATH,
  WIKG_ARCHIVE_PATTERNS,
  WIKG_MUTATION_TOKEN_PATH,
} from "./constants.js";

export function normalizeArchivePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").trim();
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error(
      `Path must remain relative to its host-provided root: ${path}`,
    );
  }
  const withoutLeadingSlash = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;

  const result = withoutLeadingSlash
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
  assertSafeRelativePath(result);
  return result;
}

/** Reject archive/workspace names that could escape their injected root. */
export function assertSafeRelativePath(path: string): void {
  if (path.startsWith("/") || path.split("/").some((part) => part === "..")) {
    throw new Error(
      `Path must remain relative to its host-provided root: ${path}`,
    );
  }
}

export function isWikgArchivePath(archivePath: string): boolean {
  return WIKG_ARCHIVE_PATTERNS.some((pattern) => pattern.test(archivePath));
}

/** Reads legacy embedded search caches without making writers preserve them. */
export function isReadableWikgArchivePath(archivePath: string): boolean {
  return (
    isWikgArchivePath(archivePath) ||
    archivePath === SEARCH_INDEX_DATABASE_PATH ||
    archivePath === LEGACY_SEARCH_INDEX_DATABASE_PATH
  );
}

export function sortArchiveEntriesForWrite<
  T extends { readonly archivePath: string },
>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) =>
    compareArchiveEntryPathsForWrite(left.archivePath, right.archivePath),
  );
}

export function sortArchiveEntryPathsForWrite(
  paths: Iterable<string>,
): string[] {
  return [...paths].sort(compareArchiveEntryPathsForWrite);
}

function compareArchiveEntryPathsForWrite(left: string, right: string): number {
  if (left === WIKG_MUTATION_TOKEN_PATH) {
    return right === WIKG_MUTATION_TOKEN_PATH ? 0 : -1;
  }
  if (right === WIKG_MUTATION_TOKEN_PATH) {
    return 1;
  }

  return left.localeCompare(right);
}

export function isMissingSearchIndexError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Archive SQLite entry is missing: index.db") ||
      error.message.includes("Archive SQLite entry is missing: fts.db") ||
      error.message.includes("Search index cache is missing: index.db"))
  );
}

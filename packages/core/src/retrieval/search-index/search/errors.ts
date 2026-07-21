export function isMissingSearchIndexError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;

  return (
    code === "SQLITE_CANTOPEN" ||
    (error instanceof Error &&
      (error.message.includes("Archive SQLite entry is missing: fts.db") ||
        error.message.includes("no such table: search_index_state")))
  );
}

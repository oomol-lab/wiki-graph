export function createPageCursorObject(nextCursor: string | null): {
  readonly nextCursor: string | null;
  readonly type: "page";
} {
  return {
    nextCursor,
    type: "page",
  };
}

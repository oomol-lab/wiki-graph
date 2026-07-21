import type {
  BucketSearchCursor,
  SearchChapterTitleCursorKey,
  SearchChunkCursorKey,
  SearchObjectCursorKey,
  SearchTextCursorKey,
} from "./types.js";

export function encodeSearchSessionCursor(
  sessionId: string,
  offset: number,
  createdAt: number,
): string {
  return Buffer.from(
    JSON.stringify({ createdAt, offset, sessionId, v: 3 }),
  ).toString("base64url");
}

export function encodeBucketSearchSessionCursor(
  sessionId: string,
  cursor: BucketSearchCursor,
  createdAt: number,
): string {
  return Buffer.from(
    JSON.stringify({ createdAt, cursor, sessionId, v: 4 }),
  ).toString("base64url");
}

export function decodeBucketSearchSessionCursor(cursor: string): {
  readonly createdAt: number;
  readonly cursor: BucketSearchCursor;
  readonly sessionId: string;
} {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "createdAt" in parsed &&
      "cursor" in parsed &&
      "sessionId" in parsed &&
      "v" in parsed &&
      parsed.v === 4 &&
      typeof parsed.createdAt === "number" &&
      Number.isInteger(parsed.createdAt) &&
      parsed.createdAt >= 0 &&
      typeof parsed.sessionId === "string" &&
      parsed.sessionId !== "" &&
      isBucketSearchCursor(parsed.cursor)
    ) {
      return {
        createdAt: parsed.createdAt,
        cursor: parsed.cursor,
        sessionId: parsed.sessionId,
      };
    }
  } catch {
    throw new Error("Invalid search cursor.");
  }

  throw new Error("Invalid search cursor.");
}

export function decodeSearchSessionCursor(cursor: string): {
  readonly createdAt?: number;
  readonly offset: number;
  readonly sessionId: string;
} {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "offset" in parsed &&
      "sessionId" in parsed &&
      "createdAt" in parsed &&
      "v" in parsed &&
      parsed.v === 3 &&
      typeof parsed.sessionId === "string" &&
      parsed.sessionId !== "" &&
      typeof parsed.createdAt === "number" &&
      Number.isInteger(parsed.createdAt) &&
      parsed.createdAt >= 0 &&
      typeof parsed.offset === "number" &&
      Number.isInteger(parsed.offset) &&
      parsed.offset >= 0
    ) {
      return {
        createdAt: parsed.createdAt,
        offset: parsed.offset,
        sessionId: parsed.sessionId,
      };
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "offset" in parsed &&
      "sessionId" in parsed &&
      "v" in parsed &&
      parsed.v === 2 &&
      typeof parsed.sessionId === "string" &&
      parsed.sessionId !== "" &&
      typeof parsed.offset === "number" &&
      Number.isInteger(parsed.offset) &&
      parsed.offset >= 0
    ) {
      return { offset: parsed.offset, sessionId: parsed.sessionId };
    }
  } catch {
    throw new Error("Invalid search cursor.");
  }

  throw new Error("Invalid search cursor.");
}

function isBucketSearchCursor(value: unknown): value is BucketSearchCursor {
  if (typeof value !== "object" || value === null || !("bucket" in value)) {
    return false;
  }
  const cursor = value as { readonly bucket: unknown; readonly key?: unknown };

  switch (cursor.bucket) {
    case 0:
      return cursor.key === undefined || isChapterTitleCursorKey(cursor.key);
    case 1:
      return cursor.key === undefined || isObjectCursorKey(cursor.key);
    case 2:
      return cursor.key === undefined || isChunkCursorKey(cursor.key);
    case 3:
      return cursor.key === undefined || isTextCursorKey(cursor.key);
    default:
      return false;
  }
}

function isChapterTitleCursorKey(
  value: unknown,
): value is SearchChapterTitleCursorKey {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SearchChapterTitleCursorKey).chapterId === "number" &&
    typeof (value as SearchChapterTitleCursorKey).score === "number"
  );
}

function isObjectCursorKey(value: unknown): value is SearchObjectCursorKey {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SearchObjectCursorKey).id === "string" &&
    ((value as SearchObjectCursorKey).kind === "entity" ||
      (value as SearchObjectCursorKey).kind === "triple") &&
    typeof (value as SearchObjectCursorKey).score === "number"
  );
}

function isChunkCursorKey(value: unknown): value is SearchChunkCursorKey {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SearchChunkCursorKey).chunkId === "number" &&
    typeof (value as SearchChunkCursorKey).score === "number"
  );
}

function isTextCursorKey(value: unknown): value is SearchTextCursorKey {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SearchTextCursorKey).chapterId === "number" &&
    typeof (value as SearchTextCursorKey).kind === "number" &&
    typeof (value as SearchTextCursorKey).rank === "number" &&
    typeof (value as SearchTextCursorKey).sentenceIndex === "number"
  );
}

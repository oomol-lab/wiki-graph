import { describe, expect, it } from "vitest";

import {
  createCursorPayload,
  parseContinuationCursorRecord,
} from "./payload.js";
import type { ContinuationCursor } from "./types.js";

const archiveCursor: ContinuationCursor = {
  archiveKey: "archive-key",
  archivePath: "/tmp/book.wikg",
  chapters: [1],
  cursor: "raw-cursor",
  format: "json",
  ids: null,
  indexScope: {
    archiveKey: "archive-key",
    archivePath: "/tmp/book.wikg",
    kind: "archive-index",
  },
  kind: "collection",
  order: "doc-asc",
  types: ["entity"],
};

describe("continuation cursor payload", () => {
  it("round-trips archive index scope", () => {
    const payloadJSON = JSON.stringify(createCursorPayload(archiveCursor));

    expect(
      parseContinuationCursorRecord({
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        format: "json",
        kind: "collection",
        payloadJSON,
      }),
    ).toStrictEqual(archiveCursor);
  });

  it("falls back to record archive scope for legacy payloads", () => {
    const payload = createCursorPayload(archiveCursor) as Record<
      string,
      unknown
    >;
    delete payload.indexScope;

    expect(
      parseContinuationCursorRecord({
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        format: "json",
        kind: "collection",
        payloadJSON: JSON.stringify(payload),
      }),
    ).toMatchObject({
      indexScope: {
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
    });
  });

  it("parses library index scope", () => {
    const payloadJSON = JSON.stringify({
      cursor: "raw-cursor",
      indexScope: { kind: "library-index", libraryId: 42 },
      order: "doc-asc",
      targetUri: "wikg://entity/Q1",
    });

    expect(
      parseContinuationCursorRecord({
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        format: "json",
        kind: "evidence",
        payloadJSON,
      }),
    ).toMatchObject({
      indexScope: { kind: "library-index", libraryId: 42 },
    });
  });

  it("round-trips the typed library query variant", () => {
    const cursor: ContinuationCursor = {
      archiveKey: "wikg://lib",
      archivePath: "wikg://lib",
      chapters: null,
      cursor: "raw-cursor",
      format: "json",
      ids: null,
      indexScope: { kind: "library-index", libraryId: 42 },
      kind: "collection",
      libraryQuery: "archive-members",
      order: "doc-asc",
      types: null,
    };

    expect(roundTripCursor(cursor)).toStrictEqual(cursor);
  });

  it("round-trips skip-unindexed search cursors", () => {
    const cursor: ContinuationCursor = {
      archiveKey: "archive-key",
      archivePath: "/tmp/book.wikg",
      backlinks: false,
      chapters: [1],
      cursor: "raw-cursor",
      format: "json",
      indexScope: {
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
      kind: "search",
      query: "alpha",
      queryMode: "embedding",
      skipUnindexed: true,
      types: null,
    };

    expect(roundTripCursor(cursor)).toStrictEqual(cursor);
  });

  it("round-trips skip-unindexed evidence cursors", () => {
    const cursor: ContinuationCursor = {
      archiveKey: "archive-key",
      archivePath: "/tmp/book.wikg",
      chapters: [1, 2],
      cursor: "raw-cursor",
      format: "jsonl",
      indexScope: {
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
      kind: "evidence",
      order: "doc-asc",
      query: "alpha",
      queryMode: "fts",
      skipUnindexed: true,
      targetUri: "wikg://source/1/0",
    };

    expect(roundTripCursor(cursor)).toStrictEqual(cursor);
  });

  it("round-trips skip-unindexed related cursors", () => {
    const cursor: ContinuationCursor = {
      archiveKey: "archive-key",
      archivePath: "/tmp/book.wikg",
      chapters: [1, 2],
      cursor: "raw-cursor",
      format: "text",
      indexScope: {
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
      kind: "related",
      order: "doc-desc",
      query: "alpha",
      queryMode: "hybrid",
      role: "subject",
      skipUnindexed: true,
      targetUri: "wikg://entity/Q1",
    };

    expect(roundTripCursor(cursor)).toStrictEqual(cursor);
  });

  it("round-trips source locator cursors", () => {
    const cursor: ContinuationCursor = {
      archiveKey: "archive-key",
      archivePath: "/tmp/book.wikg",
      cursor: "raw-locator-cursor",
      format: "jsonl",
      indexScope: {
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
      kind: "source-locators",
      targetUri: "wikg://chapter/chapter-key/source/locators#2..4",
    };

    expect(roundTripCursor(cursor)).toStrictEqual(cursor);
  });

  it("rejects malformed and mismatched archive index scopes", () => {
    expect(() =>
      parseContinuationCursorRecord({
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        format: "json",
        kind: "evidence",
        payloadJSON: JSON.stringify({
          cursor: "raw-cursor",
          indexScope: {
            archiveKey: "other-key",
            archivePath: "/tmp/book.wikg",
            kind: "archive-index",
          },
          order: "doc-asc",
          targetUri: "wikg://entity/Q1",
        }),
      }),
    ).toThrow("Invalid continuation cursor payload");

    expect(() =>
      parseContinuationCursorRecord({
        archiveKey: "archive-key",
        archivePath: "/tmp/book.wikg",
        format: "json",
        kind: "evidence",
        payloadJSON: JSON.stringify({
          cursor: "raw-cursor",
          indexScope: { kind: "library-index", libraryId: "42" },
          order: "doc-asc",
          targetUri: "wikg://entity/Q1",
        }),
      }),
    ).toThrow("Invalid continuation cursor payload");
  });
});

function roundTripCursor(cursor: ContinuationCursor): ContinuationCursor {
  return parseContinuationCursorRecord({
    archiveKey: cursor.archiveKey,
    archivePath: cursor.archivePath,
    format: cursor.format,
    kind: cursor.kind,
    payloadJSON: JSON.stringify(createCursorPayload(cursor)),
  });
}

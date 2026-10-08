import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as WikiGraphCore from "wiki-graph-core";
import type { ContinuationCursor } from "wiki-graph-core";
import type * as WikiGraphEmbedding from "./embedding.js";
import {
  WikiGraphContinuationManager,
  type WikiGraphContinuationPage,
} from "./continuations.js";

const mocks = vi.hoisted(() => ({
  createCursor: vi.fn(),
  findArchiveMembers: vi.fn(),
  findObjects: vi.fn(),
  listArchiveMembers: vi.fn(),
  listObjects: vi.fn(),
  readCursor: vi.fn(),
}));

vi.mock("wiki-graph-core", async (importOriginal) => {
  const actual = await importOriginal<typeof WikiGraphCore>();
  return {
    ...actual,
    createContinuationCursor: mocks.createCursor,
    findWikiGraphLibraryArchiveMembers: mocks.findArchiveMembers,
    findWikiGraphLibraryObjects: mocks.findObjects,
    listWikiGraphLibraryArchiveMembers: mocks.listArchiveMembers,
    listWikiGraphLibraryObjects: mocks.listObjects,
    readContinuationCursor: mocks.readCursor,
    resolveWikiGraphLibraryQueryTargetById: vi.fn(() =>
      Promise.resolve({ isDefault: true, kind: "scope" }),
    ),
  };
});

vi.mock("./embedding.js", async (importOriginal) => {
  const actual = await importOriginal<typeof WikiGraphEmbedding>();
  return {
    ...actual,
    readWikiGraphEmbeddingConfig: vi.fn(() => Promise.resolve({})),
  };
});

const runtime = {
  run: async <T>(operation: () => Promise<T> | T): Promise<T> =>
    await operation(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createCursor.mockResolvedValue("c_durable_next");
  mocks.listObjects.mockResolvedValue(createCollectionResult("objects"));
  mocks.listArchiveMembers.mockResolvedValue(
    createCollectionResult("archive-members"),
  );
  mocks.findObjects.mockResolvedValue(createFindResult("objects"));
  mocks.findArchiveMembers.mockResolvedValue(
    createFindResult("archive-members"),
  );
});

describe("WikiGraphContinuationManager library dispatch", () => {
  it("rejects library cursors without an explicit query variant", async () => {
    const cursor = createLibraryCursor("collection", "objects");
    if (cursor.kind !== "collection") throw new Error("Expected collection.");
    const { libraryQuery: _libraryQuery, ...ambiguous } = cursor;
    mocks.readCursor.mockResolvedValue(ambiguous);

    await expect(
      new WikiGraphContinuationManager(runtime).next({ cursor: "c_current" }),
    ).rejects.toThrow("missing its typed query variant");
    expect(mocks.listObjects).not.toHaveBeenCalled();
    expect(mocks.listArchiveMembers).not.toHaveBeenCalled();
  });

  it.each(["objects", "archive-members"] as const)(
    "persists and dispatches collection variant %s",
    async (libraryQuery) => {
      const cursor = createLibraryCursor("collection", libraryQuery);
      mocks.readCursor
        .mockResolvedValueOnce(cursor)
        .mockResolvedValueOnce({ ...cursor, cursor: "raw-next" });
      const query =
        libraryQuery === "objects"
          ? mocks.listObjects
          : mocks.listArchiveMembers;
      query
        .mockResolvedValueOnce(createCollectionResult(libraryQuery))
        .mockResolvedValueOnce(createCollectionResult(libraryQuery, null));

      const manager = new WikiGraphContinuationManager(runtime);
      const page = await manager.next({
        cursor: "c_current",
      });
      const finalPage = await manager.next({
        cursor: page.result.nextCursor!,
      });

      expect(readOnlyItemId(page)).toBe(libraryQuery);
      expect(page.result.nextCursor).toBe("c_durable_next");
      expect(readOnlyItemId(finalPage)).toBe(libraryQuery);
      expect(finalPage.result.nextCursor).toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
      expect(mocks.createCursor).toHaveBeenCalledWith(
        expect.objectContaining({ libraryQuery }),
      );
    },
  );

  it.each(["objects", "archive-members"] as const)(
    "persists and dispatches search variant %s",
    async (libraryQuery) => {
      const cursor = createLibraryCursor("search", libraryQuery);
      mocks.readCursor
        .mockResolvedValueOnce(cursor)
        .mockResolvedValueOnce({ ...cursor, cursor: "raw-next" });
      const query =
        libraryQuery === "objects"
          ? mocks.findObjects
          : mocks.findArchiveMembers;
      query
        .mockResolvedValueOnce(createFindResult(libraryQuery))
        .mockResolvedValueOnce(createFindResult(libraryQuery, null));

      const manager = new WikiGraphContinuationManager(runtime);
      const page = await manager.next({
        cursor: "c_current",
      });
      const finalPage = await manager.next({
        cursor: page.result.nextCursor!,
      });

      expect(readOnlyItemId(page)).toBe(libraryQuery);
      expect(page.result.nextCursor).toBe("c_durable_next");
      expect(readOnlyItemId(finalPage)).toBe(libraryQuery);
      expect(finalPage.result.nextCursor).toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenCalledWith(
        expect.anything(),
        "book",
        expect.objectContaining({ queryMode: "fts" }),
      );
      expect(mocks.createCursor).toHaveBeenCalledWith(
        expect.objectContaining({ libraryQuery, queryMode: "fts" }),
      );
    },
  );
});

function createLibraryCursor(
  kind: "collection" | "search",
  libraryQuery: "archive-members" | "objects",
): ContinuationCursor {
  const base = {
    archiveKey: "library-query-key",
    archivePath: "wikg://lib",
    cursor: "raw-current",
    format: "json" as const,
    indexScope: { kind: "library-index" as const, libraryId: 42 },
    libraryQuery,
    types: null,
  };
  return kind === "collection"
    ? {
        ...base,
        chapters: null,
        ids: null,
        kind,
        order: "doc-asc",
      }
    : { ...base, kind, query: "book", queryMode: "fts" };
}

function createCollectionResult(
  id: string,
  nextCursor: string | null = "raw-next",
) {
  return {
    chapters: null,
    ids: null,
    items: [{ id }],
    limit: 1,
    nextCursor,
    order: "doc-asc",
    types: null,
  };
}

function createFindResult(id: string, nextCursor: string | null = "raw-next") {
  return {
    chapters: null,
    items: [{ id }],
    lens: "typed",
    lensHint: null,
    limit: 1,
    match: "any",
    nextCursor,
    order: "doc-asc",
    query: "book",
    terms: ["book"],
    types: null,
  };
}

function readOnlyItemId(page: WikiGraphContinuationPage): string | undefined {
  return page.kind === "source-locators" || page.kind === "evidence"
    ? undefined
    : page.result.items[0]?.id;
}

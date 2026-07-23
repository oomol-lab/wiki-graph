import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listWikiGraphLibraryObjects,
  readContinuationCursor,
  resolveWikiGraphLibraryQueryTargetById,
} from "wiki-graph-core";
import { writeFindHits } from "../../archive-output/index.js";
import { runNextArchivePage } from "./next.js";

vi.mock("wiki-graph-core", () => ({
  findArchiveObjects: vi.fn(),
  findWikiGraphLibraryObjects: vi.fn(),
  listArchiveCollection: vi.fn(),
  listArchiveEvidence: vi.fn(),
  listRelatedArchiveObjects: vi.fn(),
  listRelatedWikiGraphLibraryObjects: vi.fn(),
  listWikiGraphLibraryEvidence: vi.fn(),
  listWikiGraphLibraryObjects: vi.fn(),
  readContinuationCursor: vi.fn(),
  resolveWikiGraphLibraryQueryTargetById: vi.fn(),
}));

vi.mock("../../archive-output/index.js", () => ({
  writeEvidence: vi.fn(),
  writeFindHits: vi.fn(),
  writeList: vi.fn(),
}));

vi.mock("./document.js", () => ({
  readArchiveDocument: vi.fn(),
}));

const libraryTarget = { isDefault: true, kind: "scope" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readContinuationCursor).mockResolvedValue({
    archiveKey: "wikg://lib",
    archivePath: "wikg://lib",
    chapters: null,
    cursor: "raw-collection-cursor",
    format: "json",
    ids: null,
    indexScope: { kind: "library-index", libraryId: 42 },
    kind: "collection",
    order: "doc-asc",
    types: ["entity"],
  });
  vi.mocked(resolveWikiGraphLibraryQueryTargetById).mockResolvedValue(
    libraryTarget,
  );
});

describe("runNextArchivePage library cursors", () => {
  it("re-enters the library index path for collection cursors", async () => {
    vi.mocked(listWikiGraphLibraryObjects).mockResolvedValue({
      chapters: null,
      ids: null,
      items: [
        {
          archiveId: 7,
          field: "title",
          id: "wikg://entity/Q7",
          libraryArchiveUri: "wikg://lib/archive-7",
          snippet: "Entity 7",
          title: "Entity 7",
          type: "entity",
        },
      ],
      limit: 20,
      nextCursor: null,
      order: "doc-asc",
      types: ["entity"],
    });

    await runNextArchivePage({ action: "next", archivePath: "c_next" });

    expect(readContinuationCursor).toHaveBeenCalledWith("c_next");
    expect(resolveWikiGraphLibraryQueryTargetById).toHaveBeenCalledWith(42);
    expect(listWikiGraphLibraryObjects).toHaveBeenCalledWith(libraryTarget, {
      cursor: "raw-collection-cursor",
      limit: 20,
      order: "doc-asc",
      types: ["entity"],
    });
    expect(writeFindHits).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            archiveId: 7,
            libraryArchiveUri: "wikg://lib/archive-7",
          }),
        ],
      }),
      expect.objectContaining({
        indexScope: { kind: "library-index", libraryId: 42 },
      }),
      "json",
    );
  });

  it("surfaces dirty library index failures from next", async () => {
    vi.mocked(listWikiGraphLibraryObjects).mockRejectedValue(
      new Error("Wiki Graph library index is dirty."),
    );

    await expect(
      runNextArchivePage({ action: "next", archivePath: "c_next" }),
    ).rejects.toThrow("Wiki Graph library index is dirty.");
    expect(listWikiGraphLibraryObjects).toHaveBeenCalledWith(
      libraryTarget,
      expect.objectContaining({ cursor: "raw-collection-cursor" }),
    );
  });
});

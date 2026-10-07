import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as WikiGraphSDK from "wiki-graph-sdk";
import { writeFindHits } from "../../archive-output/index.js";
import { runNextArchivePage } from "./next.js";

const mocks = vi.hoisted(() => ({ next: vi.fn() }));

vi.mock("wiki-graph-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof WikiGraphSDK>();
  return {
    ...actual,
    createWikiGraphSDK: vi.fn(() => ({
      continuations: { next: mocks.next },
    })),
  };
});

vi.mock("../../archive-output/index.js", () => ({
  writeEvidence: vi.fn(),
  writeFindHits: vi.fn(),
  writeList: vi.fn(),
  writeSourceLocators: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.next.mockResolvedValue({
    cursor: {
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
    },
    format: "json",
    kind: "collection",
    limit: 20,
    result: {
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
    },
  });
});

describe("runNextArchivePage", () => {
  it("delegates cursor restoration and query dispatch to the SDK", async () => {
    await runNextArchivePage({ action: "next", archivePath: "c_next" });

    expect(mocks.next).toHaveBeenCalledWith({ cursor: "c_next" });
    expect(writeFindHits).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ id: "wikg://entity/Q7" })],
      }),
      expect.objectContaining({
        indexScope: { kind: "library-index", libraryId: 42 },
      }),
      "json",
    );
  });

  it("passes explicit archive verification and limit to the SDK", async () => {
    await runNextArchivePage({
      action: "next",
      archivePath: "/tmp/book.wikg",
      cursor: "c_next",
      limit: 7,
    });

    expect(mocks.next).toHaveBeenCalledWith({
      archive: { kind: "standalone", path: "/tmp/book.wikg" },
      cursor: "c_next",
      limit: 7,
    });
  });

  it("surfaces SDK continuation failures", async () => {
    mocks.next.mockRejectedValue(
      new Error("Wiki Graph library index is dirty."),
    );

    await expect(
      runNextArchivePage({ action: "next", archivePath: "c_next" }),
    ).rejects.toThrow("Wiki Graph library index is dirty.");
  });
});

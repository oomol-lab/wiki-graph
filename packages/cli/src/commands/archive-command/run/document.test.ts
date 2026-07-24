import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markWikiGraphLibraryIndexDirty } from "wiki-graph-core";
import { writeArchiveDocument } from "./document.js";
import { resolveArchiveRuntimeLocation } from "./uri.js";

const mocks = vi.hoisted(() => ({
  writeArchive: vi.fn(),
}));

let restoreStderrWrite: (() => void) | undefined;

vi.mock("wiki-graph-core", () => ({
  finalizeWikiGraphLibraryArchiveWrite: vi.fn(() => Promise.resolve(false)),
  markWikiGraphLibraryIndexDirty: vi.fn(),
  WikiGraphArchiveFile: class {
    public readonly archivePath: string;

    public constructor(archivePath: string) {
      this.archivePath = archivePath;
    }

    public write = mocks.writeArchive;
  },
}));

vi.mock("./uri.js", () => ({
  resolveArchiveRuntimeLocation: vi.fn(),
}));

describe("writeArchiveDocument", () => {
  beforeEach(() => {
    vi.mocked(resolveArchiveRuntimeLocation).mockReset();
    vi.mocked(markWikiGraphLibraryIndexDirty).mockReset();
    mocks.writeArchive.mockReset();
  });

  afterEach(() => {
    restoreStderrWrite?.();
    restoreStderrWrite = undefined;
  });

  it("preserves a successful write result when dirty marking fails", async () => {
    const libraryDirtyTarget = { isDefault: true, kind: "scope" } as const;
    vi.mocked(resolveArchiveRuntimeLocation).mockResolvedValue({
      archiveKey: "/tmp/book.wikg",
      archivePath: "/tmp/book.wikg",
      indexScope: {
        archiveKey: "/tmp/book.wikg",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
      libraryDirtyTarget,
      locatedUri: "wikg:///tmp/book.wikg",
    });
    mocks.writeArchive.mockResolvedValue("written");
    vi.mocked(markWikiGraphLibraryIndexDirty).mockRejectedValue(
      new Error("sqlite is locked"),
    );
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as typeof process.stderr.write);
    restoreStderrWrite = () => {
      stderrWrite.mockRestore();
    };

    await expect(
      writeArchiveDocument("wikg://lib/book", () => undefined),
    ).resolves.toBe("written");
    expect(markWikiGraphLibraryIndexDirty).toHaveBeenCalledWith(
      libraryDirtyTarget,
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining("sqlite is locked"),
    );
  });
});

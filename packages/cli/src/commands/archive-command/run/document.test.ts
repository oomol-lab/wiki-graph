import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readWikiGraphLibraryIndexState,
  rebuildWikiGraphLibraryIndex,
} from "wiki-graph-sdk";
import { writeArchiveDocument } from "./document.js";
import { resolveArchiveRuntimeLocation } from "./uri.js";

const mocks = vi.hoisted(() => ({
  writeArchive: vi.fn(),
}));

let restoreStderrWrite: (() => void) | undefined;

vi.mock("wiki-graph-sdk", () => ({
  finalizeWikiGraphLibraryArchiveWrite: vi.fn(() => Promise.resolve(false)),
  readWikiGraphLibraryIndexState: vi.fn(() =>
    Promise.resolve({ status: "current" }),
  ),
  rebuildWikiGraphLibraryIndex: vi.fn(),
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
    vi.mocked(readWikiGraphLibraryIndexState).mockReset();
    vi.mocked(readWikiGraphLibraryIndexState).mockResolvedValue({
      status: "current",
    } as Awaited<ReturnType<typeof readWikiGraphLibraryIndexState>>);
    vi.mocked(rebuildWikiGraphLibraryIndex).mockReset();
    mocks.writeArchive.mockReset();
  });

  afterEach(() => {
    restoreStderrWrite?.();
    restoreStderrWrite = undefined;
  });

  it("preserves a successful write result when library index sync fails", async () => {
    const libraryDirtyTarget = { isDefault: true, kind: "scope" } as const;
    vi.mocked(resolveArchiveRuntimeLocation).mockResolvedValue({
      archiveFile: {} as never,
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
    vi.mocked(rebuildWikiGraphLibraryIndex).mockRejectedValue(
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
    expect(rebuildWikiGraphLibraryIndex).toHaveBeenCalledWith(
      libraryDirtyTarget,
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining("sqlite is locked"),
    );
  });

  it("does not sync a missing library index cache after archive writes", async () => {
    const libraryDirtyTarget = { isDefault: true, kind: "scope" } as const;
    vi.mocked(resolveArchiveRuntimeLocation).mockResolvedValue({
      archiveFile: {} as never,
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
    vi.mocked(readWikiGraphLibraryIndexState).mockResolvedValue({
      status: "missing",
    } as Awaited<ReturnType<typeof readWikiGraphLibraryIndexState>>);
    mocks.writeArchive.mockResolvedValue("written");

    await expect(
      writeArchiveDocument("wikg://lib/book", () => undefined),
    ).resolves.toBe("written");
    expect(readWikiGraphLibraryIndexState).toHaveBeenCalledWith(
      libraryDirtyTarget,
    );
    expect(rebuildWikiGraphLibraryIndex).not.toHaveBeenCalled();
  });
});

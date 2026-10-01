import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  writeDocument: vi.fn(),
}));

vi.mock("../../../runtime/context.js", () => ({
  getWikiGraphSDK: () => ({ archives: { open: mocks.open } }),
}));

import { writeArchiveDocument } from "./document.js";

describe("writeArchiveDocument", () => {
  afterEach(() => {
    mocks.open.mockReset();
    mocks.writeDocument.mockReset();
    vi.restoreAllMocks();
  });

  it("preserves a successful write result when library index sync fails", async () => {
    mocks.writeDocument.mockImplementation(
      (
        _operation: unknown,
        options: { onIndexSyncError(error: unknown): void },
      ) => {
        options.onIndexSyncError(new Error("sqlite is locked"));
        return Promise.resolve("written");
      },
    );
    mocks.open.mockResolvedValue({ writeDocument: mocks.writeDocument });
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as typeof process.stderr.write);

    await expect(
      writeArchiveDocument("wikg://lib/book", () => undefined),
    ).resolves.toBe("written");
    expect(mocks.open).toHaveBeenCalledWith("wikg://lib/book");
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining("sqlite is locked"),
    );
  });

  it("forwards successful writes without diagnostics", async () => {
    mocks.writeDocument.mockResolvedValue("written");
    mocks.open.mockResolvedValue({ writeDocument: mocks.writeDocument });
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as typeof process.stderr.write);

    await expect(
      writeArchiveDocument("book.wikg", () => undefined),
    ).resolves.toBe("written");
    expect(stderrWrite).not.toHaveBeenCalled();
  });
});

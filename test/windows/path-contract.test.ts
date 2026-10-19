import filesystem from "fs/promises";
import { syncBuiltinESMExports } from "module";
import { describe, expect, it, vi } from "vitest";
import { NodeFile } from "wiki-graph-sdk/node-platform";

it("observes the native filesystem boundary without opening a network share", async () => {
  const path = "\\\\?\\UNC\\server\\share\\book.wikg";
  const stat = vi
    .spyOn(filesystem, "stat")
    .mockRejectedValue(Object.assign(new Error("probe"), { code: "ENOENT" }));
  syncBuiltinESMExports();
  try {
    expect(await new NodeFile(path).getLastModified()).toBeUndefined();
    expect(stat).toHaveBeenCalledExactlyOnceWith(path);
  } finally {
    stat.mockRestore();
    syncBuiltinESMExports();
  }
});

// Contract probes only: these tests never connect to an SMB server.
describe.skipIf(process.platform !== "win32")(
  "Windows filesystem path contract (not SMB I/O)",
  () => {
    it.each([
      ["C:\\books\\book.wikg", "\\\\?\\C:\\books\\book.wikg"],
      ["\\\\?\\C:\\books\\book.wikg", "\\\\?\\C:\\books\\book.wikg"],
      ["\\\\server\\share\\book.wikg", "\\\\?\\UNC\\server\\share\\book.wikg"],
      [
        "\\\\?\\UNC\\server\\share\\book.wikg",
        "\\\\?\\UNC\\server\\share\\book.wikg",
      ],
    ])(
      "converts %s exactly once at the native filesystem boundary",
      async (input, expected) => {
        const stat = vi
          .spyOn(filesystem, "stat")
          .mockRejectedValue(
            Object.assign(new Error("probe"), { code: "ENOENT" }),
          );
        syncBuiltinESMExports();
        try {
          expect(await new NodeFile(input).getLastModified()).toBeUndefined();
          expect(stat).toHaveBeenCalledExactlyOnceWith(expected);
        } finally {
          stat.mockRestore();
          syncBuiltinESMExports();
        }
      },
    );
  },
);

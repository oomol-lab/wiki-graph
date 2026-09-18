import { describe, expect, it } from "vitest";

import { EpubArchive } from "../../../../packages/core/src/text/source/epub/archive.js";
import { NodeFile } from "../../../../packages/cli/src/runtime/node-platform.js";
import { getFixturePath } from "../../../helpers/fixtures.js";

describe("source/epub/archive", () => {
  it("normalizes mixed stored and deflated entry streams for async iteration", async () => {
    const archive = await EpubArchive.open(
      new NodeFile(getFixturePath("sample-observatory-guide-mixed.epub")),
    );

    try {
      const storedText = await archive.readText("EPUB/cover.xhtml");
      const deflatedText = await archive.readText("EPUB/chapter-1.xhtml");
      expect(storedText).toContain("The Pocket Observatory Manual");
      expect(deflatedText).toContain("Mira opened the shutters");
    } finally {
      await archive.close();
    }
  });

  it("hashes the archive through range reads", async () => {
    class RangeOnlyNodeFile extends NodeFile {
      public override read(): Promise<Uint8Array | string> {
        return Promise.reject(new Error("whole-file read is not allowed"));
      }
    }
    const archive = await EpubArchive.open(
      new RangeOnlyNodeFile(
        getFixturePath("sample-observatory-guide-mixed.epub"),
      ),
    );
    await archive.close();
  });
});

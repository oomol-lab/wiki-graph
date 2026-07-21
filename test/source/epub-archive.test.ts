import { describe, expect, it } from "vitest";

import { EpubArchive } from "../../packages/core/src/text/source/epub/archive.js";
import { getFixturePath, readStreamText } from "../helpers/fixtures.js";

describe("source/epub/archive", () => {
  it("normalizes mixed stored and deflated entry streams for async iteration", async () => {
    const archive = await EpubArchive.open(
      getFixturePath("sample-observatory-guide-mixed.epub"),
    );

    try {
      const storedStream = await archive.openReadStream("EPUB/cover.xhtml");
      storedStream.setEncoding("utf8");

      const deflatedStream = await archive.openReadStream(
        "EPUB/chapter-1.xhtml",
      );
      deflatedStream.setEncoding("utf8");

      expect(await readStreamText(storedStream)).toContain(
        "The Pocket Observatory Manual",
      );
      expect(await readStreamText(deflatedStream)).toContain(
        "Mira opened the shutters",
      );
    } finally {
      await archive.close();
    }
  });
});

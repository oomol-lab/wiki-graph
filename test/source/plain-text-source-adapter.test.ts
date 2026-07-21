import { mkdir } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  MARKDOWN_SOURCE_ADAPTER,
  TXT_SOURCE_ADAPTER,
} from "../../packages/core/src/text/source/index.js";
import { getFixturePath, readStreamText } from "../helpers/fixtures.js";
import { withTempDir } from "../helpers/temp.js";

describe("source/plain-text", () => {
  it("reads txt fixtures as a single root section", async () => {
    await TXT_SOURCE_ADAPTER.openSession(
      getFixturePath("sample-observatory-guide.txt"),
      async (document) => {
        const meta = await document.readMeta();
        const cover = await document.readCover();
        const sections = await document.readSections();

        expect(meta).toMatchObject({
          sourceFormat: "txt",
          title: "sample-observatory-guide",
          authors: [],
        });
        expect(cover).toBeUndefined();
        expect(sections).toHaveLength(1);
        expect(sections[0]?.id).toBe("root");

        const text = await readStreamText(await sections[0]!.open());

        expect(text).toContain("Checklist");
        expect(text).toContain("简体中文");
      },
    );
  });

  it("reads markdown fixtures without stripping markdown syntax", async () => {
    await MARKDOWN_SOURCE_ADAPTER.openSession(
      getFixturePath("sample-observatory-guide.md"),
      async (document) => {
        const meta = await document.readMeta();
        const sections = await document.readSections();
        const text = await readStreamText(await sections[0]!.open());

        expect(meta).toMatchObject({
          sourceFormat: "markdown",
          title: "sample-observatory-guide",
        });
        expect(text).toContain("# Sample Observatory Guide");
        expect(text).toContain("```yaml");
        expect(text).toContain("雨后石阶会打滑");
      },
    );
  });

  it("rejects directory inputs", async () => {
    await withTempDir("wikigraph-source-", async (path) => {
      const directoryPath = `${path}/nested`;
      await mkdir(directoryPath);

      await expect(
        TXT_SOURCE_ADAPTER.openSession(directoryPath, () =>
          Promise.resolve(undefined),
        ),
      ).rejects.toThrow("Source file is not a regular file");
    });
  });
});

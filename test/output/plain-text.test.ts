import { readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../packages/core/src/document/index.js";
import { writePlainText } from "../../packages/core/src/text/output/plain-text.js";
import { withTempDir } from "../helpers/temp.js";

describe("output/plain-text", () => {
  it("renders toc titles and summaries into a flat text file", async () => {
    await withTempDir("wikigraph-output-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeSummary(1, "Summary one");
          await openedDocument.writeSummary(2, "Summary two");
          await openedDocument.writeToc({
            items: [
              {
                children: [
                  {
                    children: [],
                    serialId: 2,
                    title: "Nested",
                  },
                ],
                serialId: 1,
                title: "Chapter 1",
              },
            ],
            version: 1,
          });
        });

        const outputPath = `${path}/result/book.txt`;
        await writePlainText({
          document,
          path: outputPath,
        });

        expect(await readFile(outputPath, "utf8")).toBe(
          "Chapter 1\n\nSummary one\n\nNested\n\nSummary two\n",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("omits headings for untitled toc items", async () => {
    await withTempDir("wikigraph-output-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeSummary(1, "Untitled summary");
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                serialId: 1,
              },
            ],
            version: 1,
          });
        });

        const outputPath = `${path}/result/book.txt`;
        await writePlainText({
          document,
          path: outputPath,
        });

        expect(await readFile(outputPath, "utf8")).toBe("Untitled summary\n");
      } finally {
        await document.release();
      }
    });
  });

  it("throws when toc or required summaries are missing", async () => {
    await withTempDir("wikigraph-output-", async (path) => {
      const missingTocDocument = await DirectoryDocument.open(`${path}/no-toc`);
      const missingSummaryDocument = await DirectoryDocument.open(
        `${path}/no-summary`,
      );

      try {
        await expect(
          writePlainText({
            document: missingTocDocument,
            path: `${path}/missing-toc.txt`,
          }),
        ).rejects.toThrow("Document TOC is missing");

        await missingSummaryDocument.openSession(async (openedDocument) => {
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                serialId: 7,
                title: "Broken",
              },
            ],
            version: 1,
          });
        });

        await expect(
          writePlainText({
            document: missingSummaryDocument,
            path: `${path}/missing-summary.txt`,
          }),
        ).rejects.toThrow("Chapter 7 summary is missing");
      } finally {
        await missingTocDocument.release();
        await missingSummaryDocument.release();
      }
    });
  });
});

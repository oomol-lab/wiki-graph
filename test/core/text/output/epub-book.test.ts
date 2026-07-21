import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../../packages/core/src/document/index.js";
import { buildEpubBook } from "../../../../packages/core/src/text/output/epub/book.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("output/epub/book", () => {
  it("builds sections, navigation, and package metadata from a document", async () => {
    await withTempDir("wikigraph-epub-book-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.createSerial();
          await openedDocument.writeBookMeta({
            authors: ["Ari Lantern"],
            description: "Observatory field notes",
            identifier: "urn:test:epub-book",
            language: " en ",
            publishedAt: "2026-01-01",
            publisher: "Open Sample Press",
            sourceFormat: "txt",
            title: "Output Fixture",
            version: 1,
          });
          await openedDocument.writeCover({
            data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]),
            mediaType: "image/png",
            path: "covers/book-cover.png",
          });
          await openedDocument.writeSummary(
            1,
            "First summary paragraph.\n\nSecond summary line.",
          );
          await openedDocument.writeSummary(
            2,
            "Nested summary line one.\nline two wrapped.",
          );
          await openedDocument.writeToc({
            items: [
              {
                children: [
                  {
                    children: [],
                    serialId: 2,
                    title: "Nested Notes",
                  },
                ],
                serialId: 1,
                title: "Chapter 1",
              },
            ],
            version: 1,
          });
        });

        const book = await buildEpubBook(document);

        expect(book.cover).toMatchObject({
          mediaType: "image/png",
          path: "covers/book-cover.png",
        });
        expect(book.sections.map((section) => section.id)).toStrictEqual([
          "serial-1",
          "serial-2",
        ]);
        expect(book.sections.map((section) => section.href)).toStrictEqual([
          "text/serial-1.xhtml",
          "text/serial-2.xhtml",
        ]);
        expect(book.sections[0]?.xhtml).toContain("First summary paragraph.");
        expect(book.sections[1]?.xhtml).toContain(
          "Nested summary line one. line two wrapped.",
        );
        expect(book.navXhtml).toContain("Chapter 1");
        expect(book.navXhtml).toContain("Nested Notes");
        expect(book.packageOpf).toContain("urn:test:epub-book");
        expect(book.packageOpf).toContain('<package version="3.0"');
        expect(book.packageOpf).toContain("text/cover.xhtml");
        expect(book.packageOpf).toContain("images/cover.png");
        expect(book.packageOpf).toContain("text/serial-1.xhtml");
        expect(book.packageOpf).toContain("text/serial-2.xhtml");
      } finally {
        await document.release();
      }
    });
  });

  it("creates a fallback section when the toc has no content items", async () => {
    await withTempDir("wikigraph-epub-book-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeBookMeta({
            authors: [],
            description: null,
            identifier: null,
            language: null,
            publishedAt: null,
            publisher: null,
            sourceFormat: "markdown",
            title: "Fallback Title",
            version: 1,
          });
          await openedDocument.writeToc({
            items: [],
            version: 1,
          });
        });

        const book = await buildEpubBook(document);

        expect(book.sections).toHaveLength(1);
        expect(book.sections[0]).toMatchObject({
          href: "text/section-1.xhtml",
          id: "section-1",
          title: "Fallback Title",
        });
        expect(book.packageOpf).toContain("text/section-1.xhtml");
        expect(book.navXhtml).toContain("Fallback Title");
      } finally {
        await document.release();
      }
    });
  });

  it("uses fallback section titles for untitled toc items", async () => {
    await withTempDir("wikigraph-epub-book-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.writeBookMeta({
            authors: [],
            description: null,
            identifier: null,
            language: null,
            publishedAt: null,
            publisher: null,
            sourceFormat: "txt",
            title: null,
            version: 1,
          });
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

        const book = await buildEpubBook(document);

        expect(book.sections[0]).toMatchObject({
          id: "serial-1",
          title: "Section 1",
        });
        expect(book.navXhtml).toContain("Section 1");
        expect(book.packageOpf).toContain("Untitled");
      } finally {
        await document.release();
      }
    });
  });

  it("throws when archive metadata is missing", async () => {
    await withTempDir("wikigraph-epub-book-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeToc({
            items: [],
            version: 1,
          });
        });

        await expect(buildEpubBook(document)).rejects.toThrow(
          "Archive metadata is missing",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("throws when toc is missing", async () => {
    await withTempDir("wikigraph-epub-book-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeBookMeta({
            authors: [],
            description: null,
            identifier: null,
            language: null,
            publishedAt: null,
            publisher: null,
            sourceFormat: "txt",
            title: "Missing TOC",
            version: 1,
          });
        });

        await expect(buildEpubBook(document)).rejects.toThrow(
          "Document TOC is missing",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("throws when a summary required by the toc is missing", async () => {
    await withTempDir("wikigraph-epub-book-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeBookMeta({
            authors: [],
            description: null,
            identifier: null,
            language: "en",
            publishedAt: null,
            publisher: null,
            sourceFormat: "txt",
            title: "Missing Summary",
            version: 1,
          });
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                serialId: 7,
                title: "Broken Chapter",
              },
            ],
            version: 1,
          });
        });

        await expect(buildEpubBook(document)).rejects.toThrow(
          "Chapter 7 summary is missing",
        );
      } finally {
        await document.release();
      }
    });
  });
});

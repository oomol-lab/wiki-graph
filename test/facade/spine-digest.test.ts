import { mkdir, readFile, writeFile } from "fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  DirectoryDocument,
  type ReadonlyDocument,
} from "../../src/document/index.js";
import { extractWikgArchive } from "../../src/facade/archive.js";
import { SpineDigest } from "../../src/facade/spine-digest.js";
import { EPUB_SOURCE_ADAPTER } from "../../src/source/index.js";
import { collectSectionTitles, readStreamText } from "../helpers/fixtures.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/spine-digest", () => {
  it("reads document data and exports plain text plus epub", async () => {
    await withTempDir("spinedigest-facade-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const digest = new SpineDigest(document, document.path);
        const textPath = `${path}/exports/book.txt`;
        const epubPath = `${path}/exports/book.epub`;

        expect(await digest.readMeta()).toMatchObject({
          identifier: "urn:test:facade",
          sourceFormat: "txt",
          title: "Facade Fixture",
        });
        expect(await digest.readCover()).toMatchObject({
          mediaType: "image/png",
          path: "images/cover.png",
        });
        expect(await digest.readToc()).toMatchObject({
          items: [
            {
              title: "Chapter 1",
              serialId: 1,
            },
          ],
        });
        expect(await digest.listSerials()).toStrictEqual([
          {
            fragmentCount: 1,
            serialId: 1,
            title: "Chapter 1",
            tocPath: ["Chapter 1"],
          },
          {
            fragmentCount: 1,
            serialId: 2,
            title: "Appendix",
            tocPath: ["Chapter 1", "Appendix"],
          },
        ]);
        expect(await digest.readSerialSummary(2)).toBe("Summary two");

        await digest.exportText(textPath);
        expect(await readFile(textPath, "utf8")).toBe(
          "Chapter 1\n\nSummary one\n\nAppendix\n\nSummary two\n",
        );

        await digest.exportEpub(epubPath);
        await EPUB_SOURCE_ADAPTER.openSession(
          epubPath,
          async (sourceDocument) => {
            const sections = await sourceDocument.readSections();
            const cover = await sourceDocument.readCover();

            expect(await sourceDocument.readMeta()).toMatchObject({
              identifier: "urn:test:facade",
              title: "Facade Fixture",
            });
            expect(collectSectionTitles(sections)).toStrictEqual([
              "Chapter 1",
              "Appendix",
            ]);
            expect(await readStreamText(await sections[0]!.open())).toContain(
              "Summary one",
            );
            expect(
              await readStreamText(await sections[0]!.children[0]!.open()),
            ).toContain("Summary two");
            expect(cover).toMatchObject({
              mediaType: "image/png",
            });
            expect(cover?.data.byteLength).toBeGreaterThan(0);
          },
        );
      } finally {
        await document.release();
      }
    });
  });

  it("flushes flushable documents before saving an wikg archive", async () => {
    await withTempDir("spinedigest-facade-", async (path) => {
      const sourceDir = `${path}/document`;
      const archivePath = `${path}/saved/book.wikg`;
      const flush = vi.fn(async () => {});

      await mkdir(sourceDir, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, "saved", "utf8");
      await writeFile(`${sourceDir}/database.db-journal`, "transient", "utf8");

      const digest = new SpineDigest(
        {
          flush,
        } as unknown as ReadonlyDocument & { flush(): Promise<void> },
        sourceDir,
      );

      await digest.saveAs(archivePath);

      expect(flush).toHaveBeenCalledTimes(1);

      const extractDir = `${path}/extract`;
      await extractWikgArchive(archivePath, extractDir);
      expect(await readFile(`${extractDir}/database.db`, "utf8")).toBe("saved");
      await expect(
        readFile(`${extractDir}/database.db-journal`, "utf8"),
      ).rejects.toThrow();
    });
  });

  it("lists only serials with summaries for cat-ready output", async () => {
    await withTempDir("spinedigest-facade-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.createSerial();
          await openedDocument.writeSummary(1, "Summary one");
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                serialId: 1,
                title: "Ready",
              },
              {
                children: [],
                serialId: 2,
                title: "Pending",
              },
            ],
            version: 1,
          });
        });

        const digest = new SpineDigest(document, document.path);

        expect(await digest.listSerials()).toStrictEqual([
          {
            fragmentCount: 0,
            serialId: 1,
            title: "Ready",
            tocPath: ["Ready"],
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("reads chapter stage without requiring summary-ready serials", async () => {
    await withTempDir("spinedigest-facade-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.createSerial();
          await openedDocument.createSerial();
          await openedDocument.createSerial();
          const sourcedDraft = await openedDocument
            .getSerialFragments(2)
            .createDraft();
          sourcedDraft.addSentence("Source sentence.", 2);
          await sourcedDraft.commit();
          const graphedDraft = await openedDocument
            .getSerialFragments(3)
            .createDraft();
          graphedDraft.addSentence("Graph sentence.", 2);
          await graphedDraft.commit();
          await openedDocument.serials.setTopologyReady(3);
          await openedDocument.writeSummary(4, "Summary four");
          await openedDocument.writeToc({
            items: [
              {
                children: [
                  {
                    children: [],
                    serialId: 2,
                    title: "Sourced",
                  },
                ],
                serialId: 1,
                title: "Planned",
              },
              {
                children: [],
                serialId: 3,
                title: "Graphed",
              },
              {
                children: [],
                serialId: 4,
                title: "Summarized",
              },
            ],
            version: 1,
          });
        });

        const digest = new SpineDigest(document, document.path);

        await expect(digest.readChapterStage(1)).resolves.toBe("planned");
        await expect(digest.readChapterStage(2)).resolves.toBe("sourced");
        await expect(digest.readChapterStage(3)).resolves.toBe("graphed");
        await expect(digest.readChapterStage(4)).resolves.toBe("summarized");
        await expect(digest.readChapterStage(404)).rejects.toThrow(
          "Chapter 404 does not exist",
        );
      } finally {
        await document.release();
      }
    });
  });
});

async function seedDocument(document: DirectoryDocument): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.createSerial();
    await openedDocument.createSerial();
    await openedDocument.writeBookMeta({
      authors: ["Ari Lantern"],
      description: "Facade fixture",
      identifier: "urn:test:facade",
      language: "en",
      publishedAt: "2026-01-01",
      publisher: "Open Sample Press",
      sourceFormat: "txt",
      title: "Facade Fixture",
      version: 1,
    });
    await openedDocument.writeCover({
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]),
      mediaType: "image/png",
      path: "images/cover.png",
    });
    await openedDocument.writeSummary(1, "Summary one");
    await openedDocument.writeSummary(2, "Summary two");
    const firstDraft = await openedDocument.getSerialFragments(1).createDraft();
    firstDraft.setSummary("Fragment summary one");
    firstDraft.addSentence("Sentence one.", 2);
    await firstDraft.commit();
    const secondDraft = await openedDocument
      .getSerialFragments(2)
      .createDraft();
    secondDraft.setSummary("Fragment summary two");
    secondDraft.addSentence("Sentence two.", 2);
    await secondDraft.commit();
    await openedDocument.writeToc({
      items: [
        {
          children: [
            {
              children: [],
              serialId: 2,
              title: "Appendix",
            },
          ],
          serialId: 1,
          title: "Chapter 1",
        },
      ],
      version: 1,
    });
  });
}

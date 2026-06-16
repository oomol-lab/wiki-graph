import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import {
  findArchiveObjects,
  grepArchiveObjects,
  listArchiveObjects,
  readArchivePage,
} from "../../src/facade/archive-view.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/archive-view", () => {
  it("searches sourced fragments before graph or summary build", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const result = await findArchiveObjects(document, "Wiki");

        expect(result.items).toContainEqual(
          expect.objectContaining({
            field: "source",
            id: "fragment:1:0",
            type: "fragment",
          }),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("finds whitespace-separated keywords inside one archive object", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const result = await findArchiveObjects(document, "朱元璋 亲自 来到");

        expect(result.items).toContainEqual(
          expect.objectContaining({
            field: "source",
            id: "fragment:1:0",
            type: "fragment",
          }),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("greps exact text without splitting whitespace-separated keywords", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(
          grepArchiveObjects(document, "朱元璋 亲自 来到"),
        ).resolves.toMatchObject({ items: [] });

        const result = await grepArchiveObjects(
          document,
          "朱元璋知道了这个消息",
        );

        expect(result.items).toContainEqual(
          expect.objectContaining({
            field: "source",
            id: "fragment:1:0",
            type: "fragment",
          }),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("filters search results by type and chapter", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const result = await findArchiveObjects(document, "Wiki", {
          chapters: [1],
          types: ["fragment"],
        });

        expect(result.chapters).toStrictEqual([1]);
        expect(result.types).toStrictEqual(["fragment"]);
        expect(result.items).toStrictEqual([
          expect.objectContaining({
            chapter: 1,
            id: "fragment:1:0",
            position: { chapter: 1, fragment: 0 },
            type: "fragment",
          }),
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("paginates search results with stable cursors", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const firstPage = await findArchiveObjects(document, "Wiki", {
          limit: 1,
        });
        const secondPage = await findArchiveObjects(document, "Wiki", {
          ...(firstPage.nextCursor === null
            ? {}
            : { cursor: firstPage.nextCursor }),
          limit: 1,
        });

        expect(firstPage.items).toHaveLength(1);
        expect(firstPage.nextCursor).not.toBeNull();
        expect(secondPage.items).toHaveLength(1);
        expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
      } finally {
        await document.release();
      }
    });
  });

  it("rejects invalid search cursors", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(
          findArchiveObjects(document, "Wiki", { cursor: "not-a-cursor" }),
        ).rejects.toThrow("Invalid search cursor.");
      } finally {
        await document.release();
      }
    });
  });

  it("shows source previews on sourced chapter pages", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const page = await readArchivePage(document, "chapter:1");

        expect(page.id).toBe("chapter:1");
        expect(page.type).toBe("chapter");
        if (page.type !== "chapter") {
          throw new Error("Expected chapter page");
        }
        expect(page.sourcePreview).toContain("LLM Wiki");
      } finally {
        await document.release();
      }
    });
  });

  it("labels source fragments with their chapter title", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(
          listArchiveObjects(document, "fragments"),
        ).resolves.toContainEqual(
          expect.objectContaining({
            id: "fragment:1:0",
            label: "Introduction",
            type: "fragment",
          }),
        );
      } finally {
        await document.release();
      }
    });
  });
});

async function seedSourcedDocument(document: DirectoryDocument): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.createSerial();
    const draft = await openedDocument.getSerialFragments(1).createDraft();

    draft.addSentence(
      "An LLM Wiki exposes pages, links, and evidence to agents.",
      10,
    );
    draft.addSentence("朱元璋知道了这个消息，随后亲自来到洪都。", 18);
    draft.addSentence("Source-only archives should be searchable.", 6);
    await draft.commit();
    await openedDocument.writeBookMeta({
      authors: [],
      description: null,
      identifier: null,
      language: "en",
      publishedAt: null,
      publisher: null,
      sourceFormat: "markdown",
      title: "Archive Wiki Fixture",
      version: 1,
    });
    await openedDocument.writeToc({
      items: [
        {
          children: [],
          serialId: 1,
          title: "Introduction",
        },
      ],
      version: 1,
    });
  });
}

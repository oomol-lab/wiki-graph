import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DirectoryDocument,
  findArchiveObjects,
  grepArchiveObjects,
  rebuildArchiveSearchIndex,
  seedSourcedDocument,
  setupArchiveViewTestState,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/search controls", () => {
  it("greps exact text without splitting whitespace-separated keywords", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
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

        expect(result.lens).toBe("exact");
        expect(result.lensHint).toBeNull();
        expect(result.items).toContainEqual(
          expect.objectContaining({
            field: "source",
            id: "wikg://chapter/introduction/source#2",
            type: "source",
          }),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("filters search results by type and chapter", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const result = await findArchiveObjects(document, "Wiki", {
          chapters: [1],
          types: ["source"],
        });

        expect(result.chapters).toStrictEqual([1]);
        expect(result.lens).toBe("typed");
        expect(result.lensHint).toBeNull();
        expect(result.types).toStrictEqual(["source"]);
        expect(result.items).toStrictEqual([
          expect.objectContaining({
            chapter: 1,
            id: "wikg://chapter/introduction/source#1",
            position: { chapter: 1, sentence: 0 },
            type: "source",
          }),
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("keeps indexed text-only cursors paginated beyond the first lookahead", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          const tocItems = [];

          for (let index = 0; index < 12; index += 1) {
            const serialId = await openedDocument.createSerial();
            const draft = await openedDocument
              .getSerialFragments(serialId)
              .createDraft();

            draft.addSentence(`CursorOnly indexed source ${index}.`, 4);
            await draft.commit();
            tocItems.push({
              children: [],
              serialId,
              title: `Cursor ${index}`,
            });
          }

          await openedDocument.writeToc({
            items: tocItems,
            version: 1,
          });
        });
        await rebuildArchiveSearchIndex(document);

        const firstPage = await findArchiveObjects(document, "CursorOnly", {
          limit: 5,
          types: ["source"],
        });
        const secondPage = await findArchiveObjects(document, "CursorOnly", {
          ...(firstPage.nextCursor === null
            ? {}
            : { cursor: firstPage.nextCursor }),
          limit: 5,
          types: ["source"],
        });

        expect(firstPage.items).toHaveLength(5);
        expect(firstPage.nextCursor).not.toBeNull();
        expect(secondPage.items).toHaveLength(5);
        expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
      } finally {
        await document.release();
      }
    });
  });

  it("paginates search results with stable cursors", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const firstPage = await findArchiveObjects(document, "Source", {
          limit: 1,
        });

        expect(firstPage.items).toHaveLength(1);
        expect(firstPage.nextCursor).not.toBeNull();

        const secondPage = await findArchiveObjects(document, "Source", {
          ...(firstPage.nextCursor === null
            ? {}
            : { cursor: firstPage.nextCursor }),
          limit: 1,
        });

        expect(secondPage.items).toHaveLength(1);
        expect(secondPage.nextCursor).not.toBe(firstPage.nextCursor);
      } finally {
        await document.release();
      }
    });
  });

  it("rejects invalid search cursors", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
});

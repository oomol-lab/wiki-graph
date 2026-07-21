import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DirectoryDocument,
  createEntityWikipageMockFetch,
  findArchiveObjects,
  listArchiveCollection,
  listArchiveEvidence,
  listArchiveObjects,
  readArchivePage,
  restoreEnv,
  seedSourcedDocument,
  setupArchiveViewTestState,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/pages", () => {
  it("reads chapter title and state as separate objects", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(readArchivePage(document, "chapter:1")).rejects.toThrow(
          "scope URI",
        );

        await expect(
          readArchivePage(document, "chapter-title:1"),
        ).resolves.toStrictEqual({
          id: "chapter-title:1",
          title: "Introduction",
          type: "chapter-title",
        });
        await expect(
          readArchivePage(document, "wikg://chapter/1/state"),
        ).resolves.toStrictEqual({
          id: "wikg://chapter/1/state",
          state: {
            "knowledge-graph": "missing",
            "reading-graph": "ready",
            "reading-summary": "ready",
            source: "ready",
          },
          type: "state",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("reads archive metadata as the Wiki Graph root object", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.replaceBookMeta({
            authors: ["Author One", "Author Two"],
            description: "A searchable description.",
            identifier: "hidden-id",
            language: "en",
            publishedAt: null,
            publisher: "Example Press",
            sourceFormat: "markdown",
            title: "Root Metadata",
            version: 1,
          });
        });

        await expect(
          readArchivePage(document, "wikg://"),
        ).resolves.toStrictEqual({
          authors: ["Author One", "Author Two"],
          description: "A searchable description.",
          id: "meta:root",
          publisher: "Example Press",
          title: "Root Metadata",
          type: "meta",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("reads entity wikipage resources", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(
          readArchivePage(document, "wikg://entity/Q1/wikipage", {
            wikipageResolverOptions: {
              cacheDatabasePath: `${path}/wikipage-cache.sqlite`,
              fetch: createEntityWikipageMockFetch(),
              minRequestIntervalMs: 0,
              retryBaseDelayMs: 0,
            },
          }),
        ).resolves.toStrictEqual({
          en: {
            description: "Ming dynasty general",
            title: "Xu Da",
            url: "https://en.wikipedia.org/wiki/Xu_Da",
          },
          id: "wikg://entity/Q1/wikipage",
          type: "entity-wikipage",
          zh: {
            description: "明朝军事将领",
            title: "徐达",
            url: "https://zh.wikipedia.org/wiki/%E5%BE%90%E8%BE%BE",
          },
        });
      } finally {
        await document.release();
      }
    });
  });

  it("does not include metadata fields in search", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.replaceBookMeta({
            authors: ["Visible Author"],
            description: "Visible Description",
            identifier: "Hidden Identifier",
            language: "Hidden Language",
            publishedAt: "Hidden Date",
            publisher: "Visible Publisher",
            sourceFormat: "markdown",
            title: "Visible Title",
            version: 1,
          });
        });

        await expect(
          findArchiveObjects(document, "Visible Publisher", {
            archiveKey: `${path}/book.wikg`,
            types: ["meta"],
          }),
        ).resolves.toMatchObject({ items: [] });
        await expect(
          findArchiveObjects(document, "Hidden Identifier", {
            archiveKey: `${path}/book.wikg`,
            types: ["meta"],
          }),
        ).resolves.toMatchObject({ items: [] });
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("treats chapter search results as title hits only", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const result = await findArchiveObjects(document, "Summary", {
          archiveKey: `${path}/book.wikg`,
          types: ["chapter", "summary"],
        });

        expect(result.items).toContainEqual(
          expect.objectContaining({
            id: "wikg://chapter/1/summary#1",
            type: "summary",
          }),
        );
        expect(result.items).not.toContainEqual(
          expect.objectContaining({
            id: "chapter:1",
            type: "chapter",
          }),
        );
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("hydrates collection evidence only after pagination", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "paged-valid",
              qid: "Q1",
              rangeEnd: 10,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Paged Valid",
            },
            {
              chapterId: 1,
              id: "paged-not-on-first-page",
              qid: "Q2",
              rangeEnd: 10,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Paged Later",
            },
          ]);
        });

        const result = await listArchiveCollection(document, {
          evidenceLimit: 1,
          limit: 1,
          types: ["entity"],
        });
        const [first] = result.items;

        expect(first?.id).toBe("wikg://entity/Q1");
        expect(first?.evidence?.shown).toBe(1);
        expect(result.nextCursor).not.toBeNull();
      } finally {
        await document.release();
      }
    });
  });

  it("labels source fragments with their chapter title", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(
          listArchiveObjects(document, "fragments"),
        ).resolves.toContainEqual(
          expect.objectContaining({
            id: "wikg://chapter/1/source#1",
            label: "Introduction",
            type: "source",
          }),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("shows source sentence range pages", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const fragmentPage = await readArchivePage(
          document,
          "wikg://chapter/1/source#1",
        );

        expect(fragmentPage).toMatchObject({
          fragment: {
            id: "wikg://chapter/1/source#1",
            text: "An LLM Wiki exposes pages, links, and source fragments to agents.",
          },
          type: "fragment",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("keeps multi-digit source range indexes intact", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          for (let index = 0; index < 13; index += 1) {
            draft.addSentence(`Sentence ${index}`, 2);
          }

          await draft.commit();
          await openedDocument.writeToc({
            items: [{ children: [], serialId: 1, title: "Numbered" }],
            version: 1,
          });
        });

        const page = await readArchivePage(
          document,
          "wikg://chapter/1/source#11..13",
        );

        expect(page).toMatchObject({
          fragment: {
            id: "wikg://chapter/1/source#11..13",
            text: ["Sentence 10", "Sentence 11", "Sentence 12"].join(""),
          },
          type: "fragment",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("rejects malformed source sentence ranges", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(
          readArchivePage(document, "wikg://chapter/1/source#1..2..3"),
        ).rejects.toThrow("Invalid source sentence range: 1..2..3");
        await expect(
          readArchivePage(document, "wikg://chapter/1/source#0"),
        ).rejects.toThrow("Invalid source sentence range: 0");
        await expect(
          readArchivePage(document, "wikg://chapter/1/source#10..9"),
        ).rejects.toThrow("Invalid source sentence range: 10..9");
      } finally {
        await document.release();
      }
    });
  });

  it("rejects out-of-bounds source sentence ranges", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(
          readArchivePage(document, "wikg://chapter/1/source#100..100"),
        ).rejects.toThrow(
          "source range wikg://chapter/1/source#100 is out of bounds. Last sentence number is 3.",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("shows node pages with generated summaries and source fragments", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const page = await readArchivePage(document, "node:100");

        expect(page.type).toBe("node");
        if (page.type !== "node") {
          throw new Error("Expected node page");
        }
        expect(page.generatedNodeSummary).toBe(
          "Pages and links make archive navigation explicit.",
        );
        expect(page.id).toBe("node:100");
        expect(page.sourceFragments[0]?.id).toBe(
          "wikg://chapter/1/source#1..3",
        );
        expect(page.sourceFragments[0]?.text).toContain(
          "An LLM Wiki exposes pages",
        );
        expect(page.title).toBe("Wiki pages");
        expect(JSON.stringify(page)).not.toContain("sentence:");
      } finally {
        await document.release();
      }
    });
  });

  it("maps node sentence indexes back to source fragments", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const page = await readArchivePage(document, "node:101");

        expect(page.type).toBe("node");
        if (page.type !== "node") {
          throw new Error("Expected node page");
        }
        expect(page.sourceFragments[0]?.id).toBe(
          "wikg://chapter/1/source#1..3",
        );
        expect(page.sourceFragments[0]?.text).toContain(
          "Source-only archives should be searchable.",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("orders no-query source and evidence results by document flow", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.createSerial();

          for (const serialId of [1, 2]) {
            const draft = await openedDocument
              .getSerialFragments(serialId)
              .createDraft();

            draft.addSentence(`Chapter ${serialId} source sentence.`, 4);
            await draft.commit();
          }

          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "flow-mention-one",
              qid: "Q1",
              rangeEnd: 9,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Chapter 1",
            },
            {
              chapterId: 2,
              id: "flow-mention-two",
              qid: "Q1",
              rangeEnd: 9,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Chapter 2",
            },
          ]);
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                serialId: 2,
                title: "Second in id, first in document",
              },
              {
                children: [],
                serialId: 1,
                title: "First in id, second in document",
              },
            ],
            version: 1,
          });
        });

        const chapters = await listArchiveCollection(document, {
          types: ["chapter-title"],
        });
        const chaptersReverse = await listArchiveCollection(document, {
          order: "doc-desc",
          types: ["chapter-title"],
        });
        const evidence = await listArchiveEvidence(
          document,
          "wikg://entity/Q1",
        );
        const evidenceReverse = await listArchiveEvidence(
          document,
          "wikg://entity/Q1",
          { order: "doc-desc" },
        );

        expect(chapters.items.map((item) => item.id)).toStrictEqual([
          "chapter-title:2",
          "chapter-title:1",
        ]);
        expect(chaptersReverse.items.map((item) => item.id)).toStrictEqual([
          "chapter-title:1",
          "chapter-title:2",
        ]);
        expect(evidence.items.map((item) => item.id)).toStrictEqual([
          "wikg://chapter/2/source#1",
          "wikg://chapter/1/source#1",
        ]);
        expect(evidenceReverse.items.map((item) => item.id)).toStrictEqual([
          "wikg://chapter/1/source#1",
          "wikg://chapter/2/source#1",
        ]);
      } finally {
        await document.release();
      }
    });
  });
});

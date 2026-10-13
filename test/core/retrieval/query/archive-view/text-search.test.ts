import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DirectoryDocument,
  SEARCH_INDEX_FTS_HIT_LIMIT,
  countSearchSessionsForQuery,
  countStructuredCacheRowsForQuery,
  deleteArchiveSearchSessions,
  findArchiveObjects,
  getWikiGraphStateDirectoryPathForTesting,
  listDocumentTableNames,
  listSearchIndexTableNames,
  querySearchIndex,
  readArchivePage,
  rebuildArchiveSearchIndex,
  restoreWikiGraphStateDir,
  seedSourcedDocument,
  setWikiGraphStateDirectoryPathForTesting,
  setupArchiveViewTestState,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";
import { SEARCH_OBJECT_PROPERTY_OWNER_KIND } from "../../../../../packages/core/src/retrieval/search-index/index.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/text search", () => {
  it("exposes original BM25 on source and summary without replacing final scores", async () => {
    await withTempDir("wikigraph-raw-scores-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);
      try {
        await seedSourcedDocument(document);
        await document.openSession(async (opened) => {
          await opened.writeSummary(1, "Wiki summary match.");
        });
        await rebuildArchiveSearchIndex(document);
        const indexed = await querySearchIndex(document, "Wiki", {
          queryMode: "fts",
          types: ["source", "summary"],
        });
        const result = await findArchiveObjects(document, "Wiki", {
          queryMode: "fts",
          sourceContext: 0,
          types: ["source", "summary"],
        });
        for (const type of ["source", "summary"] as const) {
          const hit = result.items.find((hit) => hit.type === type);
          const raw = indexed?.textHits.find(
            (hit) => hit.kind === (type === "source" ? 1 : 2),
          );
          expect(hit).toBeDefined();
          expect(hit?.ftsScore).toBe(raw?.ftsScore);
          expect(hit?.ftsScore).toBeLessThan(0);
          expect(hit?.embeddingScore).toBeUndefined();
          expect(hit?.score).toBe(raw?.score);
        }
      } finally {
        await document.release();
      }
    });
  });
  it("searches sourced sentences before graph or summary build", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        const sourceText =
          (await document.getSerialFragments(1).readText()) ?? "";
        await document.sourceProvenance.replace(
          1,
          await document.serials.getRevision(1),
          {
            artifacts: [
              {
                digest: "a".repeat(64),
                mediaType: "application/epub+zip",
              },
            ],
            mappings: [
              {
                artifactDigest: "a".repeat(64),
                locator: { cfi: "epubcfi(/6/2!/4/2)" },
                sourceEnd: Array.from(sourceText).length,
                sourceStart: 0,
              },
            ],
          },
        );

        const result = await findArchiveObjects(document, "Wiki");

        expect(result.lens).toBe("broad");
        expect(result.lensHint).toMatchObject({
          lenses: {
            chunk: "source text ranges",
            entity: "indexed entities",
            node: "topology / LLM Wiki structure",
            triple: "knowledge graph statements",
          },
        });
        expect(result.items).toContainEqual(
          expect.objectContaining({
            field: "source",
            id: "wikg://chapter/introduction/source#1..3",
            position: {
              chapter: 1,
              sentence: 0,
            },
            type: "source",
          }),
        );
        const sourceHit = result.items.find((item) => item.type === "source");
        if (sourceHit === undefined) {
          throw new Error("Expected source search hit");
        }
        await expect(
          readArchivePage(document, sourceHit.id),
        ).resolves.toMatchObject({
          id: sourceHit.id,
          type: "fragment",
        });
        expect(sourceHit).not.toHaveProperty("locators");

        const listMap = vi.spyOn(document.sourceProvenance, "listMap");
        const sourceOnly = await findArchiveObjects(document, "Wiki", {
          limit: 1,
          types: ["source"],
        });
        const typedSourceHit = sourceOnly.items[0];

        expect(typedSourceHit?.type).toBe("source");
        expect(typedSourceHit).not.toHaveProperty("locators");
        expect(listMap).not.toHaveBeenCalled();
      } finally {
        await document.release();
      }
    });
  });

  it("renders source text from the stored text stream without sentence newlines", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);
      const sourceText = "\n\n  Alpha one.\n\nBeta two.\n\n";

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument
            .getSerialFragments(1)
            .writeTextStream(sourceText);
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                key: "rendered-source",
                serialId: 1,
                title: "Chapter 1",
              },
            ],
            version: 1,
          });
        });
        const toc = await document.readToc();
        const chapterUri = `wikg://chapter/${toc?.items[0]?.key}`;

        const fullPage = await readArchivePage(
          document,
          `${chapterUri}/source`,
        );
        const rangePage = await readArchivePage(
          document,
          `${chapterUri}/source#1..2`,
        );

        expect(fullPage.type).toBe("fragment");
        expect(rangePage.type).toBe("fragment");
        if (fullPage.type !== "fragment" || rangePage.type !== "fragment") {
          throw new Error("Expected source fragment pages");
        }
        expect(fullPage.fragment.text).toBe("  Alpha one.\n\nBeta two.");
        expect(rangePage.fragment.text).toBe("  Alpha one.\n\nBeta two.");
      } finally {
        await document.release();
      }
    });
  });

  it("coalesces expanded text search hits within a result page", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("# Test Note", 3);
          draft.addSentence("Alice studies graph retrieval.", 4);
          draft.addSentence("Bob cites Alice in a research note.", 7);
          await draft.commit();
          await openedDocument.writeBookMeta({
            authors: [],
            description: null,
            identifier: null,
            language: "en",
            publishedAt: null,
            publisher: null,
            sourceFormat: "markdown",
            title: "Archive Fixture",
            version: 1,
          });
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                key: "coalesced-source",
                serialId: 1,
                title: "Chapter 1",
              },
            ],
            version: 1,
          });
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "Alice");

        expect(result.items).toStrictEqual([
          expect.objectContaining({
            field: "source",
            id: "wikg://chapter/coalesced-source/source#1..3",
            snippet:
              "# Test NoteAlice studies graph retrieval.Bob cites Alice in a research note.",
            type: "source",
          }),
        ]);
        expect(result.limit).toBe(20);
        expect(result.nextCursor).toBeNull();
      } finally {
        await document.release();
      }
    });
  });

  it("finds any whitespace-separated keyword by default", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const result = await findArchiveObjects(
          document,
          "朱元璋 不存在的关键词",
        );

        expect(result.match).toBe("any");
        const sourceHit = result.items.find(
          (item) => item.type === "source" && item.field === "source",
        );
        expect(sourceHit?.id).toMatch(
          /^wikg:\/\/chapter\/introduction\/source#/u,
        );
        expect(sourceHit).toMatchObject({
          field: "source",
          type: "source",
        });
        expect(sourceHit?.matchedTerms).toContain("朱元璋");
        expect(sourceHit?.missingTerms).toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("searches through the archive-local FTS index with normalized tokens", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const chinese = await findArchiveObjects(document, "洪都");
        const singleHan = await findArchiveObjects(document, "璋");
        const stemmed = await findArchiveObjects(document, "exposing");

        expect(chinese.items).toContainEqual(
          expect.objectContaining({
            field: "source",
            type: "source",
          }),
        );
        expect(singleHan.items).toContainEqual(
          expect.objectContaining({
            field: "source",
            type: "source",
          }),
        );
        expect(stemmed.items).toContainEqual(
          expect.objectContaining({
            field: "source",
            type: "source",
          }),
        );
        await expect(listDocumentTableNames(document)).resolves.toEqual(
          expect.arrayContaining(["text_sentence_records"]),
        );
        await expect(listDocumentTableNames(document)).resolves.not.toEqual(
          expect.arrayContaining([
            "search_index_state",
            "search_object_properties_fts",
            "search_object_properties_records",
            "text_sentence_fts",
          ]),
        );
        await expect(listSearchIndexTableNames(document)).resolves.toEqual(
          expect.arrayContaining([
            "search_index_state",
            "search_object_properties_fts",
            "search_object_properties_records",
            "text_sentence_fts",
            "text_sentence_records",
          ]),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("orders text search hits by FTS relevance within the text bucket", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("alpha appears in a weak candidate.", 6);
          draft.addSentence("alpha beta alpha beta is the strongest match.", 8);
          await draft.commit();
          await openedDocument.writeBookMeta({
            authors: [],
            description: null,
            identifier: null,
            language: "en",
            publishedAt: null,
            publisher: null,
            sourceFormat: "markdown",
            title: "Search Ranking Fixture",
            version: 1,
          });
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                key: "ranking",
                serialId: 1,
                title: "Ranking",
              },
            ],
            version: 1,
          });
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "alpha beta", {
          limit: 10,
          types: ["source"],
        });

        expect(result.items.map((item) => item.id)).toStrictEqual([
          "wikg://chapter/ranking/source#2",
          "wikg://chapter/ranking/source#1",
        ]);
        expect(result.items[0]?.score).toBeGreaterThan(
          result.items[1]?.score ?? 0,
        );
      } finally {
        await document.release();
      }
    });
  });

  it("orders chapter search hits by FTS relevance within the object property bucket", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.createSerial();
          await openedDocument.writeBookMeta({
            authors: [],
            description: null,
            identifier: null,
            language: "en",
            publishedAt: null,
            publisher: null,
            sourceFormat: "markdown",
            title: "Chapter Ranking Fixture",
            version: 1,
          });
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                key: "alpha-appears-in-a-weak-chapter",
                serialId: 1,
                title: "alpha appears in a weak chapter",
              },
              {
                children: [],
                key: "alpha-beta-alpha-beta-strongest-chapter",
                serialId: 2,
                title: "alpha beta alpha beta strongest chapter",
              },
            ],
            version: 1,
          });
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "alpha beta", {
          limit: 10,
          types: ["chapter"],
        });

        expect(result.items.map((item) => item.id)).toStrictEqual([
          "wikg://chapter/alpha-beta-alpha-beta-strongest-chapter/title",
          "wikg://chapter/alpha-appears-in-a-weak-chapter/title",
        ]);
        expect(result.items[0]?.score).toBeGreaterThan(
          result.items[1]?.score ?? 0,
        );
      } finally {
        await document.release();
      }
    });
  });

  it("limits FTS candidates before search cache hydration", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        expect(SEARCH_INDEX_FTS_HIT_LIMIT).toBe(32_000);
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeSummary(
            1,
            "Wiki summary candidate one. Wiki summary candidate two.",
          );
          await openedDocument.chunks.save({
            content: "Wiki limit candidate one",
            generation: 0,
            id: 200,
            label: "Wiki limit one",
            sentenceId: [1, 0],
            sentenceIds: [[1, 0]],
            wordsCount: 4,
            weight: 1,
          });
          await openedDocument.chunks.save({
            content: "Wiki limit candidate two",
            generation: 0,
            id: 201,
            label: "Wiki limit two",
            sentenceId: [1, 1],
            sentenceIds: [[1, 1]],
            wordsCount: 4,
            weight: 1,
          });
        });
        await rebuildArchiveSearchIndex(document);

        const result = await querySearchIndex(document, "Wiki", {
          objectHitLimit: 2,
          textHitLimit: 2,
        });

        expect(result?.objectHits).toHaveLength(2);
        expect(result?.textHits).toHaveLength(2);
      } finally {
        await document.release();
      }
    });
  });

  it("filters object search index rows by requested object types", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.replaceToc({
            items: [
              {
                children: [],
                serialId: 1,
                title: "SharedFacet chapter",
              },
            ],
            version: 1,
          });
          await openedDocument.chunks.save({
            content: "SharedFacet node content.",
            generation: 0,
            id: 302,
            label: "SharedFacet node",
            sentenceId: [1, 0],
            sentenceIds: [[1, 0]],
            wordsCount: 3,
            weight: 1,
          });
          await openedDocument.mentions.save({
            chapterId: 1,
            id: "shared-facet-entity",
            qid: "QSharedFacet",
            rangeEnd: 11,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "SharedFacet",
          });
        });
        await rebuildArchiveSearchIndex(document);

        const chapter = await querySearchIndex(document, "SharedFacet", {
          types: ["chapter-title"],
        });
        const node = await querySearchIndex(document, "SharedFacet", {
          types: ["node"],
        });
        const entity = await querySearchIndex(document, "SharedFacet", {
          types: ["entity"],
        });

        expect(
          new Set(chapter?.objectHits.map((hit) => hit.ownerKind)),
        ).toEqual(new Set([SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter]));
        expect(new Set(node?.objectHits.map((hit) => hit.ownerKind))).toEqual(
          new Set([SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk]),
        );
        expect(new Set(entity?.objectHits.map((hit) => hit.ownerKind))).toEqual(
          new Set([SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity]),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("caches empty search results for repeated queries", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const first = await findArchiveObjects(document, "缓存空结果", {
          archiveKey: `${path}/book.wikg`,
          types: ["entity"],
        });
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.save({
            chapterId: 1,
            id: "late-empty-cache-hit",
            qid: "Q1",
            rangeEnd: 5,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "缓存空结果",
          });
        });
        const second = await findArchiveObjects(document, "缓存空结果", {
          archiveKey: `${path}/book.wikg`,
          types: ["entity"],
        });

        expect(first.items).toStrictEqual([]);
        expect(second.items).toStrictEqual([]);
      } finally {
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("keeps search caches isolated by type and chapter filters", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(2)
            .createDraft();

          draft.addSentence("Cache Split appears in chapter two.", 6);
          await draft.commit();
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "cache-split-one",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Cache Split",
            },
            {
              chapterId: 2,
              id: "cache-split-two",
              qid: "Q2",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Cache Split",
            },
          ]);
          await openedDocument.replaceToc({
            items: [
              {
                children: [],
                serialId: 1,
                title: "Introduction",
              },
              {
                children: [],
                serialId: 2,
                title: "Second",
              },
            ],
            version: 1,
          });
        });
        const archiveKey = `${path}/book.wikg`;
        await rebuildArchiveSearchIndex(document, { chapters: [1] });
        const chapterOne = await findArchiveObjects(document, "Cache Split", {
          archiveKey,
          chapters: [1],
          types: ["entity"],
        });
        await rebuildArchiveSearchIndex(document, { chapters: [2] });
        const chapterTwo = await findArchiveObjects(document, "Cache Split", {
          archiveKey,
          chapters: [2],
          types: ["entity"],
        });
        const sourceOnly = await findArchiveObjects(document, "Cache Split", {
          archiveKey,
          chapters: [2],
          types: ["source"],
        });

        expect(chapterOne.items.map((item) => item.id)).toStrictEqual([
          "wikg://entity/Q1",
        ]);
        expect(chapterTwo.items.map((item) => item.id)).toStrictEqual([
          "wikg://entity/Q2",
        ]);
        expect(sourceOnly.items.map((item) => item.type)).toStrictEqual([
          "source",
        ]);
        await expect(
          countStructuredCacheRowsForQuery(`${path}/state`, "Cache Split", [
            "source",
          ]),
        ).resolves.toBe(0);
        await expect(
          countSearchSessionsForQuery(`${path}/state`, "Cache Split", [
            "source",
          ]),
        ).resolves.toBe(0);
      } finally {
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("groups field-level hits into one object search result", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.chunks.save({
            content: "SharedTerm appears in content too.",
            generation: 0,
            id: 300,
            label: "SharedTerm label",
            sentenceId: [1, 0],
            sentenceIds: [[1, 0]],
            wordsCount: 5,
            weight: 1,
          });
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "SharedTerm", {
          archiveKey: `${path}/book.wikg`,
          types: ["node"],
        });

        expect(result.items).toStrictEqual([
          expect.objectContaining({
            id: "node:300",
            type: "node",
          }),
        ]);
      } finally {
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("refreshes cached search results after archive cache invalidation", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        const archiveKey = `${path}/book.wikg`;

        const first = await findArchiveObjects(document, "Invalidate Me", {
          archiveKey,
          types: ["entity"],
        });
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.save({
            chapterId: 1,
            id: "invalidate-me",
            qid: "Q1",
            rangeEnd: 13,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "Invalidate Me",
          });
        });
        await rebuildArchiveSearchIndex(document);
        await deleteArchiveSearchSessions(archiveKey);
        const second = await findArchiveObjects(document, "Invalidate Me", {
          archiveKey,
          types: ["entity"],
        });

        expect(first.items).toStrictEqual([]);
        expect(second.items).toStrictEqual([
          expect.objectContaining({
            id: "wikg://entity/Q1",
            title: "Invalidate Me",
            type: "entity",
          }),
        ]);
      } finally {
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });
});

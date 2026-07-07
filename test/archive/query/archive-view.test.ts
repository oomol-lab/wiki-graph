import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Database, DirectoryDocument } from "../../../src/document/index.js";
import {
  findArchiveObjects,
  grepArchiveObjects,
  isArchiveSearchIndexCurrent,
  listArchiveCollection,
  listArchiveEvidence,
  listArchiveObjects,
  packArchiveContext,
  listRelatedArchiveObjects,
  readArchiveText,
  readArchivePage,
  rebuildArchiveSearchIndex,
} from "../../../src/archive/query/archive-view.js";
import {
  isSearchIndexCurrent,
  querySearchIndex,
  readArchiveIndexSettings,
  SEARCH_INDEX_FTS_HIT_LIMIT,
} from "../../../src/archive/search-index/index.js";
import { deleteArchiveSearchSessions } from "../../../src/archive/query/search-cache.js";
import { withTempDir } from "../../helpers/temp.js";

const originalStateDir = process.env.WIKIGRAPH_STATE_DIR;
let testStateDir: string | undefined;

describe("archive/query/archive-view", () => {
  beforeEach(async () => {
    testStateDir = await mkdtemp(join(tmpdir(), "spinedigest-state-"));
    process.env.WIKIGRAPH_STATE_DIR = testStateDir;
  });

  afterEach(async () => {
    restoreEnv("WIKIGRAPH_STATE_DIR", originalStateDir);
    if (testStateDir !== undefined) {
      await rm(testStateDir, { force: true, recursive: true });
      testStateDir = undefined;
    }
  });

  it("distinguishes a missing index from a current empty index", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await expect(readArchiveIndexSettings(document)).resolves.toStrictEqual(
          {
            ftsEmbedded: false,
          },
        );
        await expect(isSearchIndexCurrent(document)).resolves.toBe(false);

        await rebuildArchiveSearchIndex(document);

        await expect(isSearchIndexCurrent(document)).resolves.toBe(true);
        await expect(countSearchIndexRows(document)).resolves.toBe(0);
      } finally {
        await document.release();
      }
    });
  });

  it("marks the FTS index outdated when indexed content changes without a chapters revision bump", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("Original indexed sentence.", 3);
          await draft.commit();
          await openedDocument.writeToc({
            items: [{ children: [], serialId: 1, title: "Indexed" }],
            version: 1,
          });
        });
        await rebuildArchiveSearchIndex(document);

        await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(true);

        await document.openSession(async (openedDocument) => {
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("New sentence after index build.", 5);
          await draft.commit();
        });

        await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
          false,
        );
      } finally {
        await document.release();
      }
    });
  });

  it("rejects search when the FTS index is missing", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await expect(findArchiveObjects(document, "missing")).rejects.toThrow(
          "Wiki Graph search index is missing or outdated. Run `<archive-uri>/index enable` before searching.",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("rejects evidence and related queries when the FTS index is missing", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("Alpha relates to beta.", 4);
          await draft.commit();
          await openedDocument.writeToc({
            items: [{ children: [], serialId: 1, title: "Missing index" }],
            version: 1,
          });
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "missing-index-source",
              qid: "Q1",
              rangeEnd: 5,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Alpha",
            },
            {
              chapterId: 1,
              id: "missing-index-target",
              qid: "Q2",
              rangeEnd: 20,
              rangeStart: 17,
              sentenceIndex: 0,
              surface: "beta",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceSentenceIds: [[1, 0]],
            id: "missing-index-link",
            predicate: "relates",
            sourceMentionId: "missing-index-source",
            targetMentionId: "missing-index-target",
          });
        });

        await expect(
          listArchiveEvidence(document, "wikg://entity/Q1", {
            query: "Alpha",
          }),
        ).rejects.toThrow(
          "Wiki Graph search index is missing or outdated. Run `<archive-uri>/index enable` before searching.",
        );
        await expect(
          listRelatedArchiveObjects(document, "wikg://entity/Q1", {
            query: "beta",
            role: "subject",
          }),
        ).rejects.toThrow(
          "Wiki Graph search index is missing or outdated. Run `<archive-uri>/index enable` before searching.",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("searches sourced sentences before graph or summary build", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

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
            id: "wikg://chapter/1/source#1..3",
            position: {
              chapter: 1,
              sentence: 0,
            },
            type: "source",
          }),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("renders source text from the stored text stream without sentence newlines", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);
      const sourceText = "Alpha one.\n\nBeta two.";

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.getSerialFragments(1).writeTextStream(sourceText);
          await openedDocument.writeToc({
            items: [{ children: [], serialId: 1, title: "Chapter 1" }],
            version: 1,
          });
        });

        const fullPage = await readArchivePage(
          document,
          "wikg://chapter/1/source",
        );
        const rangePage = await readArchivePage(
          document,
          "wikg://chapter/1/source#1..2",
        );

        expect(fullPage.type).toBe("fragment");
        expect(rangePage.type).toBe("fragment");
        if (fullPage.type !== "fragment" || rangePage.type !== "fragment") {
          throw new Error("Expected source fragment pages");
        }
        expect(fullPage.fragment.text).toBe(sourceText);
        expect(rangePage.fragment.text).toBe(sourceText);
      } finally {
        await document.release();
      }
    });
  });

  it("coalesces expanded text search hits within a result page", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
            items: [{ children: [], serialId: 1, title: "Chapter 1" }],
            version: 1,
          });
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "Alice");

        expect(result.items).toStrictEqual([
          expect.objectContaining({
            field: "source",
            id: "wikg://chapter/1/source#1..3",
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const result = await findArchiveObjects(
          document,
          "朱元璋 不存在的关键词",
        );

        expect(result.match).toBe("any");
        const sourceHit = result.items.find(
          (item) => item.id === "wikg://chapter/1/source#1..3",
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
          "wikg://chapter/1/source#2",
          "wikg://chapter/1/source#1",
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
                serialId: 1,
                title: "alpha appears in a weak chapter",
              },
              {
                children: [],
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
          "chapter-title:2",
          "chapter-title:1",
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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

  it("caches empty search results for repeated queries", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
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
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("keeps search caches isolated by type and chapter filters", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
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
        await rebuildArchiveSearchIndex(document);

        const archiveKey = `${path}/book.wikg`;
        const chapterOne = await findArchiveObjects(document, "Cache Split", {
          archiveKey,
          chapters: [1],
          types: ["entity"],
        });
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
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("groups field-level hits into one object search result", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
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
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("refreshes cached search results after archive cache invalidation", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
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
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("prioritizes entity matches before source hits", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(2)
            .createDraft();

          draft.addSentence("Limited Entity appears later.", 5);
          await draft.commit();
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "entity-augustine",
              qid: "Q8018",
              rangeEnd: 15,
              rangeStart: 4,
              sentenceIndex: 0,
              surface: "Augustine",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "Augustine", {
          evidenceLimit: 3,
        });

        expect(result.items).toMatchObject([
          {
            evidence: {
              nextCursor: null,
              shown: 1,
              sources: [
                expect.objectContaining({
                  id: "wikg://chapter/1/source#1..3",
                  source:
                    "An LLM Wiki exposes pages, links, and source fragments to agents.朱元璋知道了这个消息，随后亲自来到洪都。Source-only archives should be searchable.",
                }),
              ],
              total: 1,
            },
            id: "wikg://entity/Q8018",
            title: "Augustine",
            type: "entity",
          },
        ]);
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("keeps entity results ahead of high-frequency source matches", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("陈友谅 陈友谅 陈友谅 陈友谅 陈友谅。", 5);
          await draft.commit();
          await openedDocument.mentions.save({
            chapterId: 1,
            id: "mention-chen",
            qid: "Q1336609",
            rangeEnd: 3,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "陈友谅",
          });
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "陈友谅", {
          limit: 3,
        });

        expect(result.items[0]).toMatchObject({
          id: "wikg://entity/Q1336609",
          title: "陈友谅",
          type: "entity",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("hydrates entity evidence after reading a search session page", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "entity-wiki",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 7,
              sentenceIndex: 0,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "entity-source",
              qid: "Q2",
              rangeEnd: 44,
              rangeStart: 38,
              sentenceIndex: 2,
              surface: "Source",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const firstPage = await findArchiveObjects(document, "Wiki Source", {
          evidenceLimit: 3,
          limit: 1,
          types: ["entity"],
        });
        const secondPage = await findArchiveObjects(document, "ignored", {
          ...(firstPage.nextCursor === null
            ? {}
            : { cursor: firstPage.nextCursor }),
          evidenceLimit: 3,
          limit: 1,
          types: ["entity"],
        });

        expect(firstPage.items[0]).toMatchObject({
          evidence: {
            shown: 1,
            sources: [expect.objectContaining({ type: "source" })],
            total: 1,
          },
          type: "entity",
        });
        expect(secondPage.items[0]).toMatchObject({
          evidence: {
            shown: 1,
            sources: [expect.objectContaining({ type: "source" })],
            total: 1,
          },
          type: "entity",
        });
        expect(JSON.stringify(firstPage.items)).not.toContain(
          "evidenceMentions",
        );
        expect(JSON.stringify(secondPage.items)).not.toContain(
          "evidenceMentions",
        );
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("continues entity search cursors without repeating --type", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "entity-wiki",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 7,
              sentenceIndex: 0,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "entity-source",
              qid: "Q2",
              rangeEnd: 44,
              rangeStart: 38,
              sentenceIndex: 2,
              surface: "Source",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const firstPage = await findArchiveObjects(document, "Wiki Source", {
          limit: 1,
          types: ["entity"],
        });
        const secondPage = await findArchiveObjects(document, "ignored", {
          ...(firstPage.nextCursor === null
            ? {}
            : { cursor: firstPage.nextCursor }),
          limit: 1,
        });

        await expect(
          findArchiveObjects(document, "ignored", {
            ...(firstPage.nextCursor === null
              ? {}
              : { cursor: firstPage.nextCursor }),
            limit: 1,
            types: ["summary"],
          }),
        ).rejects.toThrow("Search cursor does not match");
        expect(secondPage.types).toStrictEqual(["entity"]);
        expect(secondPage.items[0]).toMatchObject({ type: "entity" });
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("keeps exact entity surfaces ahead of weaker same-qid mentions", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "same-qid-weaker",
              qid: "Q1",
              rangeEnd: 1,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "战船",
            },
            {
              chapterId: 1,
              id: "exact-later",
              qid: "Q1",
              rangeEnd: 3,
              rangeStart: 2,
              sentenceIndex: 1,
              surface: "战舰",
            },
            {
              chapterId: 1,
              id: "other-qid-weaker",
              qid: "Q2",
              rangeEnd: 5,
              rangeStart: 4,
              sentenceIndex: 2,
              surface: "战船",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "战舰", {
          evidenceLimit: 3,
          types: ["entity"],
        });

        expect(result.items[0]).toMatchObject({
          id: "wikg://entity/Q1",
          title: "战舰",
          type: "entity",
        });
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("does not expand entity matches through qid aliases", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "exact",
              qid: "Q1",
              rangeEnd: 2,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "战舰",
            },
            {
              chapterId: 1,
              id: "same-qid-alias",
              qid: "Q1",
              rangeEnd: 5,
              rangeStart: 3,
              sentenceIndex: 1,
              surface: "军舰",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "战舰", {
          evidenceLimit: 3,
          types: ["entity"],
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
          evidence: {
            nextCursor: null,
            total: 1,
          },
          id: "wikg://entity/Q1",
          title: "战舰",
          type: "entity",
        });
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("adds only a small bonus for repeated entity evidence", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            ...Array.from({ length: 10 }, (_, index) => ({
              chapterId: 1,
              id: `multi-${index}`,
              qid: "Q1",
              rangeEnd: index * 2 + 1,
              rangeStart: index * 2,
              sentenceIndex: index,
              surface: "舰",
            })),
            {
              chapterId: 1,
              id: "single",
              qid: "Q2",
              rangeEnd: 31,
              rangeStart: 30,
              sentenceIndex: 10,
              surface: "舰",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "舰", {
          types: ["entity"],
        });
        const multi = result.items.find(
          (item) => item.id === "wikg://entity/Q1",
        );
        const single = result.items.find(
          (item) => item.id === "wikg://entity/Q2",
        );

        expect(multi?.score).toBeGreaterThan(single?.score ?? 0);
        expect(multi?.score).toBeLessThan((single?.score ?? 0) * 5);
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("finds triples when only one endpoint matches the query", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "triple-source",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 7,
              sentenceIndex: 0,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "triple-target",
              qid: "Q2",
              rangeEnd: 44,
              rangeStart: 38,
              sentenceIndex: 2,
              surface: "Source",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceSentenceIds: [[1, 2]],
            id: "triple-link",
            predicate: "mentions",
            sourceMentionId: "triple-source",
            targetMentionId: "triple-target",
          });
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "Wiki", {
          evidenceLimit: 3,
          triplePattern: { subjectQid: "Q1" },
          types: ["triple"],
        });

        const triple = result.items.find(
          (item) => item.id === "wikg://triple/Q1/mentions/Q2",
        );

        expect(triple).toMatchObject({
          id: "wikg://triple/Q1/mentions/Q2",
          title: "Wiki mentions Source",
          type: "triple",
        });
        expect(triple?.evidence?.total).toBe(1);
        expect(triple?.evidence?.sources).toStrictEqual([
          expect.objectContaining({
            id: "wikg://chapter/1/source#1..3",
            source:
              "An LLM Wiki exposes pages, links, and source fragments to agents.朱元璋知道了这个消息，随后亲自来到洪都。Source-only archives should be searchable.",
          }),
        ]);

        const filtered = await findArchiveObjects(document, "Wiki", {
          triplePattern: { objectQid: "Q1" },
          types: ["triple"],
        });

        expect(filtered.items).toStrictEqual([]);
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("adds only a small bonus for repeated triple evidence", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            ...Array.from({ length: 11 }, (_, index) => ({
              chapterId: 1,
              id: `source-${index}`,
              qid: index < 10 ? "Q1" : "Q3",
              rangeEnd: index * 4 + 1,
              rangeStart: index * 4,
              sentenceIndex: index,
              surface: "舰",
            })),
            ...Array.from({ length: 11 }, (_, index) => ({
              chapterId: 1,
              id: `target-${index}`,
              qid: index < 10 ? "Q2" : "Q4",
              rangeEnd: index * 4 + 3,
              rangeStart: index * 4 + 2,
              sentenceIndex: index,
              surface: "队",
            })),
          ]);
          await openedDocument.mentionLinks.saveMany(
            Array.from({ length: 11 }, (_, index) => ({
              evidenceSentenceIds: [[1, 0]],
              id: `link-${index}`,
              predicate: "supports",
              sourceMentionId: `source-${index}`,
              targetMentionId: `target-${index}`,
            })),
          );
        });
        await rebuildArchiveSearchIndex(document);

        const result = await findArchiveObjects(document, "舰", {
          types: ["triple"],
        });
        const multi = result.items.find(
          (item) => item.id === "wikg://triple/Q1/supports/Q2",
        );
        const single = result.items.find(
          (item) => item.id === "wikg://triple/Q3/supports/Q4",
        );

        expect(multi?.score).toBeCloseTo((single?.score ?? 0) * 1.3, 10);
      } finally {
        restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
        await document.release();
      }
    });
  });

  it("supports all-keyword find matching when requested", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const noMatch = await findArchiveObjects(
          document,
          "朱元璋 不存在的关键词",
          { match: "all" },
        );
        const result = await findArchiveObjects(document, "朱元璋 亲自 来到", {
          match: "all",
        });

        expect(noMatch.items).toStrictEqual([]);
        expect(noMatch.match).toBe("all");
        expect(noMatch.terms).toEqual(
          expect.arrayContaining(["朱元璋", "不存在的关键词"]),
        );
        const sourceHit = result.items.find(
          (item) => item.id === "wikg://chapter/1/source#1..3",
        );
        expect(sourceHit).toMatchObject({
          field: "source",
          missingTerms: [],
          type: "source",
        });
        expect(sourceHit?.matchCount).toBeGreaterThanOrEqual(3);
        expect(sourceHit?.matchedTerms).toEqual(
          expect.arrayContaining(["朱元璋", "亲自", "来到"]),
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

        expect(result.lens).toBe("exact");
        expect(result.lensHint).toBeNull();
        expect(result.items).toContainEqual(
          expect.objectContaining({
            field: "source",
            id: "wikg://chapter/1/source#2",
            type: "source",
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
          types: ["source"],
        });

        expect(result.chapters).toStrictEqual([1]);
        expect(result.lens).toBe("typed");
        expect(result.lensHint).toBeNull();
        expect(result.types).toStrictEqual(["source"]);
        expect(result.items).toStrictEqual([
          expect.objectContaining({
            chapter: 1,
            id: "wikg://chapter/1/source#1",
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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

  it("reads chapter title and state as separate objects", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
    await withTempDir("spinedigest-archive-view-", async (path) => {
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

  it("lists objects as a pageable collection", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(2)
            .createDraft();

          draft.addSentence("Second chapter repeats LLM Wiki.", 5);
          await draft.commit();
          await openedDocument.chunks.save({
            content: "Second chapter chunk.",
            generation: 0,
            id: 200,
            label: "Second chunk",
            sentenceId: [2, 0],
            sentenceIds: [[2, 0]],
            wordsCount: 3,
            weight: 1,
          });
          await openedDocument.writeSummary(2, "Second summary.");
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "m1",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "LLM Wiki",
            },
            {
              chapterId: 2,
              id: "m2",
              qid: "Q1",
              rangeEnd: 26,
              rangeStart: 15,
              sentenceIndex: 0,
              surface: "LLM Wiki",
            },
            {
              chapterId: 2,
              id: "m3",
              qid: "Q2",
              rangeEnd: 14,
              rangeStart: 7,
              sentenceIndex: 0,
              surface: "chapter",
            },
            {
              chapterId: 2,
              id: "m4",
              qid: "Q3",
              rangeEnd: 6,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Second",
            },
          ]);
          await openedDocument.mentionLinks.saveMany([
            {
              evidenceSentenceIds: [[2, 0]],
              id: "l1",
              predicate: "mentions",
              sourceMentionId: "m2",
              targetMentionId: "m3",
            },
            {
              evidenceSentenceIds: [[2, 0]],
              id: "l2",
              predicate: "mentions",
              sourceMentionId: "m2",
              targetMentionId: "m3",
            },
            {
              evidenceSentenceIds: [[2, 0]],
              id: "l3",
              predicate: "before",
              sourceMentionId: "m4",
              targetMentionId: "m2",
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

        const result = await listArchiveCollection(document, {
          chapters: [1],
          types: [
            "chapter-title",
            "entity",
            "source",
            "node",
            "summary",
            "triple",
          ],
        });

        expect(result.items.map((item) => item.id)).toEqual(
          expect.arrayContaining([
            "chapter-title:1",
            "wikg://entity/Q1",
            "node:100",
            "node:101",
          ]),
        );
        expect(result.items.map((item) => item.id)).not.toEqual(
          expect.arrayContaining([
            "chapter-title:2",
            "node:200",
            "wikg://chapter/2/summary#1",
            "wikg://triple/Q1/mentions/Q2",
          ]),
        );

        const scopedSecond = await listArchiveCollection(document, {
          chapters: [2],
          types: ["entity", "triple"],
        });

        expect(scopedSecond.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              chapter: 2,
              id: "wikg://entity/Q1",
              type: "entity",
            }),
            expect.objectContaining({
              chapter: 2,
              id: "wikg://triple/Q1/mentions/Q2",
              type: "triple",
            }),
          ]),
        );
        expect(
          scopedSecond.items
            .filter((item) => item.type === "triple")
            .map((item) => item.id),
        ).toEqual([
          "wikg://triple/Q1/mentions/Q2",
          "wikg://triple/Q3/before/Q1",
        ]);

        const objectPattern = await listArchiveCollection(document, {
          chapters: [2],
          triplePattern: { objectQid: "Q1" },
          types: ["triple"],
        });

        expect(objectPattern.items.map((item) => item.id)).toStrictEqual([
          "wikg://triple/Q3/before/Q1",
        ]);

        const scopedSecondWithEvidence = await listArchiveCollection(document, {
          chapters: [2],
          evidenceLimit: 1,
          types: ["entity"],
        });
        const entityWithEvidence = scopedSecondWithEvidence.items.find(
          (item) => item.id === "wikg://entity/Q1",
        );

        expect(entityWithEvidence?.type).toBe("entity");
        expect(entityWithEvidence?.evidence?.shown).toBe(1);
        expect(entityWithEvidence?.evidence?.sources[0]?.id).toBe(
          "wikg://chapter/2/source#1",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("sorts entity related triples with list-mode frequency", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "related-source-low",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "LLM Wiki",
            },
            {
              chapterId: 1,
              id: "related-target-low",
              qid: "Q2",
              rangeEnd: 48,
              rangeStart: 42,
              sentenceIndex: 0,
              surface: "agents",
            },
            {
              chapterId: 1,
              id: "related-source-high-one",
              qid: "Q1",
              rangeEnd: 4,
              rangeStart: 0,
              sentenceIndex: 1,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "related-source-high-two",
              qid: "Q1",
              rangeEnd: 4,
              rangeStart: 0,
              sentenceIndex: 2,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "related-target-high",
              qid: "Q3",
              rangeEnd: 16,
              rangeStart: 7,
              sentenceIndex: 1,
              surface: "fragments",
            },
          ]);
          await openedDocument.mentionLinks.saveMany([
            {
              evidenceSentenceIds: [[1, 0]],
              id: "a-low-frequency-link",
              predicate: "mentions",
              sourceMentionId: "related-source-low",
              targetMentionId: "related-target-low",
            },
            {
              evidenceSentenceIds: [[1, 1]],
              id: "z-high-frequency-link-1",
              predicate: "mentions",
              sourceMentionId: "related-source-high-one",
              targetMentionId: "related-target-high",
            },
            {
              evidenceSentenceIds: [[1, 2]],
              id: "z-high-frequency-link-2",
              predicate: "mentions",
              sourceMentionId: "related-source-high-two",
              targetMentionId: "related-target-high",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const related = await listRelatedArchiveObjects(
          document,
          "wikg://entity/Q1",
          { role: "subject" },
        );

        expect(related.items.map((item) => item.id)).toStrictEqual([
          "wikg://triple/Q1/mentions/Q3",
          "wikg://triple/Q1/mentions/Q2",
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("breaks related triple frequency ties by sentence position", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "tie-source-later",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 2,
              surface: "LLM Wiki",
            },
            {
              chapterId: 1,
              id: "tie-target-later",
              qid: "Q2",
              rangeEnd: 48,
              rangeStart: 42,
              sentenceIndex: 2,
              surface: "agents",
            },
            {
              chapterId: 1,
              id: "tie-source-earlier",
              qid: "Q1",
              rangeEnd: 4,
              rangeStart: 0,
              sentenceIndex: 1,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "tie-target-earlier",
              qid: "Q3",
              rangeEnd: 16,
              rangeStart: 7,
              sentenceIndex: 1,
              surface: "fragments",
            },
          ]);
          await openedDocument.mentionLinks.saveMany([
            {
              evidenceSentenceIds: [[1, 2]],
              id: "a-later-sentence-link",
              predicate: "mentions",
              sourceMentionId: "tie-source-later",
              targetMentionId: "tie-target-later",
            },
            {
              evidenceSentenceIds: [[1, 1]],
              id: "z-earlier-sentence-link",
              predicate: "mentions",
              sourceMentionId: "tie-source-earlier",
              targetMentionId: "tie-target-earlier",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const related = await listRelatedArchiveObjects(
          document,
          "wikg://entity/Q1",
          { role: "subject" },
        );

        expect(related.items.map((item) => item.id)).toStrictEqual([
          "wikg://triple/Q1/mentions/Q3",
          "wikg://triple/Q1/mentions/Q2",
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("filters and sorts entity related triples by query text", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "query-source-early",
              qid: "Q1",
              rangeEnd: 4,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "query-target-weak",
              qid: "Q2",
              rangeEnd: 20,
              rangeStart: 10,
              sentenceIndex: 0,
              surface: "agent",
            },
            {
              chapterId: 1,
              id: "query-source-late",
              qid: "Q1",
              rangeEnd: 4,
              rangeStart: 0,
              sentenceIndex: 1,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "query-target-strong",
              qid: "Q3",
              rangeEnd: 24,
              rangeStart: 10,
              sentenceIndex: 1,
              surface: "agent agent",
            },
            {
              chapterId: 1,
              id: "query-source-unmatched",
              qid: "Q1",
              rangeEnd: 4,
              rangeStart: 0,
              sentenceIndex: 2,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "query-target-unmatched",
              qid: "Q4",
              rangeEnd: 24,
              rangeStart: 10,
              sentenceIndex: 2,
              surface: "fragments",
            },
          ]);
          await openedDocument.mentionLinks.saveMany([
            {
              evidenceSentenceIds: [[1, 0]],
              id: "query-link-weak",
              predicate: "mentions",
              sourceMentionId: "query-source-early",
              targetMentionId: "query-target-weak",
            },
            {
              evidenceSentenceIds: [[1, 1]],
              id: "query-link-strong",
              predicate: "mentions",
              sourceMentionId: "query-source-late",
              targetMentionId: "query-target-strong",
            },
            {
              evidenceSentenceIds: [[1, 2]],
              id: "query-link-unmatched",
              predicate: "mentions",
              sourceMentionId: "query-source-unmatched",
              targetMentionId: "query-target-unmatched",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const related = await listRelatedArchiveObjects(
          document,
          "wikg://entity/Q1",
          { query: "agent", role: "subject" },
        );

        expect(related.items.map((item) => item.id)).toStrictEqual([
          "wikg://triple/Q1/mentions/Q2",
          "wikg://triple/Q1/mentions/Q3",
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("does not match entity related query against the anchor mention surface", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("Alpha appears as the anchor mention.", 6);
          draft.addSentence("The relationship evidence omits that name.", 6);
          await draft.commit();
          await openedDocument.writeToc({
            items: [{ children: [], serialId: 1, title: "Related" }],
            version: 1,
          });
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "anchor-surface-source",
              qid: "Q1",
              rangeEnd: 5,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Alpha",
            },
            {
              chapterId: 1,
              id: "anchor-surface-target",
              qid: "Q2",
              rangeEnd: 15,
              rangeStart: 10,
              sentenceIndex: 1,
              surface: "Beta",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceSentenceIds: [[1, 1]],
            id: "anchor-surface-link",
            predicate: "relates",
            sourceMentionId: "anchor-surface-source",
            targetMentionId: "anchor-surface-target",
          });
        });
        await rebuildArchiveSearchIndex(document);

        const related = await listRelatedArchiveObjects(
          document,
          "wikg://entity/Q1",
          { query: "Alpha", role: "subject" },
        );

        expect(related.items).toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("filters chunk related results through chunk property FTS", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.readingEdges.save({
            fromId: 100,
            toId: 101,
            weight: 1,
          });
        });

        const related = await listRelatedArchiveObjects(
          document,
          "wikg://chunk/100",
          { query: "Source search" },
        );

        expect(related.items.map((item) => item.id)).toStrictEqual([
          "node:101",
        ]);
        expect(related.items[0]?.score).toBeGreaterThan(0);
      } finally {
        await document.release();
      }
    });
  });

  it("matches entity related query against mention link evidence sentences", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "sentence-query-source",
              qid: "Q1",
              rangeEnd: 4,
              rangeStart: 0,
              sentenceIndex: 1,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "sentence-query-target",
              qid: "Q2",
              rangeEnd: 20,
              rangeStart: 10,
              sentenceIndex: 1,
              surface: "archive",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceSentenceIds: [[1, 1]],
            id: "sentence-query-link",
            predicate: "mentions",
            sourceMentionId: "sentence-query-source",
            targetMentionId: "sentence-query-target",
          });
        });
        await rebuildArchiveSearchIndex(document);

        const related = await listRelatedArchiveObjects(
          document,
          "wikg://entity/Q1",
          { query: "朱元璋", role: "subject" },
        );

        expect(related.items).toMatchObject([
          {
            id: "wikg://triple/Q1/mentions/Q2",
            score: expect.any(Number) as number,
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("matches entity related triples by mention-link evidence text", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "evidence-related-source",
              qid: "Q1",
              rangeEnd: 4,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              id: "evidence-related-target",
              qid: "Q2",
              rangeEnd: 20,
              rangeStart: 10,
              sentenceIndex: 0,
              surface: "agent",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceSentenceIds: [[1, 1]],
            id: "evidence-related-link",
            predicate: "mentions",
            sourceMentionId: "evidence-related-source",
            targetMentionId: "evidence-related-target",
          });
        });
        await rebuildArchiveSearchIndex(document);

        const related = await listRelatedArchiveObjects(
          document,
          "wikg://entity/Q1",
          { query: "朱元璋", role: "subject" },
        );

        expect(related.items.map((item) => item.id)).toStrictEqual([
          "wikg://triple/Q1/mentions/Q2",
        ]);
        expect(related.items[0]?.score).toBeGreaterThan(0);
      } finally {
        await document.release();
      }
    });
  });

  it("rejects malformed top-level chunk and entity URIs", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(
          readArchivePage(document, "wikg://chunk/100/extra"),
        ).rejects.toThrow("Invalid Wiki Graph URI");
        await expect(
          readArchivePage(document, "wikg://entity/Q1/extra"),
        ).rejects.toThrow("Invalid Wiki Graph URI");
      } finally {
        await document.release();
      }
    });
  });

  it("applies evidence limits when reading entity pages", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "limited-one",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Limited Entity",
            },
            {
              chapterId: 2,
              id: "limited-two",
              qid: "Q1",
              rangeEnd: 12,
              rangeStart: 0,
              sentenceIndex: 1,
              surface: "Limited Entity",
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

        const page = await readArchivePage(document, "wikg://entity/Q1", {
          evidenceLimit: 1,
        });

        expect(page.type).toBe("entity");
        if (page.type !== "entity") {
          throw new Error("Expected entity page.");
        }
        expect(page.evidence.shown).toBe(1);
        expect(page.evidence.total).toBe(2);
        expect(page.evidence.nextCursor).not.toBeNull();
      } finally {
        await document.release();
      }
    });
  });

  it("reads archive objects as continuous text", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(readArchiveText(document, "chapter:1")).rejects.toThrow(
          "scope URI",
        );
        await expect(
          readArchiveText(document, "chapter-title:1"),
        ).resolves.toBe("Introduction");
        await expect(readArchiveText(document, "node:100")).resolves.toBe(
          "Pages and links make archive navigation explicit.",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("returns source evidence for chunks, entities, and triples", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await document.openSession(async (openedDocument) => {
          const secondDraft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          secondDraft.addSentence("First unrelated fragment sentence.", 4);
          secondDraft.addSentence("Second fragment mentions Augustine.", 4);
          secondDraft.addSentence("Third unrelated fragment sentence.", 4);
          await secondDraft.commit();
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "m1",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "LLM Wiki",
            },
            {
              chapterId: 1,
              id: "m2",
              qid: "Q2",
              rangeEnd: 48,
              rangeStart: 42,
              sentenceIndex: 0,
              surface: "agents",
            },
            {
              chapterId: 1,
              id: "m3",
              qid: "Q3",
              rangeEnd: 60,
              rangeStart: 35,
              sentenceIndex: 4,
              surface: "Augustine",
            },
            {
              chapterId: 1,
              id: "m4",
              qid: "Q4",
              rangeEnd: 130,
              rangeStart: 112,
              sentenceIndex: 2,
              surface: "searchable",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceSentenceIds: [[1, 0]],
            id: "l1",
            predicate: "mentions",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          });
        });

        await expect(
          listArchiveEvidence(document, "wikg://chunk/100"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikg://chapter/1/source#1..3",
              source:
                "An LLM Wiki exposes pages, links, and source fragments to agents.朱元璋知道了这个消息，随后亲自来到洪都。Source-only archives should be searchable.",
              type: "source",
            },
          ],
        });
        await expect(
          listArchiveEvidence(document, "wikg://chunk/100", {
            sourceContext: 0,
          }),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikg://chapter/1/source#1",
              source:
                "An LLM Wiki exposes pages, links, and source fragments to agents.",
              type: "source",
            },
          ],
        });
        await expect(
          listArchiveEvidence(document, "wikg://entity/Q1"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikg://chapter/1/source#1..3",
              type: "source",
            },
          ],
        });
        await expect(
          listArchiveEvidence(document, "wikg://triple/Q1/mentions/Q2"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikg://chapter/1/source#1..3",
              type: "source",
            },
          ],
        });
        await expect(
          readArchivePage(document, "wikg://entity/Q1"),
        ).resolves.toMatchObject({
          evidence: {
            shown: 1,
            sources: [
              {
                id: "wikg://chapter/1/source#1..3",
                type: "source",
              },
            ],
            total: 1,
          },
          id: "wikg://entity/Q1",
          label: "LLM Wiki",
          labels: ["LLM Wiki"],
          mentionCount: 1,
          qid: "Q1",
          type: "entity",
        });
        await expect(
          readArchivePage(document, "wikg://triple/Q1/mentions/Q2"),
        ).resolves.toMatchObject({
          evidence: {
            shown: 1,
            sources: [
              {
                id: "wikg://chapter/1/source#1..3",
                type: "source",
              },
            ],
            total: 1,
          },
          id: "wikg://triple/Q1/mentions/Q2",
          objectQid: "Q2",
          predicate: "mentions",
          subjectQid: "Q1",
          type: "triple",
        });
        await expect(
          packArchiveContext(document, "wikg://entity/Q1", 1000),
        ).resolves.toMatchObject({
          anchor: {
            id: "wikg://entity/Q1",
            type: "entity",
          },
          budget: 1000,
          related: [
            {
              id: "wikg://triple/Q1/mentions/Q2",
              type: "triple",
            },
          ],
        });
        await expect(
          packArchiveContext(document, "wikg://chapter/1/source#1", 1000),
        ).rejects.toThrow(
          "Pack is only available for chunk and entity objects",
        );
        await expect(
          listRelatedArchiveObjects(document, "wikg://entity/Q1"),
        ).resolves.toStrictEqual({
          items: [
            {
              id: "wikg://triple/Q1/mentions/Q2",
              label: "LLM Wiki mentions agents",
              objectLabel: "agents",
              objectQid: "Q2",
              predicate: "mentions",
              subjectLabel: "LLM Wiki",
              subjectQid: "Q1",
              summary: "Q1 mentions Q2",
              type: "triple",
            },
          ],
          limit: 20,
          nextCursor: null,
        });
        await expect(
          listRelatedArchiveObjects(document, "wikg://entity/Q1", {
            evidenceLimit: 1,
            role: "subject",
          }),
        ).resolves.toMatchObject({
          items: [
            {
              evidence: {
                shown: 1,
                sources: [
                  {
                    id: "wikg://chapter/1/source#1..3",
                  },
                ],
                total: 1,
              },
              id: "wikg://triple/Q1/mentions/Q2",
              type: "triple",
            },
          ],
        });
        await expect(
          listRelatedArchiveObjects(document, "wikg://entity/Q1", {
            role: "object",
          }),
        ).resolves.toStrictEqual({
          items: [],
          limit: 20,
          nextCursor: null,
        });
        await expect(
          listRelatedArchiveObjects(document, "wikg://triple/Q1/mentions/Q2"),
        ).rejects.toThrow(
          "Related is only available for chunk and entity objects",
        );
        await expect(
          listArchiveEvidence(document, "wikg://entity/Q3"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikg://chapter/1/source#3..6",
              source:
                "Source-only archives should be searchable.First unrelated fragment sentence.Second fragment mentions Augustine.Third unrelated fragment sentence.",
              type: "source",
            },
          ],
        });
        await expect(
          listArchiveEvidence(document, "wikg://chapter/1/source#5"),
        ).rejects.toThrow("Evidence is not available");
        await expect(
          listArchiveEvidence(document, "wikg://entity/Q4"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikg://chapter/1/source#1..5",
              type: "source",
            },
          ],
        });
      } finally {
        await document.release();
      }
    });
  });

  it("filters evidence by query text", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "evidence-query-first",
              qid: "Q1",
              rangeEnd: 3,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "LLM",
            },
            {
              chapterId: 1,
              id: "evidence-query-second",
              qid: "Q1",
              rangeEnd: 3,
              rangeStart: 0,
              sentenceIndex: 1,
              surface: "朱元璋",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const evidence = await listArchiveEvidence(
          document,
          "wikg://entity/Q1",
          { query: "朱元璋" },
        );

        expect(evidence.items.map((item) => item.id)).toStrictEqual([
          "wikg://chapter/1/source#1..3",
        ]);
        expect(evidence.items[0]?.score).toBeGreaterThan(0);
      } finally {
        await document.release();
      }
    });
  });

  it("does not match triple evidence query against endpoint mention sentences", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("Alpha appears only in the endpoint mention.", 7);
          draft.addSentence(
            "The relation evidence omits that endpoint name.",
            7,
          );
          await draft.commit();
          await openedDocument.writeToc({
            items: [{ children: [], serialId: 1, title: "Triple evidence" }],
            version: 1,
          });
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "triple-endpoint-source",
              qid: "Q1",
              rangeEnd: 5,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Alpha",
            },
            {
              chapterId: 1,
              id: "triple-endpoint-target",
              qid: "Q2",
              rangeEnd: 13,
              rangeStart: 10,
              sentenceIndex: 1,
              surface: "Beta",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceSentenceIds: [[1, 1]],
            id: "triple-endpoint-link",
            predicate: "relates",
            sourceMentionId: "triple-endpoint-source",
            targetMentionId: "triple-endpoint-target",
          });
        });
        await rebuildArchiveSearchIndex(document);

        const evidence = await listArchiveEvidence(
          document,
          "wikg://triple/Q1/relates/Q2",
          { query: "Alpha" },
        );

        expect(evidence.items).toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("keeps query-ranked evidence order after context expansion", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          draft.addSentence("Alpha appears once.", 3);
          draft.addSentence("Filler sentence keeps ranges separate.", 5);
          draft.addSentence("Alpha beta beta beta appears later.", 6);
          await draft.commit();
          await openedDocument.writeToc({
            items: [{ children: [], serialId: 1, title: "Evidence" }],
            version: 1,
          });
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "low-score-first",
              qid: "Q1",
              rangeEnd: 5,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Alpha",
            },
            {
              chapterId: 1,
              id: "high-score-second",
              qid: "Q1",
              rangeEnd: 10,
              rangeStart: 0,
              sentenceIndex: 2,
              surface: "Alpha beta",
            },
          ]);
        });
        await rebuildArchiveSearchIndex(document);

        const evidence = await listArchiveEvidence(
          document,
          "wikg://entity/Q1",
          { query: "Alpha beta", sourceContext: 0 },
        );

        expect(evidence.items.map((item) => item.id)).toStrictEqual([
          "wikg://chapter/1/source#3",
          "wikg://chapter/1/source#1",
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("returns backlinks for source sentence ranges", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              id: "backlink-source",
              qid: "Q1",
              rangeEnd: 12,
              rangeStart: 3,
              sentenceIndex: 0,
              surface: "LLM Wiki",
            },
            {
              chapterId: 1,
              id: "backlink-target",
              qid: "Q2",
              rangeEnd: 63,
              rangeStart: 57,
              sentenceIndex: 0,
              surface: "agents",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceSentenceIds: [[1, 0]],
            id: "backlink-link",
            predicate: "mentions",
            sourceMentionId: "backlink-source",
            targetMentionId: "backlink-target",
          });
        });

        await expect(
          readArchivePage(document, "wikg://chapter/1/source#1", {
            backlinks: true,
          }),
        ).resolves.toMatchObject({
          backlinks: {
            chunks: {
              items: [
                {
                  id: "node:100",
                  type: "node",
                },
              ],
              nextCursor: null,
            },
            entities: {
              items: [
                {
                  id: "wikg://entity/Q1",
                  type: "entity",
                },
                {
                  id: "wikg://entity/Q2",
                  type: "entity",
                },
              ],
              nextCursor: null,
            },
            triples: {
              items: [
                {
                  id: "wikg://triple/Q1/mentions/Q2",
                  type: "triple",
                },
              ],
              nextCursor: null,
            },
          },
          fragment: {
            id: "wikg://chapter/1/source#1",
          },
          type: "fragment",
        });

        const result = await listArchiveCollection(document, {
          backlinks: true,
          limit: 1,
          types: ["source"],
        });

        expect(result.items).toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });
});

async function seedSourcedDocument(
  document: DirectoryDocument,
  options: { readonly withSnake?: boolean } = {},
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.createSerial();
    const draft = await openedDocument.getSerialFragments(1).createDraft();

    draft.addSentence(
      "An LLM Wiki exposes pages, links, and source fragments to agents.",
      10,
    );
    draft.addSentence("朱元璋知道了这个消息，随后亲自来到洪都。", 18);
    draft.addSentence("Source-only archives should be searchable.", 6);
    await draft.commit();
    await openedDocument.chunks.save({
      content: "Pages and links make archive navigation explicit.",
      generation: 0,
      id: 100,
      label: "Wiki pages",
      sentenceId: [1, 0],
      sentenceIds: [[1, 0]],
      wordsCount: 7,
      weight: 1,
    });
    await openedDocument.chunks.save({
      content: "Source search remains available before graph summaries.",
      generation: 0,
      id: 101,
      label: "Source search",
      sentenceId: [1, 2],
      sentenceIds: [[1, 2]],
      wordsCount: 7,
      weight: 1,
    });
    if (options.withSnake !== false) {
      const snakeId = await openedDocument.snakes.create({
        firstLabel: "Wiki pages",
        groupId: 0,
        lastLabel: "Source search",
        localSnakeId: 0,
        serialId: 1,
        size: 2,
        wordsCount: 14,
        weight: 2,
      });
      await openedDocument.snakeChunks.save({
        chunkId: 100,
        position: 0,
        snakeId,
      });
      await openedDocument.snakeChunks.save({
        chunkId: 101,
        position: 1,
        snakeId,
      });
    }
    await openedDocument.writeSummary(1, `Summary ${"detail ".repeat(400)}`);
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
  await rebuildArchiveSearchIndex(document);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function listDocumentTableNames(
  document: DirectoryDocument,
): Promise<string[]> {
  return await document.readDatabase(
    async (database) =>
      await database.queryAll(
        `
          SELECT name
          FROM sqlite_master
          WHERE type IN ('table', 'virtual table')
          ORDER BY name
        `,
        undefined,
        (row) => String(row.name),
      ),
  );
}

async function listSearchIndexTableNames(
  document: DirectoryDocument,
): Promise<string[]> {
  return await document.readSearchIndexDatabase(
    async (database) =>
      await database.queryAll(
        `
          SELECT name
          FROM sqlite_master
          WHERE type IN ('table', 'virtual table')
          ORDER BY name
        `,
        undefined,
        (row) => String(row.name),
      ),
  );
}

async function countSearchIndexRows(
  document: DirectoryDocument,
): Promise<number> {
  return await document.readSearchIndexDatabase(async (database) => {
    const row = await database.queryOne(
      `
        SELECT
          (SELECT COUNT(*) FROM text_sentence_records) +
          (SELECT COUNT(*) FROM search_object_properties_records) AS count
      `,
      undefined,
      (value) => Number(value.count),
    );

    return row ?? 0;
  });
}

async function countStructuredCacheRowsForQuery(
  statePath: string,
  query: string,
  types: readonly string[],
): Promise<number> {
  const database = await Database.open(
    join(statePath, "cache", "search-sessions.sqlite"),
    "",
    { readonly: true },
  );

  try {
    const optionsJSON = JSON.stringify({
      chapters: null,
      order: "doc-asc",
      types,
    });
    const row = await database.queryOne(
      `
        WITH matching_sessions AS (
          SELECT session_id
          FROM search_sessions
          WHERE query = ?
            AND options_json = ?
        )
        SELECT
          (SELECT COUNT(*)
           FROM search_evidence_hit_events
           WHERE session_id IN (SELECT session_id FROM matching_sessions)) +
          (SELECT COUNT(*)
           FROM search_entity_hits
           WHERE session_id IN (SELECT session_id FROM matching_sessions)) +
          (SELECT COUNT(*)
           FROM search_triple_hits
           WHERE session_id IN (SELECT session_id FROM matching_sessions)) +
          (SELECT COUNT(*)
           FROM search_chunk_hits
           WHERE session_id IN (SELECT session_id FROM matching_sessions)) AS count
      `,
      [query, optionsJSON],
      (value) => Number(value.count),
    );

    return row ?? 0;
  } finally {
    await database.close();
  }
}

async function countSearchSessionsForQuery(
  statePath: string,
  query: string,
  types: readonly string[],
): Promise<number> {
  const database = await Database.open(
    join(statePath, "cache", "search-sessions.sqlite"),
    "",
    { readonly: true },
  );

  try {
    const optionsJSON = JSON.stringify({
      chapters: null,
      order: "doc-asc",
      types,
    });
    const row = await database.queryOne(
      `
        SELECT COUNT(*) AS count
        FROM search_sessions
        WHERE query = ?
          AND options_json = ?
      `,
      [query, optionsJSON],
      (value) => Number(value.count),
    );

    return row ?? 0;
  } finally {
    await database.close();
  }
}

function createEntityWikipageMockFetch(): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);

    if (url.hostname === "www.wikidata.org") {
      const language = url.searchParams.get("languages")?.split("|")[0];

      return Promise.resolve(
        new Response(
          JSON.stringify({
            entities: {
              Q1: {
                descriptions: {
                  [language ?? "en"]: {
                    value:
                      language === "zh"
                        ? "明朝军事将领"
                        : "Ming dynasty general",
                  },
                },
                labels: {
                  [language ?? "en"]: {
                    value: language === "zh" ? "徐达" : "Xu Da",
                  },
                },
                sitelinks: {
                  enwiki: { title: "Xu Da" },
                  zhwiki: { title: "徐达" },
                },
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    }

    const titles = url.searchParams.get("titles")?.split("|") ?? [];

    return Promise.resolve(
      new Response(
        JSON.stringify({
          query: {
            pages: titles.map((title, index) => ({
              pageid: index + 1,
              pageprops: {
                wikibase_item: "Q1",
              },
              title,
            })),
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;
}

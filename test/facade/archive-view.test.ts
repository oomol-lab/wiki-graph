import { afterEach, describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import {
  findArchiveObjects,
  grepArchiveObjects,
  listArchiveCollection,
  listArchiveEvidence,
  listArchiveObjects,
  listRelatedArchiveObjects,
  readArchiveText,
  readArchivePage,
} from "../../src/facade/archive-view.js";
import { deleteArchiveSearchSessions } from "../../src/facade/search-cache.js";
import { withTempDir } from "../helpers/temp.js";

const originalStateDir = process.env.WIKIGRAPH_STATE_DIR;

describe("facade/archive-view", () => {
  afterEach(() => {
    restoreEnv("WIKIGRAPH_STATE_DIR", originalStateDir);
  });

  it("searches sourced fragments before graph or summary build", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const result = await findArchiveObjects(document, "Wiki");

        expect(result.lens).toBe("broad");
        expect(result.lensHint).toMatchObject({
          lenses: {
            fragment: "original source wording",
            node: "topology / LLM Wiki structure",
            summary: "quick overview",
          },
        });
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
          (item) => item.id === "fragment:1:0",
        );
        expect(sourceHit).toMatchObject({
          field: "source",
          type: "fragment",
        });
        expect(sourceHit?.matchedTerms).toContain("朱元璋");
        expect(sourceHit?.missingTerms).toContain("不存在的关键词");
      } finally {
        await document.release();
      }
    });
  });

  it("caches empty search results for repeated queries", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const first = await findArchiveObjects(document, "缓存空结果", {
          archiveKey: `${path}/book.sdpub`,
          types: ["entity"],
        });
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.save({
            chapterId: 1,
            fragmentId: 0,
            id: "late-empty-cache-hit",
            qid: "Q1",
            rangeEnd: 5,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "缓存空结果",
          });
        });
        const second = await findArchiveObjects(document, "缓存空结果", {
          archiveKey: `${path}/book.sdpub`,
          types: ["entity"],
        });

        expect(first.items).toStrictEqual([]);
        expect(second.items).toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("keeps search caches isolated by type and chapter filters", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
              fragmentId: 0,
              id: "cache-split-one",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Cache Split",
            },
            {
              chapterId: 2,
              fragmentId: 0,
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

        const archiveKey = `${path}/book.sdpub`;
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
          types: ["fragment"],
        });

        expect(chapterOne.items.map((item) => item.id)).toStrictEqual([
          "wikigraph://entity/Q1",
        ]);
        expect(chapterTwo.items.map((item) => item.id)).toStrictEqual([
          "wikigraph://entity/Q2",
        ]);
        expect(sourceOnly.items.map((item) => item.type)).toStrictEqual([
          "fragment",
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("groups field-level hits into one object search result", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
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
            sentenceId: [1, 0, 0],
            sentenceIds: [[1, 0, 0]],
            wordsCount: 5,
            weight: 1,
          });
        });

        const result = await findArchiveObjects(document, "SharedTerm", {
          archiveKey: `${path}/book.sdpub`,
          types: ["node"],
        });

        expect(result.items).toStrictEqual([
          expect.objectContaining({
            id: "node:300",
            type: "node",
          }),
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("refreshes cached search results after archive cache invalidation", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        const archiveKey = `${path}/book.sdpub`;

        const first = await findArchiveObjects(document, "Invalidate Me", {
          archiveKey,
          types: ["entity"],
        });
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.save({
            chapterId: 1,
            fragmentId: 0,
            id: "invalidate-me",
            qid: "Q1",
            rangeEnd: 13,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "Invalidate Me",
          });
        });
        await deleteArchiveSearchSessions(archiveKey);
        const second = await findArchiveObjects(document, "Invalidate Me", {
          archiveKey,
          types: ["entity"],
        });

        expect(first.items).toStrictEqual([]);
        expect(second.items).toStrictEqual([
          expect.objectContaining({
            id: "wikigraph://entity/Q1",
            title: "Invalidate Me",
            type: "entity",
          }),
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("prioritizes entity matches before source fallback", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              fragmentId: 0,
              id: "entity-augustine",
              qid: "Q8018",
              rangeEnd: 15,
              rangeStart: 4,
              sentenceIndex: 0,
              surface: "Augustine",
            },
          ]);
        });

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
                  id: "wikigraph://chapter/1/source/0#0..0",
                  source:
                    "An LLM Wiki exposes pages, links, and source fragments to agents.",
                }),
              ],
              total: 1,
            },
            id: "wikigraph://entity/Q8018",
            title: "Augustine",
            type: "entity",
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("hydrates entity evidence after reading a search session page", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              fragmentId: 0,
              id: "entity-wiki",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 7,
              sentenceIndex: 0,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              fragmentId: 0,
              id: "entity-source",
              qid: "Q2",
              rangeEnd: 44,
              rangeStart: 38,
              sentenceIndex: 2,
              surface: "Source",
            },
          ]);
        });

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
        await document.release();
      }
    });
  });

  it("continues entity search cursors without repeating --type", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              fragmentId: 0,
              id: "entity-wiki",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 7,
              sentenceIndex: 0,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              fragmentId: 0,
              id: "entity-source",
              qid: "Q2",
              rangeEnd: 44,
              rangeStart: 38,
              sentenceIndex: 2,
              surface: "Source",
            },
          ]);
        });

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
        await document.release();
      }
    });
  });

  it("keeps exact entity surfaces ahead of weaker same-qid mentions", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              fragmentId: 0,
              id: "same-qid-weaker",
              qid: "Q1",
              rangeEnd: 1,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "战船",
            },
            {
              chapterId: 1,
              fragmentId: 0,
              id: "exact-later",
              qid: "Q1",
              rangeEnd: 3,
              rangeStart: 2,
              sentenceIndex: 1,
              surface: "战舰",
            },
            {
              chapterId: 1,
              fragmentId: 0,
              id: "other-qid-weaker",
              qid: "Q2",
              rangeEnd: 5,
              rangeStart: 4,
              sentenceIndex: 2,
              surface: "战船",
            },
          ]);
        });

        const result = await findArchiveObjects(document, "战舰", {
          evidenceLimit: 3,
          types: ["entity"],
        });

        expect(result.items[0]).toMatchObject({
          id: "wikigraph://entity/Q1",
          title: "战舰",
          type: "entity",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("does not expand entity matches through qid aliases", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              fragmentId: 0,
              id: "exact",
              qid: "Q1",
              rangeEnd: 2,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "战舰",
            },
            {
              chapterId: 1,
              fragmentId: 0,
              id: "same-qid-alias",
              qid: "Q1",
              rangeEnd: 5,
              rangeStart: 3,
              sentenceIndex: 1,
              surface: "军舰",
            },
          ]);
        });

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
          id: "wikigraph://entity/Q1",
          title: "战舰",
          type: "entity",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("adds only a small bonus for repeated entity evidence", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            ...Array.from({ length: 10 }, (_, index) => ({
              chapterId: 1,
              fragmentId: 0,
              id: `multi-${index}`,
              qid: "Q1",
              rangeEnd: index * 2 + 1,
              rangeStart: index * 2,
              sentenceIndex: index,
              surface: "舰",
            })),
            {
              chapterId: 1,
              fragmentId: 0,
              id: "single",
              qid: "Q2",
              rangeEnd: 31,
              rangeStart: 30,
              sentenceIndex: 10,
              surface: "舰",
            },
          ]);
        });

        const result = await findArchiveObjects(document, "舰", {
          types: ["entity"],
        });
        const multi = result.items.find(
          (item) => item.id === "wikigraph://entity/Q1",
        );
        const single = result.items.find(
          (item) => item.id === "wikigraph://entity/Q2",
        );

        expect(multi?.score).toBeCloseTo((single?.score ?? 0) * 1.3, 10);
      } finally {
        await document.release();
      }
    });
  });

  it("finds triples when only one endpoint matches the query", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              fragmentId: 0,
              id: "triple-source",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 7,
              sentenceIndex: 0,
              surface: "Wiki",
            },
            {
              chapterId: 1,
              fragmentId: 0,
              id: "triple-target",
              qid: "Q2",
              rangeEnd: 44,
              rangeStart: 38,
              sentenceIndex: 2,
              surface: "Source",
            },
          ]);
          await openedDocument.mentionLinks.save({
            id: "triple-link",
            predicate: "mentions",
            sourceMentionId: "triple-source",
            targetMentionId: "triple-target",
          });
        });

        const result = await findArchiveObjects(document, "Wiki", {
          types: ["triple"],
        });

        expect(result.items).toContainEqual(
          expect.objectContaining({
            id: "wikigraph://triple/Q1/mentions/Q2",
            title: "Wiki mentions Source",
            type: "triple",
          }),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("adds only a small bonus for repeated triple evidence", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.mentions.saveMany([
            ...Array.from({ length: 11 }, (_, index) => ({
              chapterId: 1,
              fragmentId: 0,
              id: `source-${index}`,
              qid: index < 10 ? "Q1" : "Q3",
              rangeEnd: index * 4 + 1,
              rangeStart: index * 4,
              sentenceIndex: index,
              surface: "舰",
            })),
            ...Array.from({ length: 11 }, (_, index) => ({
              chapterId: 1,
              fragmentId: 0,
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
              id: `link-${index}`,
              predicate: "supports",
              sourceMentionId: `source-${index}`,
              targetMentionId: `target-${index}`,
            })),
          );
        });

        const result = await findArchiveObjects(document, "舰", {
          types: ["triple"],
        });
        const multi = result.items.find(
          (item) => item.id === "wikigraph://triple/Q1/supports/Q2",
        );
        const single = result.items.find(
          (item) => item.id === "wikigraph://triple/Q3/supports/Q4",
        );

        expect(multi?.score).toBeCloseTo((single?.score ?? 0) * 1.3, 10);
      } finally {
        await document.release();
      }
    });
  });

  it("falls back to lexical source scan with session cursors", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      process.env.WIKIGRAPH_STATE_DIR = `${path}/state`;
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const firstPage = await findArchiveObjects(document, "Wiki", {
          limit: 1,
        });
        const secondPage = await findArchiveObjects(document, "ignored query", {
          ...(firstPage.nextCursor === null
            ? {}
            : { cursor: firstPage.nextCursor }),
          limit: 1,
        });

        expect(firstPage.items).toHaveLength(1);
        expect(firstPage.nextCursor).not.toBeNull();
        expect(["fragment", "node"]).toContain(firstPage.items[0]?.type);
        expect(secondPage.query).toBe("Wiki");
        expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
      } finally {
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
          (item) => item.id === "fragment:1:0",
        );
        expect(sourceHit).toMatchObject({
          field: "source",
          missingTerms: [],
          type: "fragment",
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
        expect(result.lens).toBe("typed");
        expect(result.lensHint).toBeNull();
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

  it("keeps chapter pages compact for topology exploration", async () => {
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
        expect(page.summary).toContain("Summary");
        expect(page.summaryTruncated).toBe(true);
        expect(JSON.stringify(page)).not.toContain("sourcePreview");
        expect(JSON.stringify(page)).not.toContain("fragments");
        expect(JSON.stringify(page)).not.toContain("position");
        expect(JSON.stringify(page)).not.toContain("span");
        expect(JSON.stringify(page)).not.toContain("weight");
        expect(JSON.stringify(page)).not.toContain("wordsCount");
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

  it("shows chapter node groups and fragment related nodes", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        const chapterPage = await readArchivePage(document, "chapter:1");
        const fragmentPage = await readArchivePage(document, "fragment:1:0");

        expect(chapterPage).toMatchObject({
          nodeCount: 2,
          nodeGroups: [
            expect.objectContaining({
              groupId: 0,
              nodeCount: 2,
              nodes: [
                expect.objectContaining({
                  id: "node:100",
                  title: "Wiki pages",
                }),
                expect.objectContaining({
                  id: "node:101",
                  title: "Source search",
                }),
              ],
            }),
          ],
          type: "chapter",
        });
        expect(fragmentPage).toMatchObject({
          nodes: [
            expect.objectContaining({ id: "node:100", title: "Wiki pages" }),
            expect.objectContaining({ id: "node:101", title: "Source search" }),
          ],
          type: "fragment",
        });
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
        expect(page.sourceFragments[0]?.id).toBe("fragment:1:0");
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

  it("groups chapter nodes by fragment when topology groups are absent", async () => {
    await withTempDir("spinedigest-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document, { withSnake: false });

        const chapterPage = await readArchivePage(document, "chapter:1");

        expect(chapterPage).toMatchObject({
          nodeCount: 2,
          nodeGroups: [
            expect.objectContaining({
              groupId: 0,
              nodeCount: 2,
              nodes: [
                expect.objectContaining({
                  id: "node:100",
                  title: "Wiki pages",
                }),
                expect.objectContaining({
                  id: "node:101",
                  title: "Source search",
                }),
              ],
            }),
          ],
          type: "chapter",
        });
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
            sentenceId: [2, 0, 0],
            sentenceIds: [[2, 0, 0]],
            wordsCount: 3,
            weight: 1,
          });
          await openedDocument.writeSummary(2, "Second summary.");
          await openedDocument.mentions.saveMany([
            {
              chapterId: 1,
              fragmentId: 0,
              id: "m1",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "LLM Wiki",
            },
            {
              chapterId: 2,
              fragmentId: 0,
              id: "m2",
              qid: "Q1",
              rangeEnd: 26,
              rangeStart: 15,
              sentenceIndex: 0,
              surface: "LLM Wiki",
            },
            {
              chapterId: 2,
              fragmentId: 0,
              id: "m3",
              qid: "Q2",
              rangeEnd: 14,
              rangeStart: 7,
              sentenceIndex: 0,
              surface: "chapter",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceEnd: 32,
            evidenceStart: 0,
            id: "l1",
            predicate: "mentions",
            sourceMentionId: "m2",
            targetMentionId: "m3",
          });
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
          types: ["chapter", "entity", "fragment", "node", "summary", "triple"],
        });

        expect(result.items.map((item) => item.id)).toEqual(
          expect.arrayContaining([
            "chapter:1",
            "wikigraph://entity/Q1",
            "fragment:1:0",
            "node:100",
            "node:101",
            "summary:1",
          ]),
        );
        expect(result.items.map((item) => item.id)).not.toEqual(
          expect.arrayContaining([
            "chapter:2",
            "node:200",
            "summary:2",
            "wikigraph://triple/Q1/mentions/Q2",
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
              id: "wikigraph://entity/Q1",
              type: "entity",
            }),
            expect.objectContaining({
              chapter: 2,
              id: "wikigraph://triple/Q1/mentions/Q2",
              type: "triple",
            }),
          ]),
        );
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
          readArchivePage(document, "wikigraph://chunk/100/extra"),
        ).rejects.toThrow("Invalid Wiki Graph URI");
        await expect(
          readArchivePage(document, "wikigraph://entity/Q1/extra"),
        ).rejects.toThrow("Invalid Wiki Graph URI");
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

        await expect(readArchiveText(document, "chapter:1")).resolves.toContain(
          "An LLM Wiki exposes pages",
        );
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
              fragmentId: 0,
              id: "m1",
              qid: "Q1",
              rangeEnd: 11,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "LLM Wiki",
            },
            {
              chapterId: 1,
              fragmentId: 0,
              id: "m2",
              qid: "Q2",
              rangeEnd: 48,
              rangeStart: 42,
              sentenceIndex: 0,
              surface: "agents",
            },
            {
              chapterId: 1,
              fragmentId: 1,
              id: "m3",
              qid: "Q3",
              rangeEnd: 60,
              rangeStart: 35,
              surface: "Augustine",
            },
            {
              chapterId: 1,
              fragmentId: 0,
              id: "m4",
              qid: "Q4",
              rangeEnd: 130,
              rangeStart: 112,
              sentenceIndex: 2,
              surface: "searchable",
            },
          ]);
          await openedDocument.mentionLinks.save({
            evidenceEnd: 65,
            evidenceStart: 0,
            id: "l1",
            predicate: "mentions",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          });
        });

        await expect(
          listArchiveEvidence(document, "wikigraph://chunk/100"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikigraph://chapter/1/source/0#0..0",
              source:
                "An LLM Wiki exposes pages, links, and source fragments to agents.",
              type: "source",
            },
          ],
        });
        await expect(
          listArchiveEvidence(document, "wikigraph://entity/Q1"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikigraph://chapter/1/source/0#0..0",
              type: "source",
            },
          ],
        });
        await expect(
          listArchiveEvidence(document, "wikigraph://triple/Q1/mentions/Q2"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikigraph://chapter/1/source/0#0..0",
              type: "source",
            },
          ],
        });
        await expect(
          readArchivePage(document, "wikigraph://entity/Q1"),
        ).resolves.toMatchObject({
          evidence: {
            shown: 1,
            sources: [
              {
                id: "wikigraph://chapter/1/source/0#0..0",
                type: "source",
              },
            ],
            total: 1,
          },
          id: "wikigraph://entity/Q1",
          label: "LLM Wiki",
          labels: ["LLM Wiki"],
          mentionCount: 1,
          qid: "Q1",
          type: "entity",
        });
        await expect(
          readArchivePage(document, "wikigraph://triple/Q1/mentions/Q2"),
        ).resolves.toMatchObject({
          evidence: {
            shown: 1,
            sources: [
              {
                id: "wikigraph://chapter/1/source/0#0..0",
                type: "source",
              },
            ],
            total: 1,
          },
          id: "wikigraph://triple/Q1/mentions/Q2",
          objectQid: "Q2",
          predicate: "mentions",
          subjectQid: "Q1",
          type: "triple",
        });
        await expect(
          listRelatedArchiveObjects(document, "wikigraph://entity/Q1"),
        ).resolves.toStrictEqual([
          {
            id: "wikigraph://triple/Q1/mentions/Q2",
            label: "LLM Wiki mentions agents",
            objectLabel: "agents",
            objectQid: "Q2",
            predicate: "mentions",
            subjectLabel: "LLM Wiki",
            subjectQid: "Q1",
            summary: "Q1 mentions Q2",
            type: "triple",
          },
        ]);
        await expect(
          listRelatedArchiveObjects(
            document,
            "wikigraph://triple/Q1/mentions/Q2",
          ),
        ).resolves.toStrictEqual([
          {
            id: "wikigraph://entity/Q1",
            label: "LLM Wiki",
            summary: "1 mentions",
            type: "entity",
          },
          {
            id: "wikigraph://entity/Q2",
            label: "agents",
            summary: "1 mentions",
            type: "entity",
          },
        ]);
        await expect(
          listArchiveEvidence(document, "wikigraph://entity/Q3"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikigraph://chapter/1/source/1#1..1",
              source: "Second fragment mentions Augustine.",
              type: "source",
            },
          ],
        });
        await expect(
          listArchiveEvidence(document, "wikigraph://chapter/1/source/1#1..1"),
        ).rejects.toThrow("Evidence is not available");
        await expect(
          listArchiveEvidence(document, "wikigraph://entity/Q4"),
        ).resolves.toMatchObject({
          items: [
            {
              id: "wikigraph://chapter/1/source/0#2..2",
              type: "source",
            },
          ],
        });
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
      sentenceId: [1, 0, 0],
      sentenceIds: [[1, 0, 0]],
      wordsCount: 7,
      weight: 1,
    });
    await openedDocument.chunks.save({
      content: "Source search remains available before graph summaries.",
      generation: 0,
      id: 101,
      label: "Source search",
      sentenceId: [1, 0, 2],
      sentenceIds: [[1, 0, 2]],
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
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

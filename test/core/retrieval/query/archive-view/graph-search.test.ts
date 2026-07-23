import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DirectoryDocument,
  findArchiveObjects,
  getWikiGraphStateDirectoryPathForTesting,
  rebuildArchiveSearchIndex,
  restoreWikiGraphStateDir,
  seedSourcedDocument,
  setWikiGraphStateDirectoryPathForTesting,
  setupArchiveViewTestState,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/graph search", () => {
  it("prioritizes entity matches before source hits", async () => {
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
                  id: "wikg://chapter/introduction/source#1..3",
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
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("keeps entity results ahead of high-frequency source matches", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
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
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("continues entity search cursors without repeating --type", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
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
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("keeps exact entity surfaces ahead of weaker same-qid mentions", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
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
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("does not expand entity matches through qid aliases", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
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
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("adds only a small bonus for repeated entity evidence", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
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
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("finds triples when only one endpoint matches the query", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
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
            id: "wikg://chapter/introduction/source#1..3",
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
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("adds only a small bonus for repeated triple evidence", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const previousStateDir = getWikiGraphStateDirectoryPathForTesting();
      setWikiGraphStateDirectoryPathForTesting(`${path}/state`);
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
        restoreWikiGraphStateDir(previousStateDir);
        await document.release();
      }
    });
  });

  it("supports all-keyword find matching when requested", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
          (item) => item.type === "source" && item.field === "source",
        );
        expect(sourceHit?.id).toMatch(
          /^wikg:\/\/chapter\/introduction\/source#/u,
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
});

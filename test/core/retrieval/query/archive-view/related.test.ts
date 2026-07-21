import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DirectoryDocument,
  listRelatedArchiveObjects,
  readArchivePage,
  rebuildArchiveSearchIndex,
  seedSourcedDocument,
  setupArchiveViewTestState,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/related", () => {
  it("sorts entity related triples with list-mode frequency", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
});

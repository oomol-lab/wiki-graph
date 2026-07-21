import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DirectoryDocument,
  listArchiveCollection,
  seedSourcedDocument,
  setupArchiveViewTestState,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/collection", () => {
  it("lists objects as a pageable collection", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
});

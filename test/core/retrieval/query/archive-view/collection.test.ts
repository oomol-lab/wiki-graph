import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DirectoryDocument,
  listArchiveCollection,
  listArchiveObjects,
  seedSourcedDocument,
  setupArchiveViewTestState,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/collection", () => {
  it("lists a real archive title without exposing the archive scope", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await document.openSession(async (openedDocument) => {
          await openedDocument.replaceBookMeta({
            authors: [],
            description: null,
            identifier: null,
            language: null,
            publishedAt: null,
            publisher: null,
            sourceFormat: "markdown",
            title: "Archive Collection Title",
            version: 1,
          });
        });

        const byAlias = await listArchiveCollection(document, {
          types: ["archive"],
        });
        expect(byAlias.items).toStrictEqual([
          expect.objectContaining({
            id: "wikg://title",
            title: "Archive Collection Title",
            type: "archive-title",
          }),
        ]);
        expect(byAlias.items.some((item) => item.id === "wikg://")).toBe(false);

        const defaultCollection = await listArchiveCollection(document);
        expect(defaultCollection.items).toContainEqual(
          expect.objectContaining({
            id: "wikg://meta",
            type: "meta",
          }),
        );
        expect(
          defaultCollection.items.some((item) => item.id === "wikg://"),
        ).toBe(false);
        await expect(
          listArchiveCollection(document, { types: ["meta"] }),
        ).resolves.toMatchObject({
          items: [expect.objectContaining({ id: "wikg://meta", type: "meta" })],
        });
        await expect(
          listArchiveObjects(document, "meta"),
        ).resolves.toMatchObject([
          expect.objectContaining({ id: "wikg://meta", type: "meta" }),
        ]);

        const chaptersByAlias = await listArchiveCollection(document, {
          types: ["chapter"],
        });
        const chapterTitles = await listArchiveCollection(document, {
          types: ["chapter-title"],
        });
        expect(chaptersByAlias.items).toStrictEqual(chapterTitles.items);
        expect(chaptersByAlias.items).toStrictEqual([
          expect.objectContaining({
            id: "wikg://chapter/introduction/title",
            type: "chapter-title",
          }),
        ]);
        expect(
          chaptersByAlias.items.some(
            (item) => item.id === "wikg://chapter/introduction",
          ),
        ).toBe(false);

        await document.openSession(async (openedDocument) => {
          await openedDocument.metadata.deleteKey("", "title");
        });
        await expect(
          listArchiveCollection(document, { types: ["archive-title"] }),
        ).resolves.toMatchObject({ items: [] });
      } finally {
        await document.release();
      }
    });
  });

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
                key: "introduction",
                serialId: 1,
                title: "Introduction",
              },
              {
                children: [],
                key: "second",
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
            "wikg://chapter/introduction/title",
            "wikg://entity/Q1",
            "node:100",
            "node:101",
          ]),
        );
        expect(result.items.map((item) => item.id)).not.toEqual(
          expect.arrayContaining([
            "wikg://chapter/second/title",
            "node:200",
            "wikg://chapter/second/summary#1",
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
          "wikg://chapter/second/source#1",
        );
      } finally {
        await document.release();
      }
    });
  });
});

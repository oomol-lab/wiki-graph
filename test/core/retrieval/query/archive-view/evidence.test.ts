import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DirectoryDocument,
  listArchiveCollection,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  packArchiveContext,
  readArchivePage,
  readArchiveText,
  rebuildArchiveSearchIndex,
  seedSourcedDocument,
  setupArchiveViewTestState,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/evidence", () => {
  it("applies evidence limits when reading entity pages", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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

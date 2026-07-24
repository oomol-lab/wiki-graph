import { mkdir } from "fs/promises";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Database,
  DirectoryDocument,
  countSearchIndexRows,
  findArchiveObjects,
  isArchiveSearchIndexCurrent,
  isSearchIndexCurrent,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  markDirtySearchIndexChapters,
  querySearchIndex,
  readArchiveIndexSettings,
  rebuildArchiveSearchIndex,
  seedSourcedDocument,
  setupArchiveViewTestState,
  streamArchiveIndexProjection,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/index", () => {
  it("projects single-archive search rows with archive_id 0", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);

        await expect(
          document.readSearchIndexDatabase(async (database) => {
            const textArchiveIds = await database.queryAll(
              `
                SELECT DISTINCT archive_id
                FROM text_sentence_records
                ORDER BY archive_id
              `,
              undefined,
              (row) => Number(row.archive_id),
            );
            const objectArchiveIds = await database.queryAll(
              `
                SELECT DISTINCT archive_id
                FROM search_object_properties_records
                ORDER BY archive_id
              `,
              undefined,
              (row) => Number(row.archive_id),
            );

            return { objectArchiveIds, textArchiveIds };
          }),
        ).resolves.toStrictEqual({
          objectArchiveIds: [0],
          textArchiveIds: [0],
        });

        const result = await querySearchIndex(document, "Wiki");

        expect(result?.textHits[0]).toMatchObject({ archiveId: 0 });
        expect(result?.objectHits[0]).toMatchObject({ archiveId: 0 });
      } finally {
        await document.release();
      }
    });
  });

  it("treats dirty chapter projection rows as an index-backed read blocker", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedSourcedDocument(document);
        await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(true);

        await markDirtySearchIndexChapters(document, [1]);

        await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
          false,
        );
        await expect(findArchiveObjects(document, "Wiki")).rejects.toThrow(
          "Wiki Graph search index is missing or outdated. Run `<archive-uri>/index enable` before searching.",
        );
        await expect(querySearchIndex(document, "Wiki")).rejects.toThrow(
          "Archive search index is dirty; rebuild the index before querying.",
        );
        await expect(document.readSummary(1)).resolves.toContain("Summary");

        await rebuildArchiveSearchIndex(document);

        await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(true);
        await expect(
          findArchiveObjects(document, "Wiki"),
        ).resolves.toMatchObject({
          query: "Wiki",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("distinguishes a missing index from a current empty index", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
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

  it("streams archive index projection in bounded batches", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          const draft = await openedDocument
            .getSerialFragments(1)
            .createDraft();

          for (let index = 0; index < 1100; index += 1) {
            draft.addSentence(`Streaming sentence ${index}.`, 3);
          }
          await draft.commit();
          await openedDocument.writeToc({
            items: [{ children: [], serialId: 1, title: "Streaming" }],
            version: 1,
          });
        });

        const batches = [];
        for await (const batch of streamArchiveIndexProjection(document, 7)) {
          batches.push(batch);
        }

        expect(batches.length).toBeGreaterThan(1);
        for (const batch of batches) {
          expect(
            batch.objectProperties.length + batch.textSentences.length,
          ).toBeLessThanOrEqual(512);
        }
        expect(
          batches
            .flatMap((batch) => batch.textSentences)
            .map((record) => ({
              archiveId: record.archiveId,
              chapterId: record.chapterId,
              sentenceIndex: record.sentenceIndex,
            })),
        ).toEqual(
          Array.from({ length: 1100 }, (_, index) => ({
            archiveId: 7,
            chapterId: 1,
            sentenceIndex: index,
          })),
        );
      } finally {
        await document.release();
      }
    });
  });

  it("migrates legacy search index uniqueness to include archive_id", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
      const documentPath = `${path}/document`;
      await mkdir(documentPath, { recursive: true });
      const legacyDatabase = await Database.open(
        join(documentPath, "fts.db"),
        `
          CREATE TABLE text_sentence_records (
            id INTEGER PRIMARY KEY,
            kind INTEGER NOT NULL,
            chapter_id INTEGER NOT NULL,
            sentence_index INTEGER NOT NULL,
            words_count INTEGER NOT NULL DEFAULT 0,
            byte_offset INTEGER NOT NULL DEFAULT 0,
            byte_length INTEGER NOT NULL DEFAULT 0,
            UNIQUE(kind, chapter_id, sentence_index)
          );
          CREATE TABLE search_object_properties_records (
            id INTEGER PRIMARY KEY,
            owner_kind INTEGER NOT NULL,
            owner_id TEXT NOT NULL,
            property_kind INTEGER NOT NULL,
            chapter_id INTEGER
          );
        `,
      );

      try {
        await legacyDatabase.run(`
          INSERT INTO text_sentence_records (
            kind, chapter_id, sentence_index, words_count
          )
          VALUES (1, 1, 0, 3)
        `);
      } finally {
        await legacyDatabase.close();
      }

      const document = await DirectoryDocument.open(documentPath);

      try {
        await document.writeSearchIndexDatabase(async (database) => {
          await database.run(
            `
              INSERT INTO text_sentence_records (
                archive_id, kind, chapter_id, sentence_index, words_count
              )
              VALUES (?, ?, ?, ?, ?)
            `,
            [1, 1, 1, 0, 4],
          );

          const rows = await database.queryAll(
            `
              SELECT archive_id, kind, chapter_id, sentence_index, words_count
              FROM text_sentence_records
              ORDER BY archive_id
            `,
            undefined,
            (row) => ({
              archiveId: Number(row.archive_id),
              chapterId: Number(row.chapter_id),
              kind: Number(row.kind),
              sentenceIndex: Number(row.sentence_index),
              wordsCount: Number(row.words_count),
            }),
          );

          expect(rows).toStrictEqual([
            {
              archiveId: 0,
              chapterId: 1,
              kind: 1,
              sentenceIndex: 0,
              wordsCount: 3,
            },
            {
              archiveId: 1,
              chapterId: 1,
              kind: 1,
              sentenceIndex: 0,
              wordsCount: 4,
            },
          ]);
        });
      } finally {
        await document.release();
      }
    });
  });

  it("marks the FTS index outdated when indexed content changes without a chapters revision bump", async () => {
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
    await withTempDir("wikigraph-archive-view-", async (path) => {
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
});

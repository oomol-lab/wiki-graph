import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DirectoryDocument,
  countSearchIndexRows,
  findArchiveObjects,
  isArchiveSearchIndexCurrent,
  isSearchIndexCurrent,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  readArchiveIndexSettings,
  rebuildArchiveSearchIndex,
  setupArchiveViewTestState,
  teardownArchiveViewTestState,
  withTempDir,
} from "./helpers.js";

beforeEach(setupArchiveViewTestState);
afterEach(teardownArchiveViewTestState);

describe("archive/query/archive-view/index", () => {
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

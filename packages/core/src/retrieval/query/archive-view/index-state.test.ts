import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../document/directory/index.js";
import { getNumber } from "../../../document/database.js";
import {
  replaceChapterFtsIndexArtifact,
  replaceChapterSourceEmbeddingIndexArtifact,
  replaceChapterSummaryEmbeddingIndexArtifact,
} from "../../index-artifact/index.js";
import {
  querySearchIndex,
  readSearchIndexCapabilityStatus,
  TEXT_SENTENCE_KIND,
} from "../../search-index/index.js";
import {
  assertArchiveIndexArtifactsReady,
  isArchiveSearchIndexCurrent,
  listArchiveQueryableChapterIds,
  rebuildArchiveSearchIndex,
} from "./index-state.js";

describe("archive search index state", () => {
  it("reports a state-less index database as missing", async () => {
    await withTempDocument(async (document) => {
      await document.writeSearchIndexDatabase(async () => {
        await Promise.resolve();
      });

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: { current: false },
        indexes: "missing",
      });
    });
  });

  it("syncs an fts-only cache from chapter fts artifacts", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await replaceChapterFtsIndexArtifact(document, 1);

      await rebuildArchiveSearchIndex(document);

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: { current: false },
        indexes: "fts",
      });
      await expect(
        querySearchIndex(document, "FTS", { types: ["source"] }),
      ).resolves.toMatchObject({
        textHits: [
          {
            archiveId: 0,
            chapterId: 1,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 1,
          },
        ],
      });
    });
  });

  it("syncs a dense-only cache from source embedding artifacts", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      const provider = createFakeEmbeddingProvider();

      await replaceChapterSourceEmbeddingIndexArtifact(document, 1, provider);
      await rebuildArchiveSearchIndex(document);

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: {
          current: true,
          dimensions: 3,
          model: "test-embedding",
        },
        indexes: "dense",
      });
      await expect(
        document.readSearchIndexDatabase(async (database) => ({
          objectFtsRows: await database.queryOne(
            "SELECT COUNT(*) AS count FROM search_object_properties_fts",
            undefined,
            (row) => getNumber(row, "count"),
          ),
          textFtsRows: await database.queryOne(
            "SELECT COUNT(*) AS count FROM text_sentence_fts",
            undefined,
            (row) => getNumber(row, "count"),
          ),
        })),
      ).resolves.toStrictEqual({
        objectFtsRows: 0,
        textFtsRows: 0,
      });
      await expect(
        querySearchIndex(document, "semantic vectors", {
          embeddingProvider: provider,
          types: ["source"],
        }),
      ).resolves.toMatchObject({
        objectHits: [],
        textHits: [
          {
            archiveId: 0,
            chapterId: 1,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 0,
          },
          {
            archiveId: 0,
            chapterId: 1,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 1,
          },
        ],
      });
    });
  });

  it("falls back to fts when hybrid query embedding fails", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await replaceChapterFtsIndexArtifact(document, 1);
      await replaceChapterSourceEmbeddingIndexArtifact(
        document,
        1,
        createFakeEmbeddingProvider(),
      );
      await rebuildArchiveSearchIndex(document);

      await expect(
        querySearchIndex(document, "FTS", {
          embeddingProvider: {
            dimensions: 3,
            model: "test-embedding",
            embedTexts: async () => {
              await Promise.resolve();
              throw new Error("embedding unavailable");
            },
          },
          types: ["source"],
        }),
      ).resolves.toMatchObject({
        textHits: [
          {
            archiveId: 0,
            chapterId: 1,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 1,
          },
        ],
      });
    });
  });

  it("selects one index strictly from a hybrid cache", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      let embeddingCalls = 0;
      const provider = {
        ...createFakeEmbeddingProvider(),
        embedTexts: async (texts: readonly string[]) => {
          embeddingCalls += 1;
          return await createFakeEmbeddingProvider().embedTexts(texts);
        },
      };
      await replaceChapterFtsIndexArtifact(document, 1);
      await replaceChapterSourceEmbeddingIndexArtifact(document, 1, provider);
      await rebuildArchiveSearchIndex(document);
      embeddingCalls = 0;

      const fts = await querySearchIndex(document, "FTS", {
        embeddingProvider: provider,
        queryMode: "fts",
        types: ["source"],
      });
      expect(embeddingCalls).toBe(0);
      expect(fts?.textHits.map((hit) => hit.sentenceIndex)).toStrictEqual([1]);

      const embedding = await querySearchIndex(document, "FTS", {
        embeddingProvider: provider,
        queryMode: "embedding",
        types: ["source"],
      });
      expect(embeddingCalls).toBe(1);
      expect(embedding?.objectHits).toStrictEqual([]);
      expect(embedding?.textHits.length).toBeGreaterThan(0);

      await expect(
        querySearchIndex(document, "FTS", {
          embeddingProvider: {
            ...provider,
            embedTexts: async () => {
              throw new Error("embedding unavailable");
            },
          },
          queryMode: "embedding",
          types: ["source"],
        }),
      ).rejects.toThrow("embedding unavailable");
    });
  });

  it("evaluates chapter coverage for the selected query mode", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapters(document, ["FTS", "Dense"]);
      const provider = createFakeEmbeddingProvider();
      await replaceChapterFtsIndexArtifact(document, 1);
      await replaceChapterSourceEmbeddingIndexArtifact(document, 2, provider);

      await expect(
        listArchiveQueryableChapterIds(document, {
          embeddingProvider: provider,
          queryMode: "hybrid",
          requireEmbeddingProvider: true,
        }),
      ).resolves.toStrictEqual([1, 2]);
      await expect(
        listArchiveQueryableChapterIds(document, {
          embeddingProvider: provider,
          queryMode: "fts",
          requireEmbeddingProvider: true,
        }),
      ).resolves.toStrictEqual([1]);
      await expect(
        listArchiveQueryableChapterIds(document, {
          embeddingProvider: provider,
          queryMode: "embedding",
          requireEmbeddingProvider: true,
        }),
      ).resolves.toStrictEqual([2]);
      await expect(
        assertArchiveIndexArtifactsReady(document, {
          embeddingProvider: provider,
          queryMode: "fts",
          requireEmbeddingProvider: true,
        }),
      ).rejects.toThrow("need a current FTS artifact");
    });
  });

  it("marks cache dirty when index artifacts change after sync", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await replaceChapterFtsIndexArtifact(document, 1);
      await rebuildArchiveSearchIndex(document);

      await document.openSession(async (openedDocument) => {
        const draft = await openedDocument.getSerialFragments(1).createDraft();
        draft.addSentence("Replacement artifact text.", 3);
        await draft.commit();
      });
      await replaceChapterFtsIndexArtifact(document, 1);

      await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(false);
    });
  });

  it("syncs summary embedding artifacts into dense cache", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await document.writeSummary(1, "Summary semantic sentence.");
      const provider = createFakeEmbeddingProvider();

      await replaceChapterFtsIndexArtifact(document, 1);
      await replaceChapterSummaryEmbeddingIndexArtifact(document, 1, provider);
      await rebuildArchiveSearchIndex(document);

      await expect(
        document.readSearchIndexDatabase(
          async (database) =>
            await database.queryOne(
              `
                SELECT kind
                FROM text_embedding_segments
                WHERE kind = ?
              `,
              [TEXT_SENTENCE_KIND.summary],
              (row) => getNumber(row, "kind"),
            ),
        ),
      ).resolves.toBe(TEXT_SENTENCE_KIND.summary);
      await expect(
        querySearchIndex(document, "semantic summary", {
          embeddingProvider: provider,
          types: ["summary"],
        }),
      ).resolves.toMatchObject({
        textHits: [
          {
            archiveId: 0,
            chapterId: 1,
            kind: TEXT_SENTENCE_KIND.summary,
          },
        ],
      });
    });
  });

  it("requires each chapter to have fts or source embedding artifacts", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);

      await expect(assertArchiveIndexArtifactsReady(document)).rejects.toThrow(
        'Wiki Graph query is not ready. Chapters "Dense" (wikg://chapter/dense) need a current FTS artifact or source embedding artifact before query.',
      );
    });
  });

  it("checks query readiness against the requested chapter scope", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapters(document, ["Unindexed", "Indexed"]);
      const provider = createFakeEmbeddingProvider();

      await replaceChapterSourceEmbeddingIndexArtifact(document, 2, provider);

      await expect(assertArchiveIndexArtifactsReady(document)).rejects.toThrow(
        'Wiki Graph query is not ready. Chapters "Unindexed" (wikg://chapter/unindexed) need a current FTS artifact or source embedding artifact before query.',
      );
      await expect(
        assertArchiveIndexArtifactsReady(document, { chapters: [2] }),
      ).resolves.toBeUndefined();

      await rebuildArchiveSearchIndex(document, undefined, { chapters: [2] });

      await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(false);
      await expect(
        isArchiveSearchIndexCurrent(document, { chapters: [2] }),
      ).resolves.toBe(true);
      await expect(
        querySearchIndex(document, "semantic vectors", {
          chapters: [2],
          embeddingProvider: provider,
          types: ["source"],
        }),
      ).resolves.toMatchObject({
        textHits: [
          {
            archiveId: 0,
            chapterId: 2,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 0,
          },
          {
            archiveId: 0,
            chapterId: 2,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 1,
          },
        ],
      });
    });
  });

  it("does not write stale artifact rows during scoped cache sync", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      const provider = createFakeEmbeddingProvider();

      await replaceChapterFtsIndexArtifact(document, 1);
      await document.openSession(async (openedDocument) => {
        await openedDocument.serials.bumpRevision(1);
      });
      await replaceChapterSourceEmbeddingIndexArtifact(document, 1, provider);

      await rebuildArchiveSearchIndex(document, undefined, { chapters: [1] });

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: {
          current: true,
          dimensions: 3,
          model: "test-embedding",
        },
        indexes: "dense",
      });
      await expect(
        document.readSearchIndexDatabase(async (database) => ({
          objectFtsRows: await database.queryOne(
            "SELECT COUNT(*) AS count FROM search_object_properties_fts",
            undefined,
            (row) => getNumber(row, "count"),
          ),
          textFtsRows: await database.queryOne(
            "SELECT COUNT(*) AS count FROM text_sentence_fts",
            undefined,
            (row) => getNumber(row, "count"),
          ),
        })),
      ).resolves.toStrictEqual({
        objectFtsRows: 0,
        textFtsRows: 0,
      });
    });
  });

  it("does not report dense current when the cache is dirty", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await replaceChapterFtsIndexArtifact(document, 1);
      await replaceChapterSourceEmbeddingIndexArtifact(
        document,
        1,
        createFakeEmbeddingProvider(),
      );
      await rebuildArchiveSearchIndex(document);
      await document.writeSearchIndexDatabase(async (database) => {
        await database.run(
          `
            INSERT INTO index_dirty_chapters(archive_id, chapter_id, updated_at)
            VALUES (1, 1, ?)
          `,
          [Date.now()],
        );
      });

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: {
          current: false,
          dimensions: 3,
          model: "test-embedding",
        },
        indexes: "fts,dense",
      });
    });
  });
});

function createFakeEmbeddingProvider() {
  return {
    dimensions: 3,
    model: "test-embedding",
    embedTexts: async (texts: readonly string[]) => {
      await Promise.resolve();
      return {
        embeddings: texts.map((text, index) => [text.length, index, 1]),
        tokens: 9,
      };
    },
  };
}

async function writeSourceChapter(document: DirectoryDocument): Promise<void> {
  await writeSourceChapters(document, ["Dense"]);
}

async function writeSourceChapters(
  document: DirectoryDocument,
  titles: readonly string[],
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    const serialIds: number[] = [];

    for (const title of titles) {
      const serialId = await openedDocument.createSerial();
      serialIds.push(serialId);
      const draft = await openedDocument
        .getSerialFragments(serialId)
        .createDraft();
      draft.addSentence(`${title} dense indexing writes vectors.`, 5);
      draft.addSentence(`${title} FTS still indexes the same text.`, 7);
      await draft.commit();
    }
    await openedDocument.writeToc({
      items: titles.map((title, index) => ({
        children: [],
        key: title.toLowerCase(),
        serialId: serialIds[index]!,
        title,
      })),
      version: 1,
    });
  });
}

async function withTempDocument(
  operation: (document: DirectoryDocument) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "wikigraph-index-test-"));
  const document = await DirectoryDocument.open(tempDir);

  try {
    await operation(document);
  } finally {
    await document.release();
    await rm(tempDir, { force: true, recursive: true });
  }
}

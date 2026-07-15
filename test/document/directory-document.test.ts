import { access, readFile } from "fs/promises";
import { constants as fsConstants } from "fs";

import { describe, expect, it } from "vitest";

import {
  DirectoryDocument,
  ObjectMetadataKind,
} from "../../packages/core/src/document/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("document/directory-document", () => {
  it("persists metadata, cover, toc, summaries, and serial state", async () => {
    await withTempDir("wikigraph-document-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          const serialId = await openedDocument.createSerial();

          expect(serialId).toBe(1);

          await openedDocument.writeBookMeta({
            authors: ["Ari Lantern"],
            description: "Document fixture",
            identifier: "urn:test:document",
            language: "en",
            publishedAt: "2026-01-01",
            publisher: "Open Sample Press",
            sourceFormat: "txt",
            title: "Document Fixture",
            version: 1,
          });
          await openedDocument.writeCover({
            data: Buffer.from([1, 2, 3]),
            mediaType: "image/png",
            path: "images/cover.png",
          });
          await openedDocument.writeSummary(serialId, "Serial summary");
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                serialId,
                title: "Chapter 1",
              },
            ],
            version: 1,
          });
        });

        expect(await document.peekNextSerialId()).toBe(2);
        expect(await document.readBookMeta()).toMatchObject({
          title: "Document Fixture",
          sourceFormat: "txt",
        });
        expect(await document.readCover()).toMatchObject({
          mediaType: "image/png",
          path: "images/cover.png",
        });
        expect(await document.readSummary(1)).toBe("Serial summary");
        expect(await document.readToc()).toMatchObject({
          items: [{ title: "Chapter 1", serialId: 1 }],
        });
      } finally {
        await document.release();
      }
    });
  });

  it("rolls back newly created files when a session fails", async () => {
    await withTempDir("wikigraph-document-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await expect(
          document.openSession(async (openedDocument) => {
            await openedDocument.writeBookMeta({
              authors: [],
              description: null,
              identifier: null,
              language: null,
              publishedAt: null,
              publisher: null,
              sourceFormat: "txt",
              title: "Rollback Fixture",
              version: 1,
            });
            await openedDocument.createSerial();
            await openedDocument.writeSummary(1, "Should be removed");

            throw new Error("abort");
          }),
        ).rejects.toThrow("abort");

        await expect(document.readBookMeta()).resolves.toBeUndefined();
        await expect(document.readSummary(1)).resolves.toBeUndefined();
        await expect(document.serials.listIds()).resolves.toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("writes files only once per path inside a document", async () => {
    await withTempDir("wikigraph-document-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeToc({
            items: [],
            version: 1,
          });
        });

        await expect(
          document.openSession(async (openedDocument) => {
            await openedDocument.writeToc({
              items: [],
              version: 1,
            });
          }),
        ).rejects.toThrow(`File already exists: ${path}/toc.json`);

        await expect(
          access(`${path}/toc.json`, fsConstants.F_OK),
        ).resolves.toBe(undefined);
        expect(await readFile(`${path}/toc.json`, "utf8")).toContain(
          '"version": 1',
        );
      } finally {
        await document.release();
      }
    });
  });

  it("replaces existing archive metadata", async () => {
    await withTempDir("wikigraph-document-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeBookMeta({
            authors: ["Ari Lantern"],
            description: null,
            identifier: null,
            language: null,
            publishedAt: null,
            publisher: null,
            sourceFormat: "txt",
            title: "Original",
            version: 1,
          });
        });

        await document.openSession(async (openedDocument) => {
          await openedDocument.replaceBookMeta({
            authors: ["Bea North"],
            description: "Updated",
            identifier: null,
            language: "en",
            publishedAt: null,
            publisher: null,
            sourceFormat: "txt",
            title: "Replacement",
            version: 1,
          });
        });

        await expect(document.readBookMeta()).resolves.toMatchObject({
          authors: ["Bea North"],
          description: "Updated",
          language: "en",
          title: "Replacement",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("persists object metadata and clears chapter-owned rows", async () => {
    await withTempDir("wikigraph-document-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.serials.createWithId(1);
          await openedDocument.metadata.put(
            {
              chapterId: 1,
              kind: ObjectMetadataKind.Chapter,
              objectPath: "chapter/1",
            },
            "note",
            "chapter note",
          );
          await openedDocument.metadata.put(
            {
              entityQid: "Q42",
              kind: ObjectMetadataKind.Entity,
              objectPath: "entity/Q42",
            },
            "rank",
            7,
          );
        });

        await expect(document.metadata.getMap("chapter/1")).resolves.toEqual({
          note: "chapter note",
        });
        await expect(document.metadata.getMap("entity/Q42")).resolves.toEqual({
          rank: 7,
        });

        await document.openSession(async (openedDocument) => {
          await openedDocument.deleteSerial(1);
        });

        await expect(document.metadata.getMap("chapter/1")).resolves.toEqual(
          {},
        );
        await expect(document.metadata.getMap("entity/Q42")).resolves.toEqual(
          {},
        );
      } finally {
        await document.release();
      }
    });
  });

  it("rolls back owned serial resources when a document context is disposed without completion", async () => {
    await withTempDir("wikigraph-document-", async (path) => {
      const document = await DirectoryDocument.open(path);
      const context = document.createContext();

      context.ownSerial(1);

      try {
        await context.run(async () => {
          await document.serials.createWithId(1);
          await document.serials.setTopologyReady(1);
          await document.mentions.saveMany([
            {
              chapterId: 1,
              id: "m1",
              qid: "Q1",
              rangeEnd: 1,
              rangeStart: 0,
              surface: "A",
            },
            {
              chapterId: 1,
              id: "m2",
              qid: "Q2",
              rangeEnd: 3,
              rangeStart: 2,
              surface: "B",
            },
          ]);
          await document.mentionLinks.save({
            evidenceSentenceIds: [[1, 0]],
            id: "l1",
            predicate: "mentions",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          });
          await document.writeSummary(1, "Transient summary");
        });
      } finally {
        await context.dispose();
      }

      try {
        await expect(document.serials.listIds()).resolves.toStrictEqual([]);
        await expect(document.mentions.listByChapter(1)).resolves.toStrictEqual(
          [],
        );
        await expect(
          document.mentionLinks.listByChapter(1),
        ).resolves.toStrictEqual([]);
        await expect(document.readSummary(1)).resolves.toBeUndefined();
      } finally {
        await document.release();
      }
    });
  });

  it("shares text stream draft ownership across serial instances", async () => {
    await withTempDir("wikigraph-document-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.serials.createWithId(1);

          const firstSerial = openedDocument.getSerialFragments(1);
          const secondSerial = openedDocument.getSerialFragments(1);
          const draft = await firstSerial.createDraft();

          await expect(secondSerial.createDraft()).rejects.toThrow(
            "Only one text stream draft can be open at a time",
          );

          expect(draft.addSentence("Alpha", 1)).toStrictEqual([1, 0]);
          await draft.commit();

          await expect(
            openedDocument.getSerialFragments(1).getSentence(0),
          ).resolves.toMatchObject({
            text: "Alpha",
            wordsCount: 1,
          });
        });
      } finally {
        await document.release();
      }
    });
  });
});

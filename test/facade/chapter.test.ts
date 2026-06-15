import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import {
  addChapter,
  advanceChapterStages,
  getChapterDetails,
  listChapters,
  removeChapter,
  resetChapter,
  setChapterSource,
  setChapterSummary,
} from "../../src/facade/chapter.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/chapter", () => {
  it("adds planned chapters into a tree and lists their stages", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeToc({
            items: [],
            version: 1,
          });
        });

        const parent = await addChapter(document, {
          title: "Part I",
        });
        const child = await addChapter(document, {
          parentChapterId: parent.chapterId,
          title: "Chapter 1",
        });

        expect(parent).toMatchObject({
          chapterId: 1,
          stage: "planned",
          title: "Part I",
        });
        expect(child).toMatchObject({
          chapterId: 2,
          stage: "planned",
          title: "Chapter 1",
        });
        expect(await listChapters(document)).toMatchObject([
          {
            chapterId: 1,
            depth: 0,
            stage: "planned",
            title: "Part I",
          },
          {
            chapterId: 2,
            depth: 1,
            stage: "planned",
            title: "Chapter 1",
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("normalizes legacy grouping nodes into planned chapters", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.writeToc({
            items: [
              {
                children: [
                  {
                    children: [],
                    serialId: 1,
                    title: "Chapter 1",
                  },
                ],
                title: "Part I",
              },
            ],
            version: 1,
          });
        });

        expect(await listChapters(document)).toMatchObject([
          {
            chapterId: 2,
            depth: 0,
            stage: "planned",
            title: "Part I",
          },
          {
            chapterId: 1,
            depth: 1,
            stage: "planned",
            title: "Chapter 1",
          },
        ]);
        expect(await document.readToc()).toMatchObject({
          items: [
            {
              serialId: 2,
              title: "Part I",
            },
          ],
        });
      } finally {
        await document.release();
      }
    });
  });

  it("sets source and summary through explicit stages", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Chapter 1",
        });
        const sourced = await setChapterSource(document, chapter.chapterId, [
          "Alpha beta.",
        ]);

        expect(sourced.stage).toBe("sourced");
        await document.serials.setTopologyReady(chapter.chapterId);

        expect(
          await getChapterDetails(document, chapter.chapterId),
        ).toMatchObject({
          stage: "graphed",
        });

        const summarized = await setChapterSummary(
          document,
          chapter.chapterId,
          "Summary",
        );

        expect(summarized.stage).toBe("summarized");

        const resetToGraph = await resetChapter(
          document,
          chapter.chapterId,
          "graphed",
        );

        expect(resetToGraph.stage).toBe("graphed");

        const resetToSource = await resetChapter(
          document,
          chapter.chapterId,
          "sourced",
        );

        expect(resetToSource.stage).toBe("sourced");

        const resetToPlanned = await resetChapter(
          document,
          chapter.chapterId,
          "planned",
        );

        expect(resetToPlanned.stage).toBe("planned");
      } finally {
        await document.release();
      }
    });
  });

  it("requires recursive removal for chapters with children", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const parent = await addChapter(document, {
          title: "Part I",
        });
        await addChapter(document, {
          parentChapterId: parent.chapterId,
          title: "Chapter 1",
        });

        await expect(removeChapter(document, parent.chapterId)).rejects.toThrow(
          "has child chapters",
        );

        await removeChapter(document, parent.chapterId, {
          recursive: true,
        });

        await expect(listChapters(document)).resolves.toStrictEqual([]);
        await expect(document.serials.listIds()).resolves.toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("advances stages idempotently without resetting planned chapters", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Draft",
        });

        const noop = await advanceChapterStages(document, {
          extractionPrompt: "Keep key beats",
          llm: {} as never,
          targetStage: "planned",
        });

        expect(noop.advanced).toStrictEqual([]);
        expect(noop.pending).toMatchObject([
          {
            chapterId: chapter.chapterId,
            stage: "planned",
          },
        ]);
        expect(
          await getChapterDetails(document, chapter.chapterId),
        ).toMatchObject({
          stage: "planned",
        });

        const skipped = await advanceChapterStages(document, {
          extractionPrompt: "Keep key beats",
          llm: {} as never,
          targetStage: "summarized",
        });

        expect(skipped.advanced).toStrictEqual([]);
        expect(skipped.pending).toMatchObject([
          {
            chapterId: chapter.chapterId,
            stage: "planned",
          },
        ]);
        expect(skipped.skipped).toMatchObject([
          {
            chapterId: chapter.chapterId,
            stage: "planned",
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });
});

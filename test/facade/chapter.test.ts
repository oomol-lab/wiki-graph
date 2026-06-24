import { rm } from "fs/promises";

import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import {
  addChapter,
  advanceChapterStages,
  applyChapterTree,
  getChapterDetails,
  getChapterTree,
  listChapters,
  moveChapter,
  parseChapterTreeInput,
  removeChapter,
  resetChapter,
  setChapterSource,
  setChapterSummary,
  setChapterTitle,
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

  it("keeps serial-less grouping nodes read-only when listing chapters", async () => {
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
            chapterId: 1,
            depth: 1,
            stage: "planned",
            title: "Chapter 1",
            tocPath: ["Part I", "Chapter 1"],
          },
        ]);
        expect(await getChapterTree(document)).toStrictEqual({
          chapters: [
            {
              children: [],
              id: 1,
              title: "Chapter 1",
            },
          ],
        });
        expect(await document.readToc()).toStrictEqual({
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
      } finally {
        await document.release();
      }
    });
  });

  it("normalizes serial-less grouping nodes before chapter writes", async () => {
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

        const added = await addChapter(document, { title: "Chapter 2" });

        expect(added.chapterId).toBe(3);
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
          {
            chapterId: 3,
            depth: 0,
            stage: "planned",
            title: "Chapter 2",
          },
        ]);
        expect(await document.readToc()).toMatchObject({
          items: [
            {
              serialId: 2,
              title: "Part I",
            },
            {
              serialId: 3,
              title: "Chapter 2",
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

  it("reads one chapter details without scanning unrelated chapter fragments", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const first = await addChapter(document, {
          title: "Chapter 1",
        });
        const second = await addChapter(document, {
          title: "Chapter 2",
        });

        await setChapterSource(document, first.chapterId, ["Alpha beta."]);
        await setChapterSource(document, second.chapterId, ["Gamma delta."]);
        await rm(document.getSerialFragments(second.chapterId).path, {
          force: true,
          recursive: true,
        });

        await expect(
          getChapterDetails(document, first.chapterId),
        ).resolves.toMatchObject({
          chapterId: first.chapterId,
          stage: "sourced",
          words: 2,
        });
      } finally {
        await document.release();
      }
    });
  });

  it("updates and clears chapter titles in the TOC", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Original",
        });

        await expect(
          setChapterTitle(document, chapter.chapterId, "  Renamed  "),
        ).resolves.toMatchObject({
          chapterId: chapter.chapterId,
          title: "Renamed",
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          {
            chapterId: chapter.chapterId,
            title: "Renamed",
            tocPath: ["Renamed"],
          },
        ]);
        await expect(document.readToc()).resolves.toMatchObject({
          items: [
            {
              serialId: chapter.chapterId,
              title: "Renamed",
            },
          ],
        });

        await expect(
          setChapterTitle(document, chapter.chapterId, "   "),
        ).resolves.toMatchObject({
          chapterId: chapter.chapterId,
          title: null,
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          {
            chapterId: chapter.chapterId,
            title: null,
            tocPath: [`Chapter ${chapter.chapterId}`],
          },
        ]);
        expect(await document.readToc()).toStrictEqual({
          items: [
            {
              children: [],
              serialId: chapter.chapterId,
            },
          ],
          version: 1,
        });
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

  it("moves chapters across parents and sibling positions", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const part = await addChapter(document, { title: "Part" });
        const first = await addChapter(document, {
          parentChapterId: part.chapterId,
          title: "First",
        });
        const second = await addChapter(document, {
          parentChapterId: part.chapterId,
          title: "Second",
        });
        const root = await addChapter(document, { title: "Root" });

        await moveChapter(document, root.chapterId, {
          first: true,
          parentChapterId: part.chapterId,
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: part.chapterId, depth: 0 },
          { chapterId: root.chapterId, depth: 1, title: "Root" },
          { chapterId: first.chapterId, depth: 1, title: "First" },
          { chapterId: second.chapterId, depth: 1, title: "Second" },
        ]);

        await moveChapter(document, first.chapterId, {
          afterChapterId: second.chapterId,
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: part.chapterId, depth: 0 },
          { chapterId: root.chapterId, depth: 1 },
          { chapterId: second.chapterId, depth: 1 },
          { chapterId: first.chapterId, depth: 1 },
        ]);

        await moveChapter(document, second.chapterId, {
          root: true,
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: part.chapterId, depth: 0 },
          { chapterId: root.chapterId, depth: 1 },
          { chapterId: first.chapterId, depth: 1 },
          { chapterId: second.chapterId, depth: 0 },
        ]);

        await expect(
          moveChapter(document, part.chapterId, {
            parentChapterId: root.chapterId,
          }),
        ).rejects.toThrow("own descendant");
      } finally {
        await document.release();
      }
    });
  });

  it("exports and applies complete chapter trees", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const part = await addChapter(document, { title: "Part" });
        const first = await addChapter(document, {
          parentChapterId: part.chapterId,
          title: "First",
        });
        const second = await addChapter(document, {
          parentChapterId: part.chapterId,
        });

        await expect(getChapterTree(document)).resolves.toStrictEqual({
          chapters: [
            {
              children: [
                {
                  children: [],
                  id: first.chapterId,
                  title: "First",
                },
                {
                  children: [],
                  id: second.chapterId,
                  title: null,
                },
              ],
              id: part.chapterId,
              title: "Part",
            },
          ],
        });

        const dryRun = await applyChapterTree(
          document,
          parseChapterTreeInput({
            chapters: [
              {
                children: [],
                id: second.chapterId,
                title: "Second",
              },
              {
                children: [
                  {
                    children: [],
                    id: first.chapterId,
                    title: null,
                  },
                ],
                id: part.chapterId,
              },
            ],
          }),
          { dryRun: true },
        );

        expect(dryRun.changed).toBe(true);
        expect(dryRun.moved.map((move) => move.chapterId)).toContain(
          second.chapterId,
        );
        expect(
          [...dryRun.renamed].sort(
            (left, right) => left.chapterId - right.chapterId,
          ),
        ).toStrictEqual([
          {
            chapterId: first.chapterId,
            newTitle: null,
            oldTitle: "First",
          },
          {
            chapterId: second.chapterId,
            newTitle: "Second",
            oldTitle: null,
          },
        ]);
        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: part.chapterId, title: "Part" },
          { chapterId: first.chapterId, title: "First" },
          { chapterId: second.chapterId, title: null },
        ]);

        await applyChapterTree(
          document,
          parseChapterTreeInput({
            chapters: [
              {
                children: [],
                id: second.chapterId,
                title: "Second",
              },
              {
                children: [
                  {
                    children: [],
                    id: first.chapterId,
                    title: null,
                  },
                ],
                id: part.chapterId,
              },
            ],
          }),
        );

        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: second.chapterId, depth: 0, title: "Second" },
          { chapterId: part.chapterId, depth: 0, title: "Part" },
          { chapterId: first.chapterId, depth: 1, title: null },
        ]);

        await expect(
          applyChapterTree(
            document,
            parseChapterTreeInput({
              chapters: [
                {
                  children: [],
                  id: second.chapterId,
                },
              ],
            }),
          ),
        ).rejects.toThrow("missing chapter ids");
        expect(() =>
          parseChapterTreeInput({
            chapters: [
              {
                children: [],
                id: second.chapterId,
                summary: "not allowed",
              },
            ],
          }),
        ).toThrow();
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

  it("reports advance progress without making progress callbacks fatal", async () => {
    await withTempDir("spinedigest-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Draft",
        });
        const events: unknown[] = [];

        const skipped = await advanceChapterStages(document, {
          extractionPrompt: "Keep key beats",
          llm: {} as never,
          onProgress: (event) => {
            events.push(event);
            throw new Error("progress failed");
          },
          targetStage: "summarized",
        });

        expect(skipped.advanced).toStrictEqual([]);
        expect(skipped.pending).toMatchObject([
          {
            chapterId: chapter.chapterId,
            stage: "planned",
          },
        ]);
        expect(events).toMatchObject([
          {
            targetStage: "summarized",
            totalChapters: 1,
            type: "selected",
          },
          {
            chapter: {
              chapterId: chapter.chapterId,
              title: "Draft",
            },
            reason: "planned",
            targetStage: "summarized",
            type: "skipped",
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });
});

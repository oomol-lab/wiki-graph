import { describe, expect, it, vi } from "vitest";
import { access } from "fs/promises";

import { DirectoryDocument, ChunkRetention } from "../../src/document/index.js";

vi.mock("../../src/editor/index.js", () => ({
  compressText: vi.fn((options: { readonly groupId: number }) =>
    Promise.resolve(`summary group ${options.groupId}`),
  ),
}));

vi.mock("../../src/serial.js", () => ({
  SerialGeneration: class {
    readonly #document: DirectoryDocument;

    public constructor(options: { readonly document: DirectoryDocument }) {
      this.#document = options.document;
    }

    public async buildTopologyInto(
      serialId: number,
      stream: AsyncIterable<string> | Iterable<string>,
      _options: unknown,
      progressTracker?: {
        advance(wordsCount: number): Promise<void>;
      },
    ): Promise<void> {
      const fragments = this.#document.getSerialFragments(serialId);

      for await (const chunk of stream) {
        const wordsCount = countWords(chunk);
        const draft = await fragments.createDraft();

        draft.addSentence(chunk, wordsCount);
        await draft.commit();
        await progressTracker?.advance(wordsCount);
      }

      await this.#document.serials.setTopologyReady(serialId);
    }
  },
  writeSerialSource: async (
    document: DirectoryDocument,
    serialId: number,
    stream: AsyncIterable<string> | Iterable<string>,
  ) => {
    const fragments = document.getSerialFragments(serialId);

    for await (const chunk of stream) {
      const draft = await fragments.createDraft();

      draft.addSentence(chunk, countWords(chunk));
      await draft.commit();
    }
  },
}));

import {
  addChapter,
  generateChapterGraph,
  getChapterDetails,
  setChapterSource,
} from "../../src/facade/chapter.js";
import {
  buildChapterGraphArtifact,
  buildChapterSummaryArtifactFromSnapshot,
  commitChapterGraphArtifact,
  readChapterBuildInput,
  snapshotChapterSummaryInput,
} from "../../src/facade/chapter-build.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/chapter graph", () => {
  it("rebuilds graph without duplicating source fragments", async () => {
    await withTempDir("spinedigest-chapter-graph-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Chapter 1",
        });

        await setChapterSource(document, chapter.chapterId, [
          "Alpha beta.",
          "Gamma delta.",
        ]);

        await expect(
          getChapterDetails(document, chapter.chapterId),
        ).resolves.toMatchObject({
          fragmentCount: 2,
          words: 4,
        });

        await generateChapterGraph(document, chapter.chapterId, {
          extractionPrompt: "Keep key beats",
          llm: {} as never,
        });

        await expect(
          getChapterDetails(document, chapter.chapterId),
        ).resolves.toMatchObject({
          fragmentCount: 2,
          stage: "graphed",
          words: 4,
        });
      } finally {
        await document.release();
      }
    });
  });

  it("commits staged graph output without holding the source document", async () => {
    await withTempDir("spinedigest-chapter-graph-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/archive`);

      try {
        const chapter = await addChapter(document, {
          title: "Chapter 1",
        });
        await setChapterSource(document, chapter.chapterId, [
          "Alpha beta.",
          "Gamma delta.",
        ]);

        const input = await readChapterBuildInput(document, chapter.chapterId);
        const artifact = await buildChapterGraphArtifact(chapter.chapterId, {
          extractionPrompt: "Keep key beats",
          llm: {} as never,
          nextChunkId: input.nextChunkId,
          sourceText: input.sourceText,
          workspacePath: `${path}/job-workspace`,
        });

        await commitChapterGraphArtifact(document, artifact);

        await expect(
          getChapterDetails(document, chapter.chapterId),
        ).resolves.toMatchObject({
          fragmentCount: 2,
          stage: "graphed",
          words: 4,
        });
        await expect(document.chunks.getMaxId()).resolves.toBe(0);
      } finally {
        await document.release();
      }
    });
  });

  it("builds summary from a snapshot file without sdpub-shaped temp documents", async () => {
    await withTempDir("spinedigest-chapter-summary-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/archive`);

      try {
        const chapter = await addChapter(document, {
          title: "Chapter 1",
        });
        await setChapterSource(document, chapter.chapterId, [
          "Alpha beta.",
          "Gamma delta.",
        ]);
        const fragments = document.getSerialFragments(chapter.chapterId);

        await document.openSession(async (openedDocument) => {
          await openedDocument.chunks.save({
            content: "Alpha beta.",
            generation: 0,
            id: 1,
            label: "Alpha",
            retention: ChunkRetention.Verbatim,
            sentenceId: [chapter.chapterId, 0, 0],
            sentenceIds: [[chapter.chapterId, 0, 0]],
            weight: 1,
            wordsCount: 2,
          });
          await openedDocument.chunks.save({
            content: "Gamma delta.",
            generation: 0,
            id: 2,
            label: "Gamma",
            sentenceId: [chapter.chapterId, 1, 0],
            sentenceIds: [[chapter.chapterId, 1, 0]],
            weight: 1,
            wordsCount: 2,
          });
          await openedDocument.fragmentGroups.saveMany([
            {
              fragmentId: 0,
              groupId: 1,
              serialId: chapter.chapterId,
            },
            {
              fragmentId: 1,
              groupId: 2,
              serialId: chapter.chapterId,
            },
          ]);
          await openedDocument.snakes.create({
            firstLabel: "Alpha",
            groupId: 1,
            lastLabel: "Alpha",
            localSnakeId: 1,
            serialId: chapter.chapterId,
            size: 1,
          });
          await openedDocument.snakes.create({
            firstLabel: "Gamma",
            groupId: 2,
            lastLabel: "Gamma",
            localSnakeId: 1,
            serialId: chapter.chapterId,
            size: 1,
          });
          await openedDocument.snakeChunks.save({
            chunkId: 1,
            position: 0,
            snakeId: 1,
          });
          await openedDocument.snakeChunks.save({
            chunkId: 2,
            position: 0,
            snakeId: 2,
          });
          await openedDocument.serials.setTopologyReady(chapter.chapterId);
        });

        await expect(fragments.listFragmentIds()).resolves.toStrictEqual([
          0, 1,
        ]);

        const snapshot = await snapshotChapterSummaryInput(
          document,
          chapter.chapterId,
          `${path}/job-workspace`,
        );
        const summary = await buildChapterSummaryArtifactFromSnapshot(
          chapter.chapterId,
          {
            llm: {} as never,
            snapshotPath: snapshot.filePath,
            workspacePath: `${path}/job-workspace`,
          },
        );

        expect(snapshot.filePath).toBe(
          `${path}/job-workspace/summary-input.json`,
        );
        await expect(pathExists(snapshot.filePath)).resolves.toBe(true);
        await expect(
          pathExists(`${path}/job-workspace/summary-input-document`),
        ).resolves.toBe(false);
        await expect(
          pathExists(`${path}/job-workspace/summary-document`),
        ).resolves.toBe(false);
        expect(summary).toBe("summary group 1\n\nsummary group 2");
      } finally {
        await document.release();
      }
    });
  });
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "").length;
}

import { describe, expect, it, vi } from "vitest";
import { access } from "fs/promises";

import { DirectoryDocument, ChunkRetention } from "../../packages/core/src/document/index.js";

vi.mock("../../packages/core/src/editor/index.js", () => ({
  compressText: vi.fn((options: { readonly groupId: number }) =>
    Promise.resolve(`summary group ${options.groupId}`),
  ),
}));

vi.mock("../../packages/core/src/serial.js", () => ({
  SerialGeneration: class {
    readonly #document: DirectoryDocument;

    public constructor(options: { readonly document: DirectoryDocument }) {
      this.#document = options.document;
    }

    public async buildTopologyInto(
      serialId: number,
      _options: unknown,
      progressTracker?: {
        advance(wordsCount: number): Promise<void>;
      },
    ): Promise<void> {
      const fragments = this.#document.getSerialFragments(serialId);

      for (const fragmentId of await fragments.listFragmentIds()) {
        const fragment = await fragments.getFragment(fragmentId);
        const wordsCount = fragment.sentences.reduce(
          (sum, sentence) => sum + sentence.wordsCount,
          0,
        );

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
} from "../../packages/core/src/facade/chapter.js";
import {
  buildChapterGraphArtifact,
  buildChapterSummaryArtifactFromSnapshot,
  commitChapterGraphArtifact,
  readChapterBuildInput,
  snapshotChapterSummaryInput,
} from "../../packages/core/src/facade/chapter-build.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/chapter graph", () => {
  it("rebuilds graph without duplicating source fragments", async () => {
    await withTempDir("wikigraph-chapter-graph-", async (path) => {
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
          fragmentCount: 1,
          words: 4,
        });

        await generateChapterGraph(document, chapter.chapterId, {
          extractionPrompt: "Keep key beats",
          llm: {} as never,
        });

        await expect(
          getChapterDetails(document, chapter.chapterId),
        ).resolves.toMatchObject({
          fragmentCount: 1,
          stage: "graphed",
          words: 4,
        });
        const serial = await document.serials.getById(chapter.chapterId);

        expect(serial?.topologyParameterHash).toBeDefined();
        await expect(
          document.graphBuildParameters.getByHash(
            serial!.topologyParameterHash!,
          ),
        ).resolves.toMatchObject({
          prompt: "Keep key beats",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("commits staged graph output without holding the source document", async () => {
    await withTempDir("wikigraph-chapter-graph-", async (path) => {
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
          sourceText: input.sourceText,
          workspacePath: `${path}/job-workspace`,
        });

        await expect(
          access(
            `${artifact.documentPath}/fragments/serial-${chapter.chapterId}/fragment_0.json`,
          ),
        ).resolves.toBeUndefined();
        await commitChapterGraphArtifact(document, artifact);

        await expect(
          getChapterDetails(document, chapter.chapterId),
        ).resolves.toMatchObject({
          fragmentCount: 1,
          stage: "graphed",
          words: 4,
        });
      } finally {
        await document.release();
      }
    });
  });

  it("remaps staged chunk ids when committing graph artifacts", async () => {
    await withTempDir("wikigraph-chapter-graph-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/archive`);

      try {
        const firstChapter = await addChapter(document, {
          title: "Chapter 1",
        });
        const secondChapter = await addChapter(document, {
          title: "Chapter 2",
        });

        await setChapterSource(document, firstChapter.chapterId, [
          "Alpha beta.",
        ]);
        await setChapterSource(document, secondChapter.chapterId, [
          "Gamma delta.",
        ]);

        const firstArtifact = await createSingleChunkGraphArtifact({
          chapterId: firstChapter.chapterId,
          chunkContent: "Alpha beta.",
          chunkLabel: "Alpha",
          documentPath: `${path}/first-artifact`,
        });
        const secondArtifact = await createSingleChunkGraphArtifact({
          chapterId: secondChapter.chapterId,
          chunkContent: "Gamma delta.",
          chunkLabel: "Gamma",
          documentPath: `${path}/second-artifact`,
        });

        await commitChapterGraphArtifact(document, firstArtifact);
        await commitChapterGraphArtifact(document, secondArtifact);

        const firstChunks = await document.chunks.listBySerial(
          firstChapter.chapterId,
        );
        const secondChunks = await document.chunks.listBySerial(
          secondChapter.chapterId,
        );

        expect(firstChunks).toHaveLength(1);
        expect(secondChunks).toHaveLength(1);
        expect(firstChunks[0]?.id).not.toBe(secondChunks[0]?.id);
        expect(firstChunks[0]).toMatchObject({
          content: "Alpha beta.",
          sentenceId: [firstChapter.chapterId, 0],
        });
        expect(secondChunks[0]).toMatchObject({
          content: "Gamma delta.",
          sentenceId: [secondChapter.chapterId, 0],
        });

        const firstSnakeIds = await document.snakes.listIdsByGroup(
          firstChapter.chapterId,
          0,
        );
        const secondSnakeIds = await document.snakes.listIdsByGroup(
          secondChapter.chapterId,
          0,
        );

        expect(
          await document.snakeChunks.listChunkIds(firstSnakeIds[0]!),
        ).toStrictEqual([firstChunks[0]!.id]);
        expect(
          await document.snakeChunks.listChunkIds(secondSnakeIds[0]!),
        ).toStrictEqual([secondChunks[0]!.id]);
      } finally {
        await document.release();
      }
    });
  });

  it("builds summary from a snapshot file without wikg-shaped temp documents", async () => {
    await withTempDir("wikigraph-chapter-summary-", async (path) => {
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
            sentenceId: [chapter.chapterId, 0],
            sentenceIds: [[chapter.chapterId, 0]],
            weight: 1,
            wordsCount: 2,
          });
          await openedDocument.chunks.save({
            content: "Gamma delta.",
            generation: 0,
            id: 2,
            label: "Gamma",
            sentenceId: [chapter.chapterId, 1],
            sentenceIds: [[chapter.chapterId, 1]],
            weight: 1,
            wordsCount: 2,
          });
          await openedDocument.fragmentGroups.saveMany([
            {
              endSentenceIndex: 0,
              groupId: 1,
              serialId: chapter.chapterId,
              startSentenceIndex: 0,
            },
            {
              endSentenceIndex: 1,
              groupId: 2,
              serialId: chapter.chapterId,
              startSentenceIndex: 1,
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

        await expect(fragments.listFragmentIds()).resolves.toStrictEqual([0]);

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
        expect(summary).toBe("Alpha beta. Gamma delta.");
      } finally {
        await document.release();
      }
    });
  });
});

async function createSingleChunkGraphArtifact(input: {
  chapterId: number;
  chunkContent: string;
  chunkLabel: string;
  documentPath: string;
}) {
  const document = await DirectoryDocument.open(input.documentPath);

  try {
    await document.openSession(async (openedDocument) => {
      await openedDocument.serials.createWithId(input.chapterId);
      const fragments = openedDocument.getSerialFragments(input.chapterId);
      const draft = await fragments.createDraft();

      draft.addSentence(input.chunkContent, countWords(input.chunkContent));
      await draft.commit();

      await openedDocument.chunks.save({
        content: input.chunkContent,
        generation: 0,
        id: 1,
        label: input.chunkLabel,
        retention: ChunkRetention.Verbatim,
        sentenceId: [input.chapterId, 0],
        sentenceIds: [[input.chapterId, 0]],
        weight: 1,
        wordsCount: countWords(input.chunkContent),
      });
      await openedDocument.fragmentGroups.save({
        endSentenceIndex: 0,
        groupId: 0,
        serialId: input.chapterId,
        startSentenceIndex: 0,
      });
      const snakeId = await openedDocument.snakes.create({
        firstLabel: input.chunkLabel,
        groupId: 0,
        lastLabel: input.chunkLabel,
        localSnakeId: 0,
        serialId: input.chapterId,
        size: 1,
      });

      await openedDocument.snakeChunks.save({
        chunkId: 1,
        position: 0,
        snakeId,
      });
      await openedDocument.serials.setTopologyReady(input.chapterId);
    });
  } finally {
    await document.release();
  }

  return {
    chapterId: input.chapterId,
    documentPath: input.documentPath,
    parameter: {
      prompt: "test graph prompt",
    },
  };
}

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

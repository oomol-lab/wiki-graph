import { describe, expect, it, vi } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";

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
});

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "").length;
}

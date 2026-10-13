import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { addChapter, setChapterSource } from "../../../api/chapter/manage.js";
import { DirectoryDocument } from "../../../document/directory/index.js";
import { listChapters } from "../../../document/chapter/index.js";
import { hydrateSearchTextHit } from "./search/hydration.js";
import { createSourceEvidenceDisplayItems } from "./source-evidence/pagination.js";
import { createEvidenceReadContext } from "./source-evidence/read.js";

describe("raw sentence scores", () => {
  it("preserves zero and absence during source/summary hydration and omits ambiguous range scores", async () => {
    const path = await mkdtemp(join(tmpdir(), "wg-raw-signals-"));
    const document = await DirectoryDocument.open(path);
    try {
      const chapter = await addChapter(document, { title: "Scores" });
      await setChapterSource(document, chapter.chapterId, [
        "First sentence.",
        "Second sentence.",
      ]);
      await document.openSession(async (opened) => {
        await opened.writeSummary(chapter.chapterId, "A summary.");
      });
      const chapters = new Map(
        (await listChapters(document)).map((chapter) => [
          chapter.chapterId,
          chapter,
        ]),
      );
      for (const kind of [1, 2] as const) {
        const hit = {
          archiveId: 0,
          chapterId: chapter.chapterId,
          kind,
          rank: 1,
          score: 0.9,
          sentenceIndex: 0,
          wordsCount: 2,
        };
        const scored = await hydrateSearchTextHit(document, chapters, {
          ...hit,
          ftsScore: 0,
          embeddingScore: 0,
        });
        expect(scored).toMatchObject({
          ftsScore: 0,
          embeddingScore: 0,
          score: 0.9,
        });
        const missing = await hydrateSearchTextHit(document, chapters, hit);
        expect(missing).not.toHaveProperty("ftsScore");
        expect(missing).not.toHaveProperty("embeddingScore");
      }
      const range = {
        chapterId: chapter.chapterId,
        startSentenceIndex: 0,
        endSentenceIndex: 0,
        ftsScore: 0,
        embeddingScore: 0,
        score: 0.8,
      };
      const options = {
        context: createEvidenceReadContext(),
        sourceContext: 0,
      };
      expect(
        (await createSourceEvidenceDisplayItems(document, [range], options))[0],
      ).toMatchObject({ ftsScore: 0, embeddingScore: 0 });
      const merged = (
        await createSourceEvidenceDisplayItems(
          document,
          [
            range,
            {
              ...range,
              startSentenceIndex: 1,
              endSentenceIndex: 1,
              score: 0.7,
            },
          ],
          options,
        )
      )[0];
      expect(merged?.score).toBe(0.8);
      expect(merged).not.toHaveProperty("ftsScore");
      expect(merged).not.toHaveProperty("embeddingScore");
    } finally {
      await document.release();
      await rm(path, { recursive: true, force: true });
    }
  });
});

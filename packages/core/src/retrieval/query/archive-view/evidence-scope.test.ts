import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { addChapter, setChapterSource } from "../../../api/chapter/manage.js";
import { DirectoryDocument } from "../../../document/directory/index.js";
import { listArchiveEvidence } from "./evidence.js";
import { listRelatedArchiveObjects } from "./related/core.js";

describe("scoped archive evidence", () => {
  it("paginates scoped entity and triple evidence in doc-desc order", async () => {
    await withEvidenceDocument(async (document, [firstId, secondId]) => {
      const scope = { chapters: [firstId, secondId] };
      const firstEntityPage = await listArchiveEvidence(
        document,
        "wikg://entity/Q1",
        { ...scope, limit: 1, order: "doc-desc" },
      );
      expect(firstEntityPage.items.map((item) => item.chapterId)).toEqual([
        secondId,
      ]);
      expect(firstEntityPage.nextCursor).not.toBeNull();
      const secondEntityPage = await listArchiveEvidence(
        document,
        "wikg://entity/Q1",
        {
          ...scope,
          cursor: firstEntityPage.nextCursor!,
          limit: 1,
          order: "doc-desc",
        },
      );
      expect(secondEntityPage.items.map((item) => item.chapterId)).toEqual([
        firstId,
      ]);
      expect(secondEntityPage.nextCursor).toBeNull();

      const firstTriplePage = await listArchiveEvidence(
        document,
        "wikg://triple/Q1/relates/Q2",
        { ...scope, limit: 1, order: "doc-desc" },
      );
      expect(firstTriplePage.items.map((item) => item.chapterId)).toEqual([
        secondId,
      ]);
      expect(firstTriplePage.nextCursor).not.toBeNull();
      const secondTriplePage = await listArchiveEvidence(
        document,
        "wikg://triple/Q1/relates/Q2",
        {
          ...scope,
          cursor: firstTriplePage.nextCursor!,
          limit: 1,
          order: "doc-desc",
        },
      );
      expect(secondTriplePage.items.map((item) => item.chapterId)).toEqual([
        firstId,
      ]);
      expect(secondTriplePage.nextCursor).toBeNull();
    });
  });

  it("rejects a text stream outside the related chapter scope", async () => {
    await withEvidenceDocument(async (document, [firstId, secondId]) => {
      await expect(
        listRelatedArchiveObjects(
          document,
          `wikg://chapter/${secondId}/source#1`,
          { chapters: [firstId] },
        ),
      ).rejects.toThrow("not found in this archive scope");
    });
  });
});

async function withEvidenceDocument(
  operation: (
    document: DirectoryDocument,
    chapterIds: readonly [number, number],
  ) => Promise<void>,
): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "wikigraph-evidence-scope-"));
  const document = await DirectoryDocument.open(path);
  try {
    const first = await addChapter(document, { title: "First" });
    const second = await addChapter(document, { title: "Second" });
    await setChapterSource(document, first.chapterId, ["First source text."]);
    await setChapterSource(document, second.chapterId, ["Second source text."]);
    await document.openSession(async (openedDocument) => {
      for (const chapterId of [first.chapterId, second.chapterId]) {
        await openedDocument.mentions.saveMany([
          {
            chapterId,
            id: `q1-${chapterId}`,
            qid: "Q1",
            rangeEnd: 5,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "First",
          },
          {
            chapterId,
            id: `q2-${chapterId}`,
            qid: "Q2",
            rangeEnd: 11,
            rangeStart: 6,
            sentenceIndex: 0,
            surface: "source",
          },
        ]);
        await openedDocument.mentionLinks.save({
          evidenceSentenceIds: [[chapterId, 0]],
          id: `link-${chapterId}`,
          predicate: "relates",
          sourceMentionId: `q1-${chapterId}`,
          targetMentionId: `q2-${chapterId}`,
        });
      }
    });
    await operation(document, [first.chapterId, second.chapterId]);
  } finally {
    await document.release();
    await rm(path, { force: true, recursive: true });
  }
}

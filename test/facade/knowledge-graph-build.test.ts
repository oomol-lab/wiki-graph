import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import {
  buildChapterKnowledgeGraphArtifact,
  clearChapterKnowledgeGraph,
  commitChapterKnowledgeGraphArtifact,
} from "../../src/facade/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/knowledge-graph-build", () => {
  it("commits chapter mention evidence from JSONL artifacts", async () => {
    await withTempDir("spinedigest-knowledge-graph-build-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.serials.createWithId(1);
        });

        const artifact = await buildChapterKnowledgeGraphArtifact(1, {
          mentionLinks: [
            {
              confidence: 0.8,
              evidenceEnd: 15,
              evidenceStart: 0,
              id: "l1",
              predicate: "discusses",
              sourceMentionId: "m1",
              targetMentionId: "m2",
            },
          ],
          mentions: [
            {
              chapterId: 1,
              confidence: 0.95,
              fragmentId: 10,
              id: "m1",
              qid: "Q205194",
              rangeEnd: 2,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "恩典",
            },
            {
              chapterId: 1,
              fragmentId: 10,
              id: "m2",
              qid: "Q9476",
              rangeEnd: 7,
              rangeStart: 3,
              sentenceIndex: 0,
              surface: "自由意志",
            },
          ],
          workspacePath: `${path}/workspace`,
        });

        await commitChapterKnowledgeGraphArtifact(document, artifact);

        expect(await document.mentions.listByChapter(1)).toHaveLength(2);
        expect(await document.mentionLinks.listByChapter(1)).toStrictEqual([
          {
            confidence: 0.8,
            evidenceEnd: 15,
            evidenceStart: 0,
            id: "l1",
            predicate: "discusses",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
        ]);

        const replacementArtifact = await buildChapterKnowledgeGraphArtifact(
          1,
          {
            mentionLinks: [],
            mentions: [
              {
                chapterId: 1,
                fragmentId: 20,
                id: "m3",
                qid: "Q162593",
                rangeEnd: 3,
                rangeStart: 0,
                surface: "伯拉纠",
              },
            ],
            workspacePath: `${path}/workspace`,
          },
        );

        await commitChapterKnowledgeGraphArtifact(
          document,
          replacementArtifact,
        );

        expect(await document.mentions.listByChapter(1)).toStrictEqual([
          {
            chapterId: 1,
            fragmentId: 20,
            id: "m3",
            qid: "Q162593",
            rangeEnd: 3,
            rangeStart: 0,
            surface: "伯拉纠",
          },
        ]);
        expect(await document.mentionLinks.listByChapter(1)).toStrictEqual([]);

        await clearChapterKnowledgeGraph(document, 1);

        expect(await document.mentions.listByChapter(1)).toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("rejects mention links that point outside the artifact", async () => {
    await withTempDir("spinedigest-knowledge-graph-build-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        const artifact = await buildChapterKnowledgeGraphArtifact(1, {
          mentionLinks: [
            {
              id: "l1",
              predicate: "mentions",
              sourceMentionId: "m1",
              targetMentionId: "missing",
            },
          ],
          mentions: [
            {
              chapterId: 1,
              fragmentId: 10,
              id: "m1",
              qid: "Q1",
              rangeEnd: 1,
              rangeStart: 0,
              surface: "A",
            },
          ],
          workspacePath: `${path}/workspace`,
        });

        await expect(
          commitChapterKnowledgeGraphArtifact(document, artifact),
        ).rejects.toThrow(
          "Mention link l1 references unknown target mention missing.",
        );
      } finally {
        await document.release();
      }
    });
  });
});

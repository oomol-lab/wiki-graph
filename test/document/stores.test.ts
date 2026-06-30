import { describe, expect, it } from "vitest";

import {
  ChunkImportance,
  ChunkRetention,
  DirectoryDocument,
} from "../../src/document/index.js";
import { withTempDir } from "../helpers/temp.js";

async function withDocument(
  operation: (document: DirectoryDocument) => Promise<void>,
): Promise<void> {
  await withTempDir("spinedigest-stores-", async (path) => {
    const document = await DirectoryDocument.open(path);

    try {
      await operation(document);
    } finally {
      await document.release();
    }
  });
}

describe("document/stores", () => {
  it("manages serial lifecycle and topology state", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        expect(await openedDocument.serials.getMaxId()).toBe(0);
        expect(await openedDocument.serials.listIds()).toStrictEqual([]);

        const serialId = await openedDocument.serials.create();

        expect(serialId).toBe(1);
        expect(await openedDocument.serials.getById(1)).toStrictEqual({
          id: 1,
          topologyReady: false,
        });

        await openedDocument.serials.createWithId(5);
        await openedDocument.serials.ensure(3);
        await openedDocument.serials.ensure(5);
        await openedDocument.serials.setTopologyReady(3);
        await openedDocument.serials.setTopologyReady(5);

        await expect(openedDocument.serials.createWithId(5)).rejects.toThrow(
          "Serial 5 already exists",
        );

        expect(await openedDocument.serials.getById(3)).toStrictEqual({
          id: 3,
          topologyReady: true,
        });
        expect(await openedDocument.serials.getById(5)).toStrictEqual({
          id: 5,
          topologyReady: true,
        });
        expect(await openedDocument.serials.getById(99)).toBeUndefined();
        expect(await openedDocument.serials.getMaxId()).toBe(5);
        expect(await openedDocument.serials.listIds()).toStrictEqual([1, 3, 5]);
      });
    });
  });

  it("saves and clears mention evidence by chapter", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        await openedDocument.serials.createWithId(1);
        await openedDocument.serials.createWithId(2);

        await openedDocument.mentions.saveMany([
          {
            chapterId: 1,
            confidence: 0.9,
            fragmentId: 10,
            id: "m1",
            qid: "Q1",
            rangeEnd: 2,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "恩典",
          },
          {
            chapterId: 1,
            fragmentId: 10,
            id: "m2",
            note: "神学语境",
            qid: "Q2",
            rangeEnd: 7,
            rangeStart: 3,
            sentenceIndex: 0,
            surface: "自由意志",
          },
          {
            chapterId: 2,
            fragmentId: 20,
            id: "m3",
            qid: "Q3",
            rangeEnd: 3,
            rangeStart: 0,
            surface: "伯拉纠",
          },
        ]);
        await openedDocument.mentionLinks.saveMany([
          {
            confidence: 0.8,
            evidenceSentenceIds: [[1, 10, 0]],
            id: "l1",
            predicate: "discusses",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
          {
            evidenceSentenceIds: [[2, 20, 0]],
            id: "l2",
            note: "cross chapter evidence is removed with either endpoint",
            predicate: "mentions",
            sourceMentionId: "m2",
            targetMentionId: "m3",
          },
        ]);

        expect(await openedDocument.mentions.getById("m1")).toStrictEqual({
          chapterId: 1,
          confidence: 0.9,
          fragmentId: 10,
          id: "m1",
          qid: "Q1",
          rangeEnd: 2,
          rangeStart: 0,
          sentenceIndex: 0,
          surface: "恩典",
        });
        expect(await openedDocument.mentionLinks.listByChapter(1)).toHaveLength(
          2,
        );

        await openedDocument.mentionLinks.deleteByChapter(1);
        await openedDocument.mentions.deleteByChapter(1);

        expect(await openedDocument.mentions.listByChapter(1)).toStrictEqual(
          [],
        );
        expect(
          await openedDocument.mentionLinks.listByChapter(1),
        ).toStrictEqual([]);
        expect(await openedDocument.mentions.listByChapter(2)).toStrictEqual([
          {
            chapterId: 2,
            fragmentId: 20,
            id: "m3",
            qid: "Q3",
            rangeEnd: 3,
            rangeStart: 0,
            surface: "伯拉纠",
          },
        ]);
      });
    });
  });

  it("saves chunks and queries them by id, serial, and fragment", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        await openedDocument.serials.createWithId(1);
        await openedDocument.serials.createWithId(2);

        await openedDocument.chunks.save({
          content: "Alpha replacement",
          generation: 1,
          id: 100,
          importance: ChunkImportance.Critical,
          label: "Chunk A2",
          retention: ChunkRetention.Focused,
          sentenceId: [1, 10, 0],
          sentenceIds: [[1, 10, 0]],
          wordsCount: 13,
          weight: 1.25,
        });
        await openedDocument.chunks.save({
          content: "Beta",
          generation: 0,
          id: 101,
          label: "Chunk B",
          sentenceId: [1, 20, 0],
          sentenceIds: [
            [1, 20, 0],
            [1, 20, 1],
          ],
          wordsCount: 7,
          weight: 0.5,
        });
        await openedDocument.chunks.save({
          content: "Gamma",
          generation: 0,
          id: 200,
          importance: ChunkImportance.Helpful,
          label: "Chunk C",
          retention: ChunkRetention.Relevant,
          sentenceId: [2, 10, 0],
          sentenceIds: [[2, 10, 0]],
          wordsCount: 9,
          weight: 0.8,
        });

        expect(await openedDocument.chunks.getById(100)).toStrictEqual({
          content: "Alpha replacement",
          generation: 1,
          id: 100,
          importance: ChunkImportance.Critical,
          label: "Chunk A2",
          retention: ChunkRetention.Focused,
          sentenceId: [1, 10, 0],
          sentenceIds: [[1, 10, 0]],
          wordsCount: 13,
          weight: 1.25,
        });
        expect(await openedDocument.chunks.getById(999)).toBeUndefined();
        expect(await openedDocument.chunks.listAll()).toStrictEqual([
          {
            content: "Alpha replacement",
            generation: 1,
            id: 100,
            importance: ChunkImportance.Critical,
            label: "Chunk A2",
            retention: ChunkRetention.Focused,
            sentenceId: [1, 10, 0],
            sentenceIds: [[1, 10, 0]],
            wordsCount: 13,
            weight: 1.25,
          },
          {
            content: "Beta",
            generation: 0,
            id: 101,
            label: "Chunk B",
            sentenceId: [1, 20, 0],
            sentenceIds: [
              [1, 20, 0],
              [1, 20, 1],
            ],
            wordsCount: 7,
            weight: 0.5,
          },
          {
            content: "Gamma",
            generation: 0,
            id: 200,
            importance: ChunkImportance.Helpful,
            label: "Chunk C",
            retention: ChunkRetention.Relevant,
            sentenceId: [2, 10, 0],
            sentenceIds: [[2, 10, 0]],
            wordsCount: 9,
            weight: 0.8,
          },
        ]);
        expect(
          await openedDocument.chunks.listByFragments(1, []),
        ).toStrictEqual([]);
        expect(
          await openedDocument.chunks.listByFragments(1, [20, 10, 99]),
        ).toStrictEqual([
          {
            content: "Alpha replacement",
            generation: 1,
            id: 100,
            importance: ChunkImportance.Critical,
            label: "Chunk A2",
            retention: ChunkRetention.Focused,
            sentenceId: [1, 10, 0],
            sentenceIds: [[1, 10, 0]],
            wordsCount: 13,
            weight: 1.25,
          },
          {
            content: "Beta",
            generation: 0,
            id: 101,
            label: "Chunk B",
            sentenceId: [1, 20, 0],
            sentenceIds: [
              [1, 20, 0],
              [1, 20, 1],
            ],
            wordsCount: 7,
            weight: 0.5,
          },
        ]);
        expect(await openedDocument.chunks.listBySerial(1)).toStrictEqual([
          {
            content: "Alpha replacement",
            generation: 1,
            id: 100,
            importance: ChunkImportance.Critical,
            label: "Chunk A2",
            retention: ChunkRetention.Focused,
            sentenceId: [1, 10, 0],
            sentenceIds: [[1, 10, 0]],
            wordsCount: 13,
            weight: 1.25,
          },
          {
            content: "Beta",
            generation: 0,
            id: 101,
            label: "Chunk B",
            sentenceId: [1, 20, 0],
            sentenceIds: [
              [1, 20, 0],
              [1, 20, 1],
            ],
            wordsCount: 7,
            weight: 0.5,
          },
        ]);
        expect(await openedDocument.chunks.getMaxId()).toBe(200);
        expect(await openedDocument.chunks.listFragmentPairs()).toStrictEqual([
          [1, 10],
          [1, 20],
          [2, 10],
        ]);
      });
    });
  });

  it("saves knowledge edges and filters them by direction and serial", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        await openedDocument.serials.createWithId(1);
        await openedDocument.serials.createWithId(2);

        for (const chunk of [
          {
            content: "Alpha",
            generation: 0,
            id: 100,
            label: "Chunk A",
            sentenceId: [1, 10, 0] as const,
            sentenceIds: [[1, 10, 0]] as const,
            wordsCount: 10,
            weight: 1,
          },
          {
            content: "Beta",
            generation: 0,
            id: 101,
            label: "Chunk B",
            sentenceId: [1, 20, 0] as const,
            sentenceIds: [[1, 20, 0]] as const,
            wordsCount: 11,
            weight: 1.1,
          },
          {
            content: "Gamma",
            generation: 0,
            id: 200,
            label: "Chunk C",
            sentenceId: [2, 10, 0] as const,
            sentenceIds: [[2, 10, 0]] as const,
            wordsCount: 12,
            weight: 1.2,
          },
        ]) {
          await openedDocument.chunks.save(chunk);
        }

        await openedDocument.readingEdges.save({
          fromId: 100,
          strength: "strong",
          toId: 101,
          weight: 0.9,
        });
        await openedDocument.readingEdges.save({
          fromId: 101,
          toId: 100,
          weight: 0.7,
        });
        await openedDocument.readingEdges.save({
          fromId: 100,
          toId: 200,
          weight: 0.4,
        });

        expect(await openedDocument.readingEdges.listAll()).toStrictEqual([
          {
            fromId: 100,
            strength: "strong",
            toId: 101,
            weight: 0.9,
          },
          {
            fromId: 100,
            toId: 200,
            weight: 0.4,
          },
          {
            fromId: 101,
            toId: 100,
            weight: 0.7,
          },
        ]);
        expect(
          await openedDocument.readingEdges.listIncoming(100),
        ).toStrictEqual([{ fromId: 101, toId: 100, weight: 0.7 }]);
        expect(
          await openedDocument.readingEdges.listOutgoing(100),
        ).toStrictEqual([
          {
            fromId: 100,
            strength: "strong",
            toId: 101,
            weight: 0.9,
          },
          {
            fromId: 100,
            toId: 200,
            weight: 0.4,
          },
        ]);
        expect(await openedDocument.readingEdges.listBySerial(1)).toStrictEqual(
          [
            {
              fromId: 100,
              strength: "strong",
              toId: 101,
              weight: 0.9,
            },
            {
              fromId: 101,
              toId: 100,
              weight: 0.7,
            },
          ],
        );
      });
    });
  });

  it("stores snakes, snake relations, and fragment groups", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        await openedDocument.serials.createWithId(1);
        await openedDocument.serials.createWithId(2);

        for (const chunk of [
          {
            content: "Alpha",
            generation: 0,
            id: 100,
            label: "Chunk A",
            sentenceId: [1, 10, 0] as const,
            sentenceIds: [[1, 10, 0]] as const,
            wordsCount: 10,
            weight: 1,
          },
          {
            content: "Beta",
            generation: 0,
            id: 101,
            label: "Chunk B",
            sentenceId: [1, 20, 0] as const,
            sentenceIds: [[1, 20, 0]] as const,
            wordsCount: 11,
            weight: 1.1,
          },
          {
            content: "Gamma",
            generation: 0,
            id: 200,
            label: "Chunk C",
            sentenceId: [2, 10, 0] as const,
            sentenceIds: [[2, 10, 0]] as const,
            wordsCount: 12,
            weight: 1.2,
          },
        ]) {
          await openedDocument.chunks.save(chunk);
        }

        const firstSnakeId = await openedDocument.snakes.create({
          firstLabel: "Chunk A",
          groupId: 1,
          lastLabel: "Chunk B",
          localSnakeId: 0,
          serialId: 1,
          size: 2,
        });
        const secondSnakeId = await openedDocument.snakes.create({
          firstLabel: "Chunk C",
          groupId: 2,
          lastLabel: "Chunk C",
          localSnakeId: 0,
          serialId: 1,
          size: 1,
          wordsCount: 22,
          weight: 2.5,
        });
        const thirdSnakeId = await openedDocument.snakes.create({
          firstLabel: "Other",
          groupId: 1,
          lastLabel: "Other",
          localSnakeId: 0,
          serialId: 2,
          size: 1,
        });

        expect(firstSnakeId).toBe(1);
        expect(secondSnakeId).toBe(2);
        expect(thirdSnakeId).toBe(3);
        expect(await openedDocument.snakes.getById(firstSnakeId)).toStrictEqual(
          {
            firstLabel: "Chunk A",
            groupId: 1,
            id: 1,
            lastLabel: "Chunk B",
            localSnakeId: 0,
            serialId: 1,
            size: 2,
            wordsCount: 0,
            weight: 0,
          },
        );
        expect(await openedDocument.snakes.listIdsByGroup(1, 1)).toStrictEqual([
          1,
        ]);
        expect(await openedDocument.snakes.listBySerial(1)).toStrictEqual([
          {
            firstLabel: "Chunk A",
            groupId: 1,
            id: 1,
            lastLabel: "Chunk B",
            localSnakeId: 0,
            serialId: 1,
            size: 2,
            wordsCount: 0,
            weight: 0,
          },
          {
            firstLabel: "Chunk C",
            groupId: 2,
            id: 2,
            lastLabel: "Chunk C",
            localSnakeId: 0,
            serialId: 1,
            size: 1,
            wordsCount: 22,
            weight: 2.5,
          },
        ]);

        await openedDocument.snakeChunks.save({
          chunkId: 101,
          position: 1,
          snakeId: firstSnakeId,
        });
        await openedDocument.snakeChunks.save({
          chunkId: 100,
          position: 0,
          snakeId: firstSnakeId,
        });

        expect(
          await openedDocument.snakeChunks.listChunkIds(firstSnakeId),
        ).toStrictEqual([100, 101]);
        expect(
          await openedDocument.snakeChunks.listBySnake(firstSnakeId),
        ).toStrictEqual([
          {
            chunkId: 100,
            position: 0,
            snakeId: 1,
          },
          {
            chunkId: 101,
            position: 1,
            snakeId: 1,
          },
        ]);

        await openedDocument.snakeEdges.save({
          fromSnakeId: firstSnakeId,
          toSnakeId: secondSnakeId,
          weight: 0.6,
        });
        await openedDocument.snakeEdges.save({
          fromSnakeId: secondSnakeId,
          toSnakeId: firstSnakeId,
          weight: 0.8,
        });
        await openedDocument.snakeEdges.save({
          fromSnakeId: firstSnakeId,
          toSnakeId: thirdSnakeId,
          weight: 0.2,
        });

        expect(
          await openedDocument.snakeEdges.listIncoming(firstSnakeId),
        ).toStrictEqual([
          {
            fromSnakeId: 2,
            toSnakeId: 1,
            weight: 0.8,
          },
        ]);
        expect(
          await openedDocument.snakeEdges.listOutgoing(firstSnakeId),
        ).toStrictEqual([
          {
            fromSnakeId: 1,
            toSnakeId: 2,
            weight: 0.6,
          },
          {
            fromSnakeId: 1,
            toSnakeId: 3,
            weight: 0.2,
          },
        ]);
        expect(await openedDocument.snakeEdges.listWithin([])).toStrictEqual(
          [],
        );
        expect(
          await openedDocument.snakeEdges.listWithin([
            firstSnakeId,
            secondSnakeId,
          ]),
        ).toStrictEqual([
          {
            fromSnakeId: 1,
            toSnakeId: 2,
            weight: 0.6,
          },
          {
            fromSnakeId: 2,
            toSnakeId: 1,
            weight: 0.8,
          },
        ]);
        expect(await openedDocument.snakeEdges.listBySerial(1)).toStrictEqual([
          {
            fromSnakeId: 1,
            toSnakeId: 2,
            weight: 0.6,
          },
          {
            fromSnakeId: 2,
            toSnakeId: 1,
            weight: 0.8,
          },
        ]);

        await openedDocument.fragmentGroups.save({
          fragmentId: 10,
          groupId: 1,
          serialId: 1,
        });
        await openedDocument.fragmentGroups.saveMany([
          {
            fragmentId: 20,
            groupId: 2,
            serialId: 1,
          },
          {
            fragmentId: 21,
            groupId: 2,
            serialId: 1,
          },
          {
            fragmentId: 10,
            groupId: 1,
            serialId: 2,
          },
        ]);

        expect(
          await openedDocument.fragmentGroups.listBySerial(1),
        ).toStrictEqual([
          {
            fragmentId: 10,
            groupId: 1,
            serialId: 1,
          },
          {
            fragmentId: 20,
            groupId: 2,
            serialId: 1,
          },
          {
            fragmentId: 21,
            groupId: 2,
            serialId: 1,
          },
        ]);
        expect(
          await openedDocument.fragmentGroups.listSerialIds(),
        ).toStrictEqual([1, 2]);
        expect(
          await openedDocument.fragmentGroups.listGroupIdsForSerial(1),
        ).toStrictEqual([1, 2]);
      });
    });
  });
});

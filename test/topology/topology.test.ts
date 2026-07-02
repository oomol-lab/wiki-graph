import { describe, expect, it, vi } from "vitest";

const { groupFragmentsMock } = vi.hoisted(() => ({
  groupFragmentsMock: vi.fn(),
}));

vi.mock("../../src/topology/grouping.js", () => ({
  groupFragments: groupFragmentsMock,
}));

import { ChunkImportance, ChunkRetention } from "../../src/document/index.js";
import type {
  ChunkRecord,
  Document,
  ReadingEdgeRecord,
  ReadonlySerialFragments,
} from "../../src/document/index.js";
import { Topology } from "../../src/topology/topology.js";

describe("topology/topology", () => {
  it("merges deltas, applies annotations, and persists weighted topology output", async () => {
    groupFragmentsMock.mockResolvedValue([
      {
        endSentenceIndex: 1,
        groupId: 0,
        serialId: 7,
        startSentenceIndex: 1,
      },
      {
        endSentenceIndex: 2,
        groupId: 0,
        serialId: 7,
        startSentenceIndex: 2,
      },
    ]);
    const {
      document,
      ensureSerial,
      getSerialFragments,
      saveChunk,
      saveEdge,
      saveFragmentGroups,
      createSnake,
      saveSnakeChunk,
      saveSnakeEdge,
    } = createDocumentStub();
    const topology = new Topology(document, 7, 120);

    topology.accept({
      chunks: [
        createReaderChunk(2, 2, {
          retention: ChunkRetention.Focused,
        }),
        createReaderChunk(1, 1, {
          retention: ChunkRetention.Relevant,
        }),
      ],
      edges: [
        {
          fromId: 2,
          toId: 1,
        },
      ],
    });
    topology.accept({
      chunks: [],
      edges: [
        {
          fromId: 2,
          strength: "critical",
          toId: 1,
        },
      ],
      importanceAnnotations: [
        {
          chunkId: 2,
          importance: ChunkImportance.Critical,
        },
        {
          chunkId: 999,
          importance: ChunkImportance.Helpful,
        },
      ],
    });

    await topology.finalize();

    const createdChunks = saveChunk.mock.calls as Array<
      [Omit<ChunkRecord, "id">]
    >;
    const savedEdges = saveEdge.mock.calls as Array<[ReadingEdgeRecord]>;

    expect(ensureSerial).toHaveBeenCalledWith(7);
    expect(createdChunks.map(([record]) => record)).toStrictEqual([
      {
        content: "Chunk 1",
        generation: 0,
        label: "Chunk 1",
        retention: ChunkRetention.Relevant,
        sentenceId: [7, 1],
        sentenceIds: [[7, 1]],
        wordsCount: 5,
        weight: 1,
      },
      {
        content: "Chunk 2",
        generation: 0,
        importance: ChunkImportance.Critical,
        label: "Chunk 2",
        retention: ChunkRetention.Focused,
        sentenceId: [7, 2],
        sentenceIds: [[7, 2]],
        wordsCount: 5,
        weight: 12,
      },
    ]);
    expect(savedEdges.map(([record]) => record)).toStrictEqual([
      {
        fromId: 2,
        strength: "critical",
        toId: 1,
        weight: 13,
      },
    ]);
    expect(groupFragmentsMock).toHaveBeenCalledWith({
      chunks: [
        {
          content: "Chunk 1",
          generation: 0,
          id: 1,
          label: "Chunk 1",
          retention: ChunkRetention.Relevant,
          sentenceId: [7, 1],
          sentenceIds: [[7, 1]],
          wordsCount: 5,
          weight: 1,
        },
        {
          content: "Chunk 2",
          generation: 0,
          id: 2,
          importance: ChunkImportance.Critical,
          label: "Chunk 2",
          retention: ChunkRetention.Focused,
          sentenceId: [7, 2],
          sentenceIds: [[7, 2]],
          wordsCount: 5,
          weight: 12,
        },
      ],
      edges: [
        {
          fromId: 2,
          strength: "critical",
          toId: 1,
          weight: 13,
        },
      ],
      fragments: getSerialFragments(),
      groupWordsCount: 120,
      serialId: 7,
    });
    expect(saveFragmentGroups).toHaveBeenCalledWith([
      {
        endSentenceIndex: 1,
        groupId: 0,
        serialId: 7,
        startSentenceIndex: 1,
      },
      {
        endSentenceIndex: 2,
        groupId: 0,
        serialId: 7,
        startSentenceIndex: 2,
      },
    ]);
    expect(createSnake).toHaveBeenCalledTimes(1);
    expect(createSnake).toHaveBeenCalledWith({
      firstLabel: "Chunk 1",
      groupId: 0,
      lastLabel: "Chunk 2",
      localSnakeId: 0,
      serialId: 7,
      size: 2,
      weight: 13,
      wordsCount: 10,
    });
    expect(saveSnakeChunk.mock.calls).toStrictEqual([
      [
        {
          chunkId: 1,
          position: 0,
          snakeId: 1,
        },
      ],
      [
        {
          chunkId: 2,
          position: 1,
          snakeId: 1,
        },
      ],
    ]);
    expect(saveSnakeEdge).not.toHaveBeenCalled();
  });

  it("keeps cross-group relations out of persisted snake edges", async () => {
    groupFragmentsMock.mockResolvedValue([
      {
        endSentenceIndex: 2,
        groupId: 0,
        serialId: 7,
        startSentenceIndex: 1,
      },
      {
        endSentenceIndex: 3,
        groupId: 1,
        serialId: 7,
        startSentenceIndex: 3,
      },
    ]);
    const { document, createSnake, saveSnakeChunk, saveSnakeEdge } =
      createDocumentStub();
    const topology = new Topology(document, 7, 120);

    topology.accept({
      chunks: [
        createReaderChunk(1, 1),
        createReaderChunk(2, 2),
        createReaderChunk(3, 3),
      ],
      edges: [
        {
          fromId: 2,
          toId: 1,
        },
        {
          fromId: 3,
          toId: 1,
        },
      ],
    });

    await topology.finalize();

    expect(createSnake.mock.calls).toStrictEqual([
      [
        {
          firstLabel: "Chunk 1",
          groupId: 0,
          lastLabel: "Chunk 2",
          localSnakeId: 0,
          serialId: 7,
          size: 2,
          weight: 0,
          wordsCount: 10,
        },
      ],
      [
        {
          firstLabel: "Chunk 3",
          groupId: 1,
          lastLabel: "Chunk 3",
          localSnakeId: 0,
          serialId: 7,
          size: 1,
          weight: 0,
          wordsCount: 5,
        },
      ],
    ]);
    expect(saveSnakeChunk.mock.calls).toStrictEqual([
      [
        {
          chunkId: 1,
          position: 0,
          snakeId: 1,
        },
      ],
      [
        {
          chunkId: 2,
          position: 1,
          snakeId: 1,
        },
      ],
      [
        {
          chunkId: 3,
          position: 0,
          snakeId: 2,
        },
      ],
    ]);
    expect(saveSnakeEdge).not.toHaveBeenCalled();
  });

  it("splits a connected component into multiple snakes and normalizes snake-edge direction", async () => {
    groupFragmentsMock.mockResolvedValue([
      {
        endSentenceIndex: 1,
        groupId: 0,
        serialId: 7,
        startSentenceIndex: 1,
      },
    ]);
    const { document, createSnake, saveSnakeChunk, saveSnakeEdge } =
      createDocumentStub();
    const topology = new Topology(document, 7, 120);

    topology.accept({
      chunks: [
        createReaderChunk(1, 1, {
          wordsCount: 400,
        }),
        createReaderChunk(2, 1, {
          wordsCount: 400,
        }),
        createReaderChunk(3, 1, {
          wordsCount: 400,
        }),
      ],
      edges: [
        {
          fromId: 3,
          toId: 2,
        },
        {
          fromId: 2,
          toId: 1,
        },
      ],
    });

    await topology.finalize();

    expect(createSnake.mock.calls).toStrictEqual([
      [
        {
          firstLabel: "Chunk 1",
          groupId: 0,
          lastLabel: "Chunk 1",
          localSnakeId: 0,
          serialId: 7,
          size: 1,
          weight: 0,
          wordsCount: 400,
        },
      ],
      [
        {
          firstLabel: "Chunk 2",
          groupId: 0,
          lastLabel: "Chunk 2",
          localSnakeId: 1,
          serialId: 7,
          size: 1,
          weight: 0,
          wordsCount: 400,
        },
      ],
      [
        {
          firstLabel: "Chunk 3",
          groupId: 0,
          lastLabel: "Chunk 3",
          localSnakeId: 2,
          serialId: 7,
          size: 1,
          weight: 0,
          wordsCount: 400,
        },
      ],
    ]);
    expect(saveSnakeChunk.mock.calls).toStrictEqual([
      [
        {
          chunkId: 1,
          position: 0,
          snakeId: 1,
        },
      ],
      [
        {
          chunkId: 2,
          position: 0,
          snakeId: 2,
        },
      ],
      [
        {
          chunkId: 3,
          position: 0,
          snakeId: 3,
        },
      ],
    ]);
    expect(saveSnakeEdge.mock.calls).toStrictEqual([
      [
        {
          fromSnakeId: 1,
          toSnakeId: 2,
          weight: 0.1,
        },
      ],
      [
        {
          fromSnakeId: 2,
          toSnakeId: 3,
          weight: 0.1,
        },
      ],
    ]);
  });
});

function createDocumentStub(): {
  readonly document: Document;
  readonly createSnake: ReturnType<typeof vi.fn>;
  readonly ensureSerial: ReturnType<typeof vi.fn>;
  readonly getSerialFragments: () => ReadonlySerialFragments;
  readonly saveChunk: ReturnType<typeof vi.fn>;
  readonly saveEdge: ReturnType<typeof vi.fn>;
  readonly saveFragmentGroups: ReturnType<typeof vi.fn>;
  readonly saveSnakeChunk: ReturnType<typeof vi.fn>;
  readonly saveSnakeEdge: ReturnType<typeof vi.fn>;
} {
  const fragments = {
    getFragment: (fragmentId: number) =>
      Promise.resolve({
        fragmentId,
        sentences: [
          {
            text: `Fragment ${fragmentId}`,
            wordsCount: 10,
          },
        ],
        serialId: 7,
        summary: "",
      }),
    listFragmentIds: () => Promise.resolve([1, 2]),
    path: "/tmp/fragments",
    serialId: 7,
  } satisfies ReadonlySerialFragments;
  let nextChunkId = 1;
  const saveChunk = vi.fn((record: Omit<ChunkRecord, "id">) => {
    const id = nextChunkId;

    nextChunkId += 1;
    return Promise.resolve({
      ...record,
      id,
    });
  });
  const saveEdge = vi.fn(() => Promise.resolve());
  const saveFragmentGroups = vi.fn(() => Promise.resolve());
  let nextSnakeId = 1;
  const createSnake = vi.fn(() => Promise.resolve(nextSnakeId++));
  const saveSnakeChunk = vi.fn(() => Promise.resolve());
  const saveSnakeEdge = vi.fn(() => Promise.resolve());
  const ensureSerial = vi.fn(() => Promise.resolve());
  const getSerialFragments = () => fragments;

  return {
    createSnake,
    document: {
      chunks: {
        create: saveChunk,
      },
      fragmentGroups: {
        saveMany: saveFragmentGroups,
      },
      getSerialFragments,
      readingEdges: {
        save: saveEdge,
      },
      serials: {
        ensure: ensureSerial,
      },
      snakeChunks: {
        save: saveSnakeChunk,
      },
      snakeEdges: {
        save: saveSnakeEdge,
      },
      snakes: {
        create: createSnake,
      },
    } as unknown as Document,
    ensureSerial,
    getSerialFragments,
    saveChunk,
    saveEdge,
    saveFragmentGroups,
    saveSnakeChunk,
    saveSnakeEdge,
  };
}

function createReaderChunk(
  id: number,
  sentenceIndex: number,
  extra: {
    readonly importance?: ChunkImportance;
    readonly retention?: ChunkRetention;
    readonly wordsCount?: number;
  } = {},
) {
  return {
    content: `Chunk ${id}`,
    generation: 0,
    id,
    label: `Chunk ${id}`,
    links: [],
    sentenceId: [7, sentenceIndex] as const,
    sentenceIds: [[7, sentenceIndex] as const],
    wordsCount: extra.wordsCount ?? 5,
    ...extra,
  };
}

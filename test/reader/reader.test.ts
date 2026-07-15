import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  extractBookCoherenceChunkBatchMock,
  extractUserFocusedChunkBatchMock,
  segmentTextStreamMock,
} = vi.hoisted(() => ({
  extractBookCoherenceChunkBatchMock: vi.fn(),
  extractUserFocusedChunkBatchMock: vi.fn(),
  segmentTextStreamMock: vi.fn(),
}));

vi.mock("../../packages/core/src/reader/chunk-batch/extract.js", () => ({
  extractBookCoherenceChunkBatch: extractBookCoherenceChunkBatchMock,
  extractUserFocusedChunkBatch: extractUserFocusedChunkBatchMock,
}));

vi.mock("../../packages/core/src/reader/segment/segment.js", () => ({
  segmentTextStream: segmentTextStreamMock,
}));

import { Reader } from "../../packages/core/src/reader/reader.js";
import { Language } from "../../packages/core/src/common/language.js";
import {
  WIKI_GRAPH_READER_SCOPES,
  WikiGraphScope,
} from "../../packages/core/src/common/llm-scope.js";
import { ChunkImportance, ChunkRetention } from "../../packages/core/src/document/index.js";
import type {
  SentenceStreamAdapter,
  SentenceStreamItem,
  TextStream,
} from "../../packages/core/src/reader/segment/types.js";

describe("reader/reader", () => {
  beforeEach(() => {
    extractBookCoherenceChunkBatchMock.mockReset();
    extractUserFocusedChunkBatchMock.mockReset();
    segmentTextStreamMock.mockReset();
  });

  it("delegates segmentation with and without a custom adapter", async () => {
    segmentTextStreamMock
      .mockReturnValueOnce(createSegments(["Alpha."]))
      .mockReturnValueOnce(createSegments(["Beta."]));

    const reader = createReader();
    const defaultSegments = await collectSegments(reader.segment(["Alpha."]));

    expect(defaultSegments).toStrictEqual(["Alpha."]);
    expect(segmentTextStreamMock).toHaveBeenNthCalledWith(1, ["Alpha."]);

    const adapter = {
      pipe: vi.fn<(stream: TextStream) => AsyncIterable<SentenceStreamItem>>(
        () => createSegments(["unused"]),
      ),
    } satisfies SentenceStreamAdapter;
    const customReader = createReader({
      segmenter: adapter,
    });
    const customSegments = await collectSegments(
      customReader.segment(["Beta."]),
    );

    expect(customSegments).toStrictEqual(["Beta."]);
    expect(segmentTextStreamMock).toHaveBeenNthCalledWith(2, ["Beta."], {
      adapter,
    });
  });

  it("passes attention context into extraction and resets state on clear", async () => {
    extractUserFocusedChunkBatchMock
      .mockResolvedValueOnce({
        chunkBatch: {
          chunks: [
            createChunk(0, 0, [1, 0], "Alpha", "Alpha content", {
              retention: ChunkRetention.Focused,
            }),
          ],
          links: [],
          orderCorrect: true,
          tempIds: ["temp-a"],
        },
        fragmentSummary: "Fragment summary",
      })
      .mockResolvedValueOnce({
        chunkBatch: {
          chunks: [
            createChunk(0, 0, [1, 1], "Gamma", "Gamma content", {
              retention: ChunkRetention.Relevant,
            }),
          ],
          links: [],
          orderCorrect: true,
          tempIds: ["temp-c"],
        },
        fragmentSummary: "After clear",
      });
    extractBookCoherenceChunkBatchMock.mockResolvedValue({
      chunks: [
        createChunk(0, 0, [1, 1], "Beta", "Beta content", {
          importance: ChunkImportance.Important,
        }),
      ],
      importanceAnnotations: [
        {
          chunkId: 2,
          importance: ChunkImportance.Important,
        },
      ],
      links: [
        {
          from: "temp-b",
          strength: "medium",
          to: 1,
        },
      ],
      orderCorrect: true,
      tempIds: ["temp-b"],
    });

    const reader = createReader();
    const userFocused = await reader.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0],
          text: "Alpha sentence.",
          wordsCount: 2,
        },
      ],
      text: "Alpha sentence.",
    });

    expect(userFocused.fragmentSummary).toBe("Fragment summary");
    expect(userFocused.delta.chunks.map((chunk) => chunk.id)).toStrictEqual([
      1,
    ]);
    expect(extractUserFocusedChunkBatchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        extractionGuidance: "Focus on plot",
        scopes: {
          choice: WikiGraphScope.ReaderChoice,
          extraction: WikiGraphScope.ReaderExtraction,
        },
        userLanguage: Language.English,
      }),
      {
        sentences: [
          {
            sentenceId: [1, 0],
            text: "Alpha sentence.",
            wordsCount: 2,
          },
        ],
        text: "Alpha sentence.",
        visibleChunkIds: [],
        workingMemoryPrompt: "(empty)",
      },
    );

    const coherenceDelta = await reader.extractBookCoherence({
      sentences: [
        {
          sentenceId: [1, 1],
          text: "Beta sentence.",
          wordsCount: 3,
        },
      ],
      text: "Beta sentence.",
      userFocusedChunks: userFocused.delta.chunks,
    });

    expect(extractBookCoherenceChunkBatchMock).toHaveBeenCalledWith(
      expect.any(Object),
      {
        sentences: [
          {
            sentenceId: [1, 1],
            text: "Beta sentence.",
            wordsCount: 3,
          },
        ],
        text: "Beta sentence.",
        userFocusedChunks: userFocused.delta.chunks,
        visibleChunkIds: [1],
        workingMemoryPrompt: "(empty)",
      },
    );
    expect(coherenceDelta.chunks.map((chunk) => chunk.id)).toStrictEqual([2]);
    expect(coherenceDelta.edges).toStrictEqual([
      {
        fromId: 2,
        strength: "medium",
        toId: 1,
      },
    ]);
    expect(coherenceDelta.importanceAnnotations).toStrictEqual([
      {
        chunkId: 2,
        importance: ChunkImportance.Important,
      },
    ]);

    reader.completeFragment({
      allChunks: [...userFocused.delta.chunks, ...coherenceDelta.chunks],
      getSuccessorChunkIds: (chunkId) => (chunkId === 1 ? [2] : []),
    });

    reader.clear();

    const afterClear = await reader.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 1],
          text: "Gamma sentence.",
          wordsCount: 4,
        },
      ],
      text: "Gamma sentence.",
    });

    expect(extractUserFocusedChunkBatchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      {
        sentences: [
          {
            sentenceId: [1, 1],
            text: "Gamma sentence.",
            wordsCount: 4,
          },
        ],
        text: "Gamma sentence.",
        visibleChunkIds: [],
        workingMemoryPrompt: "(empty)",
      },
    );
    expect(afterClear.delta.chunks.map((chunk) => chunk.id)).toStrictEqual([3]);
  });

  it("shows the previous fragment to the next fragment user-focused stage", async () => {
    extractUserFocusedChunkBatchMock
      .mockResolvedValueOnce({
        chunkBatch: {
          chunks: [
            createChunk(0, 0, [1, 0], "Alpha", "Alpha content", {
              retention: ChunkRetention.Focused,
            }),
          ],
          links: [],
          orderCorrect: true,
          tempIds: ["temp-a"],
        },
        fragmentSummary: "Fragment summary",
      })
      .mockResolvedValueOnce({
        chunkBatch: {
          chunks: [
            createChunk(0, 0, [1, 1], "Gamma", "Gamma content", {
              retention: ChunkRetention.Relevant,
            }),
          ],
          links: [],
          orderCorrect: true,
          tempIds: ["temp-c"],
        },
        fragmentSummary: "Next fragment",
      });
    extractBookCoherenceChunkBatchMock
      .mockResolvedValueOnce({
        chunks: [
          createChunk(0, 0, [1, 1], "Beta", "Beta content", {
            importance: ChunkImportance.Important,
          }),
        ],
        links: [],
        orderCorrect: true,
        tempIds: ["temp-b"],
      })
      .mockResolvedValueOnce({
        chunks: [],
        links: [],
        orderCorrect: true,
        tempIds: [],
      });

    const reader = createReader();
    const firstUserFocused = await reader.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0],
          text: "Alpha sentence.",
          wordsCount: 2,
        },
      ],
      text: "Alpha sentence.",
    });
    const firstCoherence = await reader.extractBookCoherence({
      sentences: [
        {
          sentenceId: [1, 1],
          text: "Beta sentence.",
          wordsCount: 3,
        },
      ],
      text: "Beta sentence.",
      userFocusedChunks: firstUserFocused.delta.chunks,
    });

    reader.completeFragment({
      allChunks: [...firstUserFocused.delta.chunks, ...firstCoherence.chunks],
      getSuccessorChunkIds: (chunkId) => (chunkId === 1 ? [2] : []),
    });

    await reader.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 1],
          text: "Gamma sentence.",
          wordsCount: 4,
        },
      ],
      text: "Gamma sentence.",
    });

    expect(extractUserFocusedChunkBatchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      {
        sentences: [
          {
            sentenceId: [1, 1],
            text: "Gamma sentence.",
            wordsCount: 4,
          },
        ],
        text: "Gamma sentence.",
        visibleChunkIds: [1, 2],
        workingMemoryPrompt: [
          "1. [Alpha] - Alpha content",
          "2. [Beta] - Beta content",
        ].join("\n"),
      },
    );
  });
});

function createReader(input?: { readonly segmenter?: SentenceStreamAdapter }) {
  let nextId = 1;

  return new Reader<WikiGraphScope>({
    attention: {
      capacity: 2,
      generationDecayFactor: 0.5,
      idGenerator: () => Promise.resolve(nextId++),
    },
    extractionGuidance: "Focus on plot",
    llm: {} as never,
    scopes: WIKI_GRAPH_READER_SCOPES,
    sentenceTextSource: {
      getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
    },
    userLanguage: Language.English,
    ...(input?.segmenter === undefined
      ? {}
      : {
          segmenter: input.segmenter,
        }),
  });
}

function createChunk(
  id: number,
  generation: number,
  sentenceId: readonly [number, number],
  label: string,
  content: string,
  extra: {
    readonly importance?: ChunkImportance;
    readonly retention?: ChunkRetention;
  } = {},
) {
  return {
    content,
    generation,
    id,
    label,
    links: [],
    sentenceId: [...sentenceId] as [number, number],
    sentenceIds: [[...sentenceId] as [number, number]],
    wordsCount: 1,
    ...extra,
  };
}

async function collectSegments(
  iterable: AsyncIterable<{ readonly text: string }>,
): Promise<string[]> {
  const result: string[] = [];

  for await (const segment of iterable) {
    result.push(segment.text);
  }

  return result;
}

async function* createSegments(
  texts: readonly string[],
): AsyncIterable<SentenceStreamItem> {
  let offset = 0;

  for (const text of texts) {
    await Promise.resolve();
    yield {
      offset,
      text,
      wordsCount: text.split(/\s+/).filter(Boolean).length,
    };
    offset += text.length;
  }
}

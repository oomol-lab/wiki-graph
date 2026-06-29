import { describe, expect, it, vi } from "vitest";

import {
  ChunkImportance,
  ChunkRetention,
} from "../../../src/document/index.js";
import { ParsedJsonError } from "../../../src/guaranteed/index.js";
import {
  ChunkBatchParser,
  ChunkMetadataField,
} from "../../../src/reader/chunk-batch/parser.js";
import { FragmentProjection } from "../../../src/reader/chunk-batch/fragment-projection.js";
import type { ChunkExtractionSentence } from "../../../src/reader/chunk-batch/types.js";
import type { LLMessage } from "../../../src/llm/index.js";

describe("reader/chunk-batch/parser", () => {
  it("parses valid chunks from contiguous source sentences", async () => {
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Retention,
      projection: new FragmentProjection(createSentences()),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice: () => Promise.resolve('{"choice":"S1"}'),
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences: createSentences(),
      visibleChunkIds: [10, 11],
    });

    const result = await parser.parse(
      {
        chunks: [
          {
            content: "Joined content",
            evidence: {
              end_anchor: "Beta continues.",
              start_anchor: "Alpha begins.",
            },
            label: "Joined label",
            retention: ChunkRetention.Focused,
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "Fragment summary",
        links: [],
      },
      {
        isLastGenerationAttempt: false,
      },
    );

    expect(result).toStrictEqual({
      chunkBatch: {
        chunks: [
          {
            content: "Joined content",
            generation: 0,
            id: 0,
            label: "Joined label",
            links: [],
            retention: ChunkRetention.Focused,
            sentenceId: [1, 0, 0],
            sentenceIds: [
              [1, 0, 0],
              [1, 0, 1],
            ],
            wordsCount: 5,
          },
        ],
        links: [],
        orderCorrect: true,
        tempIds: ["temp-1"],
      },
      fragmentSummary: "Fragment summary",
    });
  });

  it("uses second-stage choice to resolve ambiguous evidence on the last attempt", async () => {
    const requestChoice = vi.fn(
      (_messages: readonly LLMessage[], _index: number, _maxRetries: number) =>
        Promise.resolve('{"choice":"S2"}'),
    );
    const sentences = [
      {
        sentenceId: [1, 0, 0],
        text: "Echo",
        wordsCount: 2,
      },
      {
        sentenceId: [1, 0, 1],
        text: "Echo",
        wordsCount: 3,
      },
    ] satisfies ChunkExtractionSentence[];
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Retention,
      projection: new FragmentProjection(sentences),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences,
      visibleChunkIds: [],
    });

    const result = await parser.parse(
      {
        chunks: [
          {
            content: "Chosen content",
            evidence: {
              start_anchor: "Echo",
            },
            label: "Chosen label",
            retention: ChunkRetention.Relevant,
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      },
      {
        isLastGenerationAttempt: true,
      },
    );

    expect(requestChoice).toHaveBeenCalledTimes(1);
    expect(result.chunkBatch.chunks[0]).toMatchObject({
      sentenceId: [1, 0, 1],
      sentenceIds: [[1, 0, 1]],
      wordsCount: 3,
    });
  });

  it("resolves sentence-id quote evidence without anchor fields", async () => {
    const sentences = createSentences();
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Retention,
      projection: new FragmentProjection(sentences),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice: () => Promise.resolve('{"choice":"S1"}'),
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences,
      visibleChunkIds: [],
    });

    const result = await parser.parse(
      {
        chunks: [
          {
            content: "Quote content",
            evidence: {
              quote: "Beta continues",
              sentence_id: "S2",
            },
            label: "Quote label",
            retention: ChunkRetention.Focused,
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      },
      {
        isLastGenerationAttempt: false,
      },
    );

    expect(result.chunkBatch.chunks[0]).toMatchObject({
      sentenceId: [1, 0, 1],
      sentenceIds: [[1, 0, 1]],
    });
  });

  it("resolves multiple sentence-id quote evidence items", async () => {
    const sentences = createSentences();
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Retention,
      projection: new FragmentProjection(sentences),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice: () => Promise.resolve('{"choice":"S1"}'),
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences,
      visibleChunkIds: [],
    });

    const result = await parser.parse(
      {
        chunks: [
          {
            content: "Multi evidence content",
            evidence: [
              {
                quote: "Alpha begins",
                sentence_id: "S1",
              },
              {
                quote: "Beta continues",
                sentence_id: "S2",
              },
            ],
            label: "Multi evidence",
            retention: ChunkRetention.Focused,
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      },
      {
        isLastGenerationAttempt: false,
      },
    );

    expect(result.chunkBatch.chunks[0]).toMatchObject({
      sentenceId: [1, 0, 0],
      sentenceIds: [
        [1, 0, 0],
        [1, 0, 1],
      ],
    });
  });

  it("recovers drifted sentence-id evidence when the quote has a clear match", async () => {
    const sentences = createSentences();
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Retention,
      projection: new FragmentProjection(sentences),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice: () => Promise.resolve('{"choice":"S1"}'),
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences,
      visibleChunkIds: [],
    });

    const result = await parser.parse(
      {
        chunks: [
          {
            content: "Recovered content",
            evidence: {
              quote: "Gamma ends",
              sentence_id: "S1",
            },
            label: "Recovered label",
            retention: ChunkRetention.Focused,
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      },
      {
        isLastGenerationAttempt: false,
      },
    );

    expect(result.chunkBatch.chunks[0]).toMatchObject({
      sentenceId: [1, 0, 2],
      sentenceIds: [[1, 0, 2]],
    });
  });

  it("uses second-stage choice for ambiguous sentence-id quote evidence", async () => {
    const requestChoice = vi.fn(
      (_messages: readonly LLMessage[], _index: number, _maxRetries: number) =>
        Promise.resolve('{"choice":"S2"}'),
    );
    const sentences = [
      {
        sentenceId: [1, 0, 0],
        text: "Echo",
        wordsCount: 2,
      },
      {
        sentenceId: [1, 0, 1],
        text: "Echo",
        wordsCount: 3,
      },
    ] satisfies ChunkExtractionSentence[];
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Retention,
      projection: new FragmentProjection(sentences),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences,
      visibleChunkIds: [],
    });

    const result = await parser.parse(
      {
        chunks: [
          {
            content: "Chosen content",
            evidence: {
              quote: "Echo",
            },
            label: "Chosen label",
            retention: ChunkRetention.Relevant,
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      },
      {
        isLastGenerationAttempt: true,
      },
    );

    expect(requestChoice).toHaveBeenCalledTimes(1);
    const choiceMessages = requestChoice.mock.calls[0]?.[0];

    expect(choiceMessages?.[1]?.content).toContain(
      'Resolve only this field: "evidence"',
    );
    expect(result.chunkBatch.chunks[0]).toMatchObject({
      sentenceId: [1, 0, 1],
      sentenceIds: [[1, 0, 1]],
      wordsCount: 3,
    });
  });

  it("uses second-stage choice for ambiguous evidence arrays", async () => {
    const requestChoice = vi.fn(
      (_messages: readonly LLMessage[], _index: number, _maxRetries: number) =>
        Promise.resolve('{"choice":"S2"}'),
    );
    const sentences = [
      {
        sentenceId: [1, 0, 0],
        text: "Echo",
        wordsCount: 2,
      },
      {
        sentenceId: [1, 0, 1],
        text: "Echo",
        wordsCount: 3,
      },
    ] satisfies ChunkExtractionSentence[];
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Retention,
      projection: new FragmentProjection(sentences),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences,
      visibleChunkIds: [],
    });

    const result = await parser.parse(
      {
        chunks: [
          {
            content: "Chosen content",
            evidence: [
              {
                quote: "Echo",
              },
            ],
            label: "Chosen label",
            retention: ChunkRetention.Relevant,
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      },
      {
        isLastGenerationAttempt: true,
      },
    );

    expect(requestChoice).toHaveBeenCalledTimes(1);
    expect(result.chunkBatch.chunks[0]).toMatchObject({
      sentenceId: [1, 0, 1],
      sentenceIds: [[1, 0, 1]],
      wordsCount: 3,
    });
  });

  it("rejects invalid links and importance annotations", async () => {
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Importance,
      projection: new FragmentProjection(createSentences()),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice: () => Promise.resolve('{"choice":"S1"}'),
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences: createSentences(),
      validImportanceChunkIds: [10],
      visibleChunkIds: [10],
    });

    await expect(
      parser.parse(
        {
          chunks: [
            {
              content: "Chunk content",
              evidence: {
                start_anchor: "Gamma ends.",
              },
              importance: ChunkImportance.Critical,
              label: "Chunk label",
              temp_id: "temp-1",
            },
          ],
          importance_annotations: [
            {
              chunk_id: 999,
              importance: ChunkImportance.Critical,
            },
          ],
          links: [
            {
              from: "temp-1",
              to: 999,
            },
          ],
        },
        {
          isLastGenerationAttempt: false,
        },
      ),
    ).rejects.toBeInstanceOf(ParsedJsonError);
  });

  it("does not add dangling temp-id link errors for rejected chunks", async () => {
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Retention,
      projection: new FragmentProjection(createSentences()),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice: () => Promise.resolve('{"choice":"S1"}'),
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences: createSentences(),
      visibleChunkIds: [],
    });

    await expect(
      parser.parse(
        {
          chunks: [
            {
              content: "Valid chunk",
              evidence: {
                start_anchor: "Alpha begins.",
              },
              label: "Valid label",
              retention: ChunkRetention.Focused,
              temp_id: "temp-1",
            },
            {
              content: "Invalid chunk",
              evidence: {
                start_anchor: {
                  mode: "head_tail",
                },
              },
              label: "Invalid label",
              retention: ChunkRetention.Focused,
              temp_id: "temp-2",
            },
          ],
          fragment_summary: "",
          links: [
            {
              from: "temp-1",
              to: "temp-2",
            },
          ],
        },
        {
          isLastGenerationAttempt: false,
        },
      ),
    ).rejects.toMatchObject({
      issues: [
        "Chunk #2 (\"Invalid label\"): Invalid evidence.start_anchor: head_tail anchor requires non-empty 'head' and 'tail'",
      ],
    });
  });

  it("matches standardized evidence against the projected fragment text", async () => {
    const sentences = [
      {
        sentenceId: [1, 0, 0],
        text: 'He said "hi" and used \\\\server.',
        wordsCount: 6,
      },
    ] satisfies ChunkExtractionSentence[];
    const parser = new ChunkBatchParser({
      choiceSystemPrompt: "choice prompt",
      metadataField: ChunkMetadataField.Retention,
      projection: new FragmentProjection(sentences),
      responseIntentClassifierPrompt: "classifier prompt",
      requestChoice: () => Promise.resolve('{"choice":"S1"}'),
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      sentences,
      visibleChunkIds: [],
    });

    const result = await parser.parse(
      {
        chunks: [
          {
            content: "Quoted content",
            evidence: {
              start_anchor: {
                mode: "full",
                text: "He said ＂hi＂ and used ＼＼server.",
              },
            },
            label: "Quoted label",
            retention: ChunkRetention.Focused,
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      },
      {
        isLastGenerationAttempt: false,
      },
    );

    expect(result.chunkBatch.chunks[0]).toMatchObject({
      sentenceId: [1, 0, 0],
      sentenceIds: [[1, 0, 0]],
      wordsCount: 6,
    });
  });
});

function createSentences(): readonly ChunkExtractionSentence[] {
  return [
    {
      sentenceId: [1, 0, 0],
      text: "Alpha begins.",
      wordsCount: 2,
    },
    {
      sentenceId: [1, 0, 1],
      text: "Beta continues.",
      wordsCount: 3,
    },
    {
      sentenceId: [1, 0, 2],
      text: "Gamma ends.",
      wordsCount: 4,
    },
  ];
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const { detectMock, validateISO2Mock } = vi.hoisted(() => ({
  detectMock: vi.fn<(text: string) => string>(),
  validateISO2Mock: vi.fn<(value: string) => string>(),
}));

vi.mock("tinyld", () => ({
  detect: detectMock,
  validateISO2: validateISO2Mock,
}));

import {
  SPINE_DIGEST_READER_SCOPES,
  SpineDigestScope,
} from "../../../src/common/llm-scope.js";
import { Language } from "../../../src/common/language.js";
import { ChunkImportance } from "../../../src/document/index.js";
import { ChunkExtractor } from "../../../src/reader/chunk-batch/extractor.js";
import {
  BOOK_COHERENCE_PROMPT_TEMPLATE,
  EVIDENCE_CHOICE_PROMPT_TEMPLATE,
  TRANSLATE_CHUNKS_PROMPT_TEMPLATE,
  USER_FOCUSED_PROMPT_TEMPLATE,
} from "../../../src/reader/chunk-batch/prompt-templates.js";
import { ScriptedLLM } from "../../helpers/scripted-llm.js";

describe("reader/chunk-batch/extractor", () => {
  beforeEach(() => {
    detectMock.mockReset();
    validateISO2Mock.mockReset();
    detectMock.mockReturnValue("ja");
    validateISO2Mock.mockImplementation((value: string) =>
      value === "ja" || value === "en" ? value : "",
    );
  });

  it("extracts user-focused chunks through the scripted llm protocol", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>([
      JSON.stringify({
        chunks: [
          {
            content: "Alpha summary",
            evidence: {
              quote: "Alpha begins",
              sentence_id: "S1",
            },
            label: "Alpha label",
            retention: "focused",
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "Fragment summary",
        links: [],
      }),
    ]);
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
    });

    const result = await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Alpha begins.",
          wordsCount: 2,
        },
      ],
      text: "Alpha begins.",
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(result).toStrictEqual({
      chunkBatch: {
        chunks: [
          {
            content: "Alpha summary",
            generation: 0,
            id: 0,
            label: "Alpha label",
            links: [],
            retention: "focused",
            sentenceId: [1, 0, 0],
            sentenceIds: [[1, 0, 0]],
            wordsCount: 2,
          },
        ],
        links: [],
        orderCorrect: true,
        tempIds: ["temp-1"],
      },
      fragmentSummary: "Fragment summary",
    });
    expect(llm.prompts.map((prompt) => prompt.templateName)).toContain(
      USER_FOCUSED_PROMPT_TEMPLATE,
    );
    expect(llm.prompts.map((prompt) => prompt.templateName)).toContain(
      EVIDENCE_CHOICE_PROMPT_TEMPLATE,
    );
    expect(
      llm.prompts.find(
        (prompt) => prompt.templateName === USER_FOCUSED_PROMPT_TEMPLATE,
      )?.templateContext.evidence_selection_prompt,
    ).toContain('[{"sentence_id":"S1","quote":"exact short source quote"}]');
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.messages[1]?.content).toBe("S1: Alpha begins.");
    expect(llm.calls[0]?.options.scope).toBe(SpineDigestScope.ReaderExtraction);
    expect(llm.calls[0]?.viaContext).toBe(true);
  });

  it("normalizes source sentences for evidence selection prompts", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>([
      JSON.stringify({
        chunks: [
          {
            content: "Alpha summary",
            evidence: {
              quote: "Alpha Beta C++!",
              sentence_id: "S1",
            },
            label: "Alpha label",
            retention: "focused",
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "Fragment summary",
        links: [],
      }),
    ]);
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
    });

    await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Alpha\n\tBeta\u200b  C++！",
          wordsCount: 4,
        },
      ],
      text: "Alpha\n\tBeta\u200b  C++！",
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(llm.calls[0]?.messages[1]?.content).toBe("S1: Alpha Beta C++!");
  });

  it("extracts book-coherence chunks with valid importance annotations", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>([
      JSON.stringify({
        chunks: [
          {
            content: "Bridge summary",
            evidence: {
              quote: "Bridge sentence",
              sentence_id: "S1",
            },
            importance: "important",
            label: "Bridge label",
            temp_id: "temp-1",
          },
        ],
        importance_annotations: [
          {
            chunk_id: 9,
            importance: "critical",
          },
        ],
        links: [],
      }),
    ]);
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
    });

    const result = await extractor.extractBookCoherence({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Bridge sentence.",
          wordsCount: 3,
        },
      ],
      text: "Bridge sentence.",
      userFocusedChunks: [
        {
          content: "Existing clue",
          generation: 0,
          id: 9,
          label: "Existing label",
          links: [],
          sentenceId: [1, 0, 0],
          sentenceIds: [[1, 0, 0]],
          wordsCount: 2,
        },
      ],
      visibleChunkIds: [9],
      workingMemoryPrompt: "memory",
    });

    expect(result).toStrictEqual({
      chunks: [
        {
          content: "Bridge summary",
          generation: 0,
          id: 0,
          importance: ChunkImportance.Important,
          label: "Bridge label",
          links: [],
          sentenceId: [1, 0, 0],
          sentenceIds: [[1, 0, 0]],
          wordsCount: 3,
        },
      ],
      importanceAnnotations: [
        {
          chunkId: 9,
          importance: ChunkImportance.Critical,
        },
      ],
      links: [],
      orderCorrect: true,
      tempIds: ["temp-1"],
    });
    expect(llm.prompts.map((prompt) => prompt.templateName)).toContain(
      BOOK_COHERENCE_PROMPT_TEMPLATE,
    );
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.viaContext).toBe(true);
  });

  it("allows book-coherence links to current user-focused chunks", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>([
      JSON.stringify({
        chunks: [
          {
            content: "Bridge summary",
            evidence: {
              quote: "Bridge sentence",
              sentence_id: "S1",
            },
            importance: "important",
            label: "Bridge label",
            temp_id: "temp-1",
          },
        ],
        importance_annotations: [
          {
            chunk_id: 9,
            importance: "critical",
          },
        ],
        links: [
          {
            from: 9,
            strength: "important",
            to: "temp-1",
          },
        ],
      }),
    ]);
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
    });

    const result = await extractor.extractBookCoherence({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Bridge sentence.",
          wordsCount: 3,
        },
      ],
      text: "Bridge sentence.",
      userFocusedChunks: [
        {
          content: "Existing clue",
          generation: 0,
          id: 9,
          label: "Existing label",
          links: [],
          sentenceId: [1, 0, 0],
          sentenceIds: [[1, 0, 0]],
          wordsCount: 2,
        },
      ],
      visibleChunkIds: [9],
      workingMemoryPrompt: "(empty)",
    });

    expect(result.links).toStrictEqual([
      {
        from: 9,
        strength: "important",
        to: "temp-1",
      },
    ]);
  });

  it("returns an empty chunk batch when parse validation keeps failing", async () => {
    const invalidResponse = JSON.stringify({
      chunks: [
        {
          content: "Alpha summary",
          label: "Alpha label",
          retention: "focused",
          temp_id: "temp-1",
        },
      ],
      fragment_summary: "ignored",
      links: [],
    });
    const llm = new ScriptedLLM<SpineDigestScope>(
      Array.from({ length: 8 }, () => invalidResponse),
    );
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
    });

    const result = await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Alpha begins.",
          wordsCount: 2,
        },
      ],
      text: "Alpha begins.",
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(result).toStrictEqual({
      chunkBatch: {
        chunks: [],
        links: [],
        orderCorrect: true,
        tempIds: [],
      },
      fragmentSummary: "",
    });
    expect(llm.calls).toHaveLength(8);
    expect(llm.calls.every((call) => call.viaContext)).toBe(true);
  });

  it("returns an empty chunk batch when guaranteed retries are exhausted", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>(
      Array.from({ length: 16 }, () => "I cannot answer that."),
    );
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
    });

    const result = await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Alpha begins.",
          wordsCount: 2,
        },
      ],
      text: "Alpha begins.",
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(result).toStrictEqual({
      chunkBatch: {
        chunks: [],
        links: [],
        orderCorrect: true,
        tempIds: [],
      },
      fragmentSummary: "",
    });
    expect(llm.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("translates extracted chunks when the requested language differs", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>([
      JSON.stringify({
        chunks: [
          {
            content: "こんにちは世界",
            evidence: {
              start_anchor: "Hello world.",
            },
            label: "挨拶",
            retention: "detailed",
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      }),
      JSON.stringify([
        {
          content: "Hello world",
          id: 0,
          label: "Greeting",
        },
      ]),
    ]);
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      userLanguage: Language.English,
    });

    const result = await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Hello world.",
          wordsCount: 2,
        },
      ],
      text: "Hello world.",
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(result.chunkBatch.chunks[0]).toMatchObject({
      content: "Hello world",
      label: "Greeting",
    });
    expect(llm.prompts.map((prompt) => prompt.templateName)).toContain(
      TRANSLATE_CHUNKS_PROMPT_TEMPLATE,
    );
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.options.scope).toBe(SpineDigestScope.ReaderExtraction);
    expect(llm.calls[1]?.viaContext).toBe(false);
  });

  it("skips translation when the extracted chunks already match the target language", async () => {
    detectMock.mockReturnValue("en");
    const llm = new ScriptedLLM<SpineDigestScope>([
      JSON.stringify({
        chunks: [
          {
            content: "Hello world",
            evidence: {
              start_anchor: "Hello world.",
            },
            label: "Greeting",
            retention: "focused",
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      }),
    ]);
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      userLanguage: Language.English,
    });

    const result = await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Hello world.",
          wordsCount: 2,
        },
      ],
      text: "Hello world.",
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(result.chunkBatch.chunks[0]).toMatchObject({
      content: "Hello world",
      label: "Greeting",
    });
    expect(llm.prompts.map((prompt) => prompt.templateName)).not.toContain(
      TRANSLATE_CHUNKS_PROMPT_TEMPLATE,
    );
    expect(llm.calls).toHaveLength(1);
  });

  it("keeps original chunks when translation responses fail validation", async () => {
    const invalidTranslation = JSON.stringify([
      {
        content: "Hello world",
        id: 99,
        label: "Greeting",
      },
    ]);
    const llm = new ScriptedLLM<SpineDigestScope>([
      JSON.stringify({
        chunks: [
          {
            content: "こんにちは世界",
            evidence: {
              start_anchor: "Hello world.",
            },
            label: "挨拶",
            retention: "detailed",
            temp_id: "temp-1",
          },
          {
            content: "さようなら",
            evidence: {
              start_anchor: "Goodbye.",
            },
            label: "別れ",
            retention: "focused",
            temp_id: "temp-2",
          },
        ],
        fragment_summary: "",
        links: [],
      }),
      invalidTranslation,
      invalidTranslation,
      invalidTranslation,
      invalidTranslation,
    ]);
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      userLanguage: Language.English,
    });

    const result = await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Hello world.",
          wordsCount: 2,
        },
        {
          sentenceId: [1, 0, 1],
          text: "Goodbye.",
          wordsCount: 1,
        },
      ],
      text: "Hello world. Goodbye.",
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(result.chunkBatch.chunks).toMatchObject([
      {
        content: "こんにちは世界",
        label: "挨拶",
      },
      {
        content: "さようなら",
        label: "別れ",
      },
    ]);
    expect(llm.prompts.map((prompt) => prompt.templateName)).toContain(
      TRANSLATE_CHUNKS_PROMPT_TEMPLATE,
    );
    expect(llm.calls).toHaveLength(5);
    expect(llm.calls.slice(1).every((call) => call.viaContext === false)).toBe(
      true,
    );
  });

  it("projects dangerous ASCII characters before sending fragment text to the llm", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>([
      JSON.stringify({
        chunks: [
          {
            content: "Quoted summary",
            evidence: {
              start_anchor: {
                mode: "full",
                text: "He said ＂hi＂ and saved to ＼tmp＼log.",
              },
            },
            label: "Quoted label",
            retention: "focused",
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      }),
    ]);
    const extractor = new ChunkExtractor<SpineDigestScope>({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
    });

    const result = await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: 'He said "hi" and saved to \\tmp\\log.',
          wordsCount: 8,
        },
      ],
      text: 'He said "hi" and saved to \\tmp\\log.',
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(llm.calls[0]?.messages[1]).toMatchObject({
      content: "S1: He said ＂hi＂ and saved to ＼tmp＼log.",
      role: "user",
    });
    expect(result.chunkBatch.chunks[0]).toMatchObject({
      sentenceId: [1, 0, 0],
      sentenceIds: [[1, 0, 0]],
      wordsCount: 8,
    });
  });
});

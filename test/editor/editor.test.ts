import { beforeEach, describe, expect, it, vi } from "vitest";

const { detectMock, validateISO2Mock } = vi.hoisted(() => ({
  detectMock: vi.fn<(text: string) => string>(),
  validateISO2Mock: vi.fn<(value: string) => string>(),
}));

vi.mock("tinyld", () => ({
  detect: detectMock,
  validateISO2: validateISO2Mock,
}));

import type {
  ReadonlyDocument,
  ReadonlySerialFragments,
} from "../../packages/core/src/document/index.js";
import {
  WIKI_GRAPH_EDITOR_SCOPES,
  WikiGraphScope,
} from "../../packages/core/src/common/llm-scope.js";
import { Language } from "../../packages/core/src/common/language.js";
import type {
  ChunkRecord,
  FragmentGroupRecord,
  FragmentRecord,
  SnakeRecord,
} from "../../packages/core/src/document/types.js";
import { compressText } from "../../packages/core/src/editor/editor.js";
import {
  CLUE_REVIEWER_GENERATOR_PROMPT_TEMPLATE,
  CLUE_REVIEWER_PROMPT_TEMPLATE,
  REVISION_FEEDBACK_PROMPT_TEMPLATE,
  TEXT_COMPRESSOR_PROMPT_TEMPLATE,
} from "../../packages/core/src/editor/prompt-templates.js";
import { RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE } from "../../packages/core/src/guaranteed/index.js";
import { ScriptedLLM } from "../helpers/scripted-llm.js";

describe("editor/editor", () => {
  beforeEach(() => {
    detectMock.mockReset();
    validateISO2Mock.mockReset();
    validateISO2Mock.mockImplementation((value: string) => {
      return value === "en" || value === "ja" ? value : "";
    });
  });

  it("throws when neither document nor workspace is provided", async () => {
    const llm = new ScriptedLLM<WikiGraphScope>([]);

    await expect(
      compressText({
        groupId: 1,
        llm: llm as never,
        scopes: WIKI_GRAPH_EDITOR_SCOPES,
        serialId: 1,
      }),
    ).rejects.toThrow("Editor requires a document");
  });

  it("returns an empty string when the target group has no fragments", async () => {
    const llm = new ScriptedLLM<WikiGraphScope>([]);
    const document = createDocument({
      chunkIdsBySnakeId: {},
      chunksById: {},
      fragmentGroups: [],
      fragments: [],
      snakeIdsByGroup: [],
      snakesById: {},
    });

    const result = await compressText({
      document,
      groupId: 1,
      llm: llm as never,
      scopes: WIKI_GRAPH_EDITOR_SCOPES,
      serialId: 1,
    });

    expect(result).toBe("");
    expect(llm.calls).toHaveLength(0);
  });

  it("uses the covered segment when a group starts after the segment start", async () => {
    const llm = new ScriptedLLM<WikiGraphScope>([
      "Keep chronology intact.",
      ["## Compressed Text", "Focused summary"].join("\n"),
      '{"issues":[]}',
    ]);
    const document = createDocument({
      chunkIdsBySnakeId: {
        1: [101],
      },
      chunksById: {
        101: createChunkRecord(101, 1, "Beta"),
      },
      fragmentGroups: [
        {
          endSentenceIndex: 1,
          groupId: 1,
          serialId: 1,
          startSentenceIndex: 1,
        },
      ],
      fragments: [
        createFragmentRecord(0, [
          {
            text: "Alpha begins.",
            wordsCount: 2,
          },
          {
            text: "Beta continues.",
            wordsCount: 3,
          },
        ]),
      ],
      snakeIdsByGroup: [1],
      snakesById: {
        1: createSnakeRecord(1, 5, "Beta", "Beta"),
      },
    });

    detectMock.mockReturnValue("en");

    const result = await compressText({
      document,
      groupId: 1,
      llm: llm as never,
      maxIterations: 1,
      scopes: WIKI_GRAPH_EDITOR_SCOPES,
      serialId: 1,
      userLanguage: Language.English,
    });

    expect(result).toBe("Focused summary");
    expect(llm.calls[1]?.messages[1]?.content).toContain("Beta continues.");
  });

  it("iterates with reviewer history and language correction before selecting the best version", async () => {
    const llm = new ScriptedLLM<WikiGraphScope>([
      "Keep chronology intact.",
      [
        "Planning notes",
        "",
        "## Compressed Text",
        "<chunk>Bad Japanese summary</chunk>",
      ].join("\n"),
      '{"issues":[]}',
      ["## Compressed Text", "```text", "Improved English summary", "```"].join(
        "\n",
      ),
      '{"issues":[]}',
    ]);
    const document = createDocument({
      chunkIdsBySnakeId: {
        1: [101],
      },
      chunksById: {
        101: createChunkRecord(101, 0, "Alpha"),
      },
      fragmentGroups: [
        {
          endSentenceIndex: 0,
          groupId: 1,
          serialId: 1,
          startSentenceIndex: 0,
        },
      ],
      fragments: [
        createFragmentRecord(0, [
          {
            text: "Alpha begins.",
            wordsCount: 2,
          },
          {
            text: "Beta continues.",
            wordsCount: 3,
          },
        ]),
      ],
      snakeIdsByGroup: [1],
      snakesById: {
        1: createSnakeRecord(1, 5, "Alpha", "Beta"),
      },
    });

    detectMock.mockReturnValueOnce("ja").mockReturnValueOnce("en");

    const result = await compressText({
      groupId: 1,
      llm: llm as never,
      maxIterations: 3,
      scopes: WIKI_GRAPH_EDITOR_SCOPES,
      serialId: 1,
      userLanguage: Language.English,
      workspace: document,
    });

    expect(result).toBe("Improved English summary");
    expect(llm.prompts.map((prompt) => prompt.templateName)).toStrictEqual([
      CLUE_REVIEWER_GENERATOR_PROMPT_TEMPLATE,
      TEXT_COMPRESSOR_PROMPT_TEMPLATE,
      CLUE_REVIEWER_PROMPT_TEMPLATE,
      RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
      REVISION_FEEDBACK_PROMPT_TEMPLATE,
      TEXT_COMPRESSOR_PROMPT_TEMPLATE,
      CLUE_REVIEWER_PROMPT_TEMPLATE,
      RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
    ]);
    expect(llm.calls).toHaveLength(5);
    expect(llm.calls[0]?.options.scope).toBe(
      WikiGraphScope.EditorReviewGuide,
    );
    expect(llm.calls[1]?.options.scope).toBe(WikiGraphScope.EditorCompress);
    expect(llm.calls[2]?.options.scope).toBe(WikiGraphScope.EditorReview);
    expect(llm.calls[3]?.options.scope).toBe(WikiGraphScope.EditorCompress);
    expect(llm.calls[4]?.options.scope).toBe(WikiGraphScope.EditorReview);
    expect(llm.calls[3]?.messages.map((message) => message.role)).toStrictEqual(
      ["system", "user", "assistant", "user"],
    );
    expect(llm.calls[3]?.messages[2]?.content).toBe("Bad Japanese summary");
    expect(llm.calls[4]?.messages.map((message) => message.role)).toStrictEqual(
      ["system", "user", "assistant", "user"],
    );
    expect(llm.calls[4]?.messages[1]?.content).toBe("Bad Japanese summary");
    expect(llm.calls[4]?.messages[2]?.content).toBe('{"issues":[]}');
    expect(llm.calls[4]?.messages[3]?.content).toBe("Improved English summary");
  });
});

function createDocument(input: {
  readonly chunkIdsBySnakeId: Record<number, readonly number[]>;
  readonly chunksById: Record<number, ChunkRecord>;
  readonly fragmentGroups: readonly FragmentGroupRecord[];
  readonly fragments: readonly FragmentRecord[];
  readonly snakeIdsByGroup: readonly number[];
  readonly snakesById: Record<number, SnakeRecord>;
}): ReadonlyDocument {
  const fragmentsById = Object.fromEntries(
    input.fragments.map((fragment) => [fragment.fragmentId, fragment]),
  ) as Record<number, FragmentRecord>;

  return {
    chunks: {
      getById: (chunkId: number) => Promise.resolve(input.chunksById[chunkId]),
    },
    fragmentGroups: {
      listBySerial: () => Promise.resolve([...input.fragmentGroups]),
    },
    getSerialFragments: () =>
      ({
        getFragment: (fragmentId: number) =>
          Promise.resolve(fragmentsById[fragmentId] as FragmentRecord),
        listFragmentIds: () =>
          Promise.resolve(
            input.fragments.map((fragment) => fragment.fragmentId),
          ),
        path: "/tmp/fragments",
        serialId: 1,
      }) as ReadonlySerialFragments,
    snakeChunks: {
      listChunkIds: (snakeId: number) =>
        Promise.resolve([...(input.chunkIdsBySnakeId[snakeId] ?? [])]),
    },
    snakes: {
      getById: (snakeId: number) => Promise.resolve(input.snakesById[snakeId]),
      listIdsByGroup: () => Promise.resolve([...input.snakeIdsByGroup]),
    },
  } as unknown as ReadonlyDocument;
}

function createChunkRecord(
  chunkId: number,
  sentenceIndex: number,
  label: string,
): ChunkRecord {
  return {
    content: `${label} content`,
    generation: 0,
    id: chunkId,
    label,
    sentenceId: [1, sentenceIndex],
    sentenceIds: [[1, sentenceIndex]],
    wordsCount: 5,
    weight: 1,
  };
}

function createFragmentRecord(
  fragmentId: number,
  sentences: FragmentRecord["sentences"],
): FragmentRecord {
  return {
    fragmentId,
    sentences,
    serialId: 1,
    summary: `Fragment ${fragmentId} summary`,
  };
}

function createSnakeRecord(
  snakeId: number,
  weight: number,
  firstLabel: string,
  lastLabel: string,
): SnakeRecord {
  return {
    firstLabel,
    groupId: 1,
    id: snakeId,
    lastLabel,
    localSnakeId: snakeId,
    serialId: 1,
    size: 1,
    wordsCount: 10,
    weight,
  };
}

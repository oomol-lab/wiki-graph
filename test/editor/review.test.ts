import { describe, expect, it } from "vitest";

import {
  SPINE_DIGEST_EDITOR_SCOPES,
  SpineDigestScope,
} from "../../src/common/llm-scope.js";
import { Language } from "../../src/common/language.js";
import type { ReadonlySerialFragments } from "../../src/document/index.js";
import type { ChunkRecord, FragmentRecord } from "../../src/document/types.js";
import {
  CLUE_REVIEWER_GENERATOR_PROMPT_TEMPLATE,
  CLUE_REVIEWER_PROMPT_TEMPLATE,
} from "../../src/editor/prompt-templates.js";
import { CompressionReviewer } from "../../src/editor/review.js";
import type { Clue } from "../../src/editor/clue.js";
import { ReviewSeverity } from "../../src/editor/types.js";
import { ScriptedLLM } from "../helpers/scripted-llm.js";

describe("editor/review", () => {
  it("generates clue reviewers from clue markup", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>(["  Reviewer guide  "]);
    const reviewer = new CompressionReviewer(
      llm as never,
      createSerialFragments(),
      {
        review: SPINE_DIGEST_EDITOR_SCOPES.review,
        reviewGuide: SPINE_DIGEST_EDITOR_SCOPES.reviewGuide,
      },
      Language.English,
    );

    const reviewers = await reviewer.generateClueReviewers([
      createClue(1, 0.6, createChunk(1, 0, "Alpha")),
    ]);

    expect(reviewers).toStrictEqual([
      {
        clueId: 1,
        label: "Alpha clue",
        reviewerInfo: "Reviewer guide",
        weight: 0.6,
      },
    ]);
    expect(llm.prompts[0]?.templateName).toBe(
      CLUE_REVIEWER_GENERATOR_PROMPT_TEMPLATE,
    );
    expect(llm.calls[0]?.options.scope).toBe(
      SpineDigestScope.EditorReviewGuide,
    );
  });

  it("reviews compression through guaranteed-json requests with history", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>([
      '{"issues":[{"problem":"Missing detail","severity":"major","suggestion":"Restore it"}]}',
    ]);
    const reviewer = new CompressionReviewer(
      llm as never,
      createSerialFragments(),
      {
        review: SPINE_DIGEST_EDITOR_SCOPES.review,
        reviewGuide: SPINE_DIGEST_EDITOR_SCOPES.reviewGuide,
      },
      Language.English,
    );

    const result = await reviewer.reviewCompression(
      "Current compressed text",
      [
        {
          clueId: 1,
          label: "Alpha clue",
          reviewerInfo: "Check continuity",
          weight: 0.8,
        },
      ],
      {
        "1": ["Previous compressed text", '{"issues":[]}'],
      },
    );

    expect(result.rawResponses["1"]).toBe(
      '{"issues":[{"problem":"Missing detail","severity":"major","suggestion":"Restore it"}]}',
    );
    expect(result.reviews).toStrictEqual([
      {
        clueId: 1,
        issues: [
          {
            problem: "Missing detail",
            severity: ReviewSeverity.Major,
            suggestion: "Restore it",
          },
        ],
        weight: 0.8,
      },
    ]);
    expect(llm.prompts[0]?.templateName).toBe(CLUE_REVIEWER_PROMPT_TEMPLATE);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.viaContext).toBe(false);
    expect(llm.calls[0]?.options).toMatchObject({
      scope: SpineDigestScope.EditorReview,
      useCache: false,
    });
    expect(llm.calls[0]?.messages.map((message) => message.role)).toStrictEqual(
      ["system", "user", "assistant", "user"],
    );
  });

  it("falls back to no issues when a reviewer cannot produce valid JSON", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>(Array(13).fill(""));
    const reviewer = new CompressionReviewer(
      llm as never,
      createSerialFragments(),
      {
        review: SPINE_DIGEST_EDITOR_SCOPES.review,
        reviewGuide: SPINE_DIGEST_EDITOR_SCOPES.reviewGuide,
      },
      Language.English,
    );

    const result = await reviewer.reviewCompression(
      "Current compressed text",
      [
        {
          clueId: 1,
          label: "Alpha clue",
          reviewerInfo: "Check continuity",
          weight: 0.8,
        },
      ],
      {},
    );

    expect(result.rawResponses["1"]).toBeUndefined();
    expect(result.reviews).toStrictEqual([
      {
        clueId: 1,
        issues: [],
        weight: 0.8,
      },
    ]);
  });

  it("does not hide regular LLM request errors during review", async () => {
    const llm = new ScriptedLLM<SpineDigestScope>([
      () => {
        throw new Error("network failed");
      },
    ]);
    const reviewer = new CompressionReviewer(
      llm as never,
      createSerialFragments(),
      {
        review: SPINE_DIGEST_EDITOR_SCOPES.review,
        reviewGuide: SPINE_DIGEST_EDITOR_SCOPES.reviewGuide,
      },
      Language.English,
    );

    await expect(
      reviewer.reviewCompression(
        "Current compressed text",
        [
          {
            clueId: 1,
            label: "Alpha clue",
            reviewerInfo: "Check continuity",
            weight: 0.8,
          },
        ],
        {},
      ),
    ).rejects.toThrow("network failed");
  });
});

function createChunk(
  fragmentId: number,
  sentenceIndex: number,
  label: string,
): ChunkRecord {
  return {
    content: `${label} content`,
    generation: 0,
    id: fragmentId * 10 + sentenceIndex,
    label,
    sentenceId: [1, fragmentId, sentenceIndex],
    sentenceIds: [[1, fragmentId, sentenceIndex]],
    wordsCount: 3,
    weight: 1,
  };
}

function createClue(
  clueId: number,
  weight: number,
  ...chunks: readonly ChunkRecord[]
): Clue {
  return {
    chunks,
    clueId,
    isMerged: false,
    label:
      chunks[0]?.label === undefined
        ? "Unknown clue"
        : `${chunks[0].label} clue`,
    sourceSnakeIds: [clueId],
    weight,
  };
}

function createSerialFragments(): ReadonlySerialFragments {
  const fragment = {
    fragmentId: 1,
    sentences: [
      {
        text: "Alpha fragment sentence.",
        wordsCount: 4,
      },
    ],
    serialId: 1,
    summary: "Alpha fragment summary",
  } satisfies FragmentRecord;

  return {
    getFragment: () => Promise.resolve(fragment),
    listFragmentIds: () => Promise.resolve([1]),
    path: "/tmp/fragments",
    serialId: 1,
  };
}

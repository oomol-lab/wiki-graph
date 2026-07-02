import { describe, expect, it } from "vitest";

import {
  rankEvidenceQuote,
  resolveEvidenceSelection,
  resolveEvidenceSelectionList,
  type EvidenceSelectionSentence,
} from "../../src/evidence-selection/index.js";

const SENTENCES = [
  {
    id: "S1",
    sentenceId: [1, 0],
    text: "Alpha founded Beta in Vienna.",
  },
  {
    id: "S2",
    sentenceId: [1, 1],
    text: "Gamma watched the ceremony.",
  },
  {
    id: "S3",
    sentenceId: [1, 2],
    text: "Alpha later wrote about Beta.",
  },
] satisfies EvidenceSelectionSentence[];

describe("evidence-selection/selection-resolver", () => {
  it("accepts a trusted sentence id when the quote matches that sentence", () => {
    const [resolution, failure] = resolveEvidenceSelection({
      evidence: {
        quote: "founded Beta",
        sentence_id: "S1",
      },
      sentences: SENTENCES,
    });

    expect(failure).toBeUndefined();
    expect(resolution).toMatchObject({
      sentenceIds: [[1, 0]],
      strategy: "sentence_id+normalized_substring",
    });
  });

  it("recovers from a drifted sentence id when the quote has a clear top match", () => {
    const [resolution, failure] = resolveEvidenceSelection({
      evidence: {
        quote: "watched the ceremony",
        sentence_id: "S1",
      },
      sentences: SENTENCES,
    });

    expect(failure).toBeUndefined();
    expect(resolution).toMatchObject({
      sentenceIds: [[1, 1]],
      strategy: "quote_auto_top1:normalized_substring",
    });
  });

  it("does not let a decent stale sentence id override a clear quote match", () => {
    const [resolution, failure] = resolveEvidenceSelection({
      evidence: {
        quote: "Alpha later wrote about Beta",
        sentence_id: "S1",
      },
      sentences: SENTENCES,
    });

    expect(failure).toBeUndefined();
    expect(resolution).toMatchObject({
      sentenceIds: [[1, 2]],
    });
    expect(resolution?.strategy).toMatch(/^quote_auto_top1:/u);
  });

  it("resolves multiple evidence selections into ordered unique sentence IDs", () => {
    const [resolution, failure] = resolveEvidenceSelectionList({
      evidence: [
        {
          quote: "founded Beta",
          sentence_id: "S1",
        },
        {
          quote: "watched the ceremony",
          sentence_id: "S2",
        },
      ],
      sentences: SENTENCES,
    });

    expect(failure).toBeUndefined();
    expect(resolution).toMatchObject({
      sentenceIds: [
        [1, 0],
        [1, 1],
      ],
    });
  });

  it("returns ambiguous candidates for short repeated quotes", () => {
    const [resolution, failure] = resolveEvidenceSelection({
      evidence: {
        quote: "Alpha",
      },
      sentences: SENTENCES,
    });

    expect(resolution).toBeUndefined();
    expect(failure).toMatchObject({
      code: "ambiguous",
    });
    expect(
      failure?.candidates.map((candidate) => candidate.occurrenceId),
    ).toEqual(["S1", "S3", "S2"]);
  });

  it("returns low confidence when the quote does not resemble any sentence", () => {
    const [resolution, failure] = resolveEvidenceSelection({
      evidence: {
        quote: "unrelated public university",
      },
      sentences: SENTENCES,
    });

    expect(resolution).toBeUndefined();
    expect(failure).toMatchObject({
      code: "low_confidence",
    });
  });

  it("ranks quote candidates independently from business objects", () => {
    const ranked = rankEvidenceQuote("Beta in Vienna", SENTENCES);

    expect(ranked[0]).toMatchObject({
      occurrenceId: "S1",
      sentence: {
        sentenceId: [1, 0],
      },
      strategy: "normalized_substring",
    });
  });

  it("rejects empty evidence quotes", () => {
    const [resolution, failure] = resolveEvidenceSelection({
      evidence: {
        quote: " ",
        sentence_id: "S1",
      },
      sentences: SENTENCES,
    });

    expect(resolution).toBeUndefined();
    expect(failure).toStrictEqual({
      candidates: [],
      code: "invalid",
      message: "Evidence quote is missing or empty.",
    });
  });
});

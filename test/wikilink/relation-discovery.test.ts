import { describe, expect, it, vi } from "vitest";

import type { GuaranteedRequest } from "../../src/guaranteed/index.js";
import {
  buildWikilinkEvidenceWindows,
  discoverWikilinkRelations,
} from "../../src/wikilink/index.js";

describe("wikilink/relation-discovery", () => {
  it("persists only LLM-judged semantic relations with resolved evidence", async () => {
    const sentences = [
      { text: "Alpha founded Beta.", wordsCount: 3 },
      { text: "Gamma watched them.", wordsCount: 3 },
    ];
    const window = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 10,
      mentions: [
        {
          id: "m1",
          qid: "Q1",
          range: { end: 5, start: 0 },
          surface: "Alpha",
        },
        {
          id: "m2",
          qid: "Q2",
          range: { end: 18, start: 14 },
          surface: "Beta",
        },
      ],
      text: sentences.map((sentence) => sentence.text).join(" "),
      windowLength: 80,
    })[0]!;
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        relations: [
          {
            confidence: 0.91,
            evidence: {
              quote: "Alpha founded Beta",
              sentence_id: "S1",
            },
            predicate: "Founded By",
            sourceMentionId: "m2",
            targetMentionId: "m1",
          },
        ],
      }),
    );

    await expect(
      discoverWikilinkRelations({
        chapterId: 1,
        fragmentId: 0,
        maxRetries: 0,
        request,
        sentences,
        window,
      }),
    ).resolves.toStrictEqual([
      {
        confidence: 0.91,
        evidenceEnd: 19,
        evidenceStart: 0,
        predicate: "founded_by",
        sourceMentionId: "m2",
        targetMentionId: "m1",
      },
    ]);
  });

  it("resolves relation evidence from multiple sentence quote items", async () => {
    const sentences = [
      { text: "Alpha prepared the attack.", wordsCount: 4 },
      { text: "Beta was defeated afterward.", wordsCount: 4 },
    ];
    const text = sentences.map((sentence) => sentence.text).join(" ");
    const window = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 20,
      mentions: [
        {
          id: "m1",
          qid: "Q1",
          range: { end: 5, start: 0 },
          surface: "Alpha",
        },
        {
          id: "m2",
          qid: "Q2",
          range: { end: 31, start: 27 },
          surface: "Beta",
        },
      ],
      text,
      windowLength: 120,
    })[0]!;
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        relations: [
          {
            evidence: [
              {
                quote: "prepared the attack",
                sentence_id: "S1",
              },
              {
                quote: "was defeated afterward",
                sentence_id: "S2",
              },
            ],
            predicate: "opposes",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
        ],
      }),
    );

    await expect(
      discoverWikilinkRelations({
        chapterId: 1,
        fragmentId: 0,
        maxRetries: 0,
        request,
        sentences,
        window,
      }),
    ).resolves.toStrictEqual([
      {
        evidenceEnd: text.length,
        evidenceStart: 0,
        predicate: "opposes",
        sourceMentionId: "m1",
        targetMentionId: "m2",
      },
    ]);
  });

  it("rejects relation evidence outside the displayed sentence window", async () => {
    const sentences = [
      { text: "Alpha founded Beta.", wordsCount: 3 },
      { text: "Gamma watched them.", wordsCount: 3 },
    ];
    const text = sentences.map((sentence) => sentence.text).join(" ");
    const window = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 1,
      mentions: [
        {
          id: "m1",
          qid: "Q1",
          range: { end: 5, start: 0 },
          surface: "Alpha",
        },
        {
          id: "m2",
          qid: "Q2",
          range: { end: 18, start: 14 },
          surface: "Beta",
        },
      ],
      text,
      windowLength: 20,
    })[0]!;
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        relations: [
          {
            evidence: {
              quote: "Gamma watched them",
              sentence_id: "S2",
            },
            predicate: "watched_by",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
        ],
      }),
    );

    await expect(
      discoverWikilinkRelations({
        chapterId: 1,
        fragmentId: 0,
        maxRetries: 0,
        request,
        sentences,
        window,
      }),
    ).resolves.toStrictEqual([]);
  });

  it("still resolves old anchor evidence for existing retry responses", async () => {
    const sentences = [
      { text: "Alpha founded Beta.", wordsCount: 3 },
      { text: "Gamma watched them.", wordsCount: 3 },
    ];
    const window = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 10,
      mentions: [
        {
          id: "m1",
          qid: "Q1",
          range: { end: 5, start: 0 },
          surface: "Alpha",
        },
        {
          id: "m2",
          qid: "Q2",
          range: { end: 18, start: 14 },
          surface: "Beta",
        },
      ],
      text: sentences.map((sentence) => sentence.text).join(" "),
      windowLength: 80,
    })[0]!;
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        relations: [
          {
            confidence: 0.91,
            evidence: {
              start_anchor: {
                mode: "full",
                text: "Alpha founded Beta.",
              },
            },
            predicate: "Founded By",
            sourceMentionId: "m2",
            targetMentionId: "m1",
          },
        ],
      }),
    );

    await expect(
      discoverWikilinkRelations({
        chapterId: 1,
        fragmentId: 0,
        maxRetries: 0,
        request,
        sentences,
        window,
      }),
    ).resolves.toStrictEqual([
      {
        confidence: 0.91,
        evidenceEnd: 19,
        evidenceStart: 0,
        predicate: "founded_by",
        sourceMentionId: "m2",
        targetMentionId: "m1",
      },
    ]);
  });

  it("uses tagged sentence IDs and quote evidence in the relation prompt", async () => {
    const sentences = [{ text: "Alpha founded Beta.", wordsCount: 3 }];
    const window = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 10,
      mentions: [
        {
          id: "m1",
          qid: "Q1",
          range: { end: 5, start: 0 },
          surface: "Alpha",
        },
        {
          id: "m2",
          qid: "Q2",
          range: { end: 18, start: 14 },
          surface: "Beta",
        },
      ],
      text: sentences[0]!.text,
      windowLength: 80,
    })[0]!;
    const request = vi
      .fn<GuaranteedRequest>()
      .mockResolvedValue(JSON.stringify({ relations: [] }));

    await discoverWikilinkRelations({
      chapterId: 1,
      fragmentId: 0,
      maxRetries: 0,
      request,
      sentences,
      window,
    });

    const systemPrompt = request.mock.calls[0]?.[0][0]?.content ?? "";
    const userPrompt = request.mock.calls[0]?.[0][1]?.content ?? "";

    expect(systemPrompt).toContain("Evidence selection:");
    expect(systemPrompt).toContain("do not copy the tags into quote");
    expect(systemPrompt).toContain("ignore the tags when copying evidence");
    expect(systemPrompt).toContain("never link a mention to itself");
    expect(userPrompt).toContain("Source sentences with mention tags:");
    expect(userPrompt).not.toContain("Tagged source context:");
    expect(userPrompt).not.toContain(
      "Untagged source sentences for evidence quotes:",
    );
    expect(userPrompt).toContain(
      'S1: <mention id="m1" qid="Q1">Alpha</mention> founded <mention id="m2" qid="Q2">Beta</mention>.',
    );
    expect(userPrompt).toContain('"sentence_id"');
    expect(userPrompt).toContain('"quote"');
  });

  it("does not create a relation when the model uses non-semantic mentions predicate", async () => {
    const sentences = [{ text: "Alpha is beside Beta.", wordsCount: 4 }];
    const window = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 10,
      mentions: [
        {
          id: "m1",
          qid: "Q1",
          range: { end: 5, start: 0 },
          surface: "Alpha",
        },
        {
          id: "m2",
          qid: "Q2",
          range: { end: 20, start: 16 },
          surface: "Beta",
        },
      ],
      text: sentences[0]!.text,
      windowLength: 80,
    })[0]!;
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        relations: [
          {
            evidence: {
              start_anchor: {
                mode: "full",
                text: "Alpha is beside Beta.",
              },
            },
            predicate: "mentions",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
        ],
      }),
    );

    await expect(
      discoverWikilinkRelations({
        chapterId: 1,
        fragmentId: 0,
        maxRetries: 0,
        request,
        sentences,
        window,
      }),
    ).resolves.toStrictEqual([]);
  });

  it("keeps relations between distinct mentions grounded to the same QID", async () => {
    const sentences = [
      { text: "Alpha changed after Alpha returned.", wordsCount: 5 },
    ];
    const window = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 10,
      mentions: [
        {
          id: "m1",
          qid: "Q1",
          range: { end: 5, start: 0 },
          surface: "Alpha",
        },
        {
          id: "m2",
          qid: "Q1",
          range: { end: 25, start: 20 },
          surface: "Alpha",
        },
      ],
      text: sentences[0]!.text,
      windowLength: 80,
    })[0]!;
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        relations: [
          {
            evidence: [
              {
                quote: "Alpha changed after Alpha returned",
                sentence_id: "S1",
              },
            ],
            predicate: "changed_after",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
        ],
      }),
    );

    await expect(
      discoverWikilinkRelations({
        chapterId: 1,
        fragmentId: 0,
        maxRetries: 0,
        request,
        sentences,
        window,
      }),
    ).resolves.toStrictEqual([
      {
        evidenceEnd: sentences[0]!.text.length,
        evidenceStart: 0,
        predicate: "changed_after",
        sourceMentionId: "m1",
        targetMentionId: "m2",
      },
    ]);
  });

  it("rejects predicates that normalize to an empty label", async () => {
    const sentences = [{ text: "Alpha founded Beta.", wordsCount: 3 }];
    const window = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 10,
      mentions: [
        {
          id: "m1",
          qid: "Q1",
          range: { end: 5, start: 0 },
          surface: "Alpha",
        },
        {
          id: "m2",
          qid: "Q2",
          range: { end: 18, start: 14 },
          surface: "Beta",
        },
      ],
      text: sentences[0]!.text,
      windowLength: 80,
    })[0]!;
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        relations: [
          {
            evidence: {
              start_anchor: {
                mode: "full",
                text: "Alpha founded Beta.",
              },
            },
            predicate: " - ",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
        ],
      }),
    );

    await expect(
      discoverWikilinkRelations({
        chapterId: 1,
        fragmentId: 0,
        maxRetries: 0,
        request,
        sentences,
        window,
      }),
    ).resolves.toStrictEqual([]);
  });

  it("escapes non-mention prompt text in tagged context", async () => {
    const sentences = [
      {
        text: 'Alpha <mention id="fake">founded</mention>\n\tBeta\u200b & Co.',
        wordsCount: 5,
      },
    ];
    const text = sentences[0]!.text;
    const window = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 10,
      mentions: [
        {
          id: "m1",
          qid: "Q1",
          range: { end: 5, start: 0 },
          surface: "Alpha",
        },
        {
          id: "m2",
          qid: "Q2",
          range: { end: 48, start: 44 },
          surface: "Beta",
        },
      ],
      text,
      windowLength: 120,
    })[0]!;
    const request = vi
      .fn<GuaranteedRequest>()
      .mockResolvedValue(JSON.stringify({ relations: [] }));

    await discoverWikilinkRelations({
      chapterId: 1,
      fragmentId: 0,
      maxRetries: 0,
      request,
      sentences,
      window,
    });

    const prompt = request.mock.calls[0]?.[0][1]?.content ?? "";

    expect(prompt).not.toContain("Mentions:");
    expect(prompt).toContain('<mention id="m1" qid="Q1">Alpha</mention>');
    expect(prompt).toContain('&lt;mention id="fake"&gt;');
    expect(prompt).toContain("S1:");
    expect(prompt).toContain("&amp; Co.");
    expect(prompt).not.toContain('<mention id="fake">');
  });
});

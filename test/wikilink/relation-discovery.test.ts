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
        text: 'Alpha <mention id="fake">founded</mention> Beta & Co.',
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
          range: { end: 47, start: 43 },
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

    expect(prompt).toContain('&lt;mention id="fake"&gt;');
    expect(prompt).toContain("&amp; Co.");
    expect(prompt).not.toContain('<mention id="fake">');
  });
});

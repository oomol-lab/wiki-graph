import { describe, expect, it, vi } from "vitest";

import {
  buildWikimatchWindows,
  judgeWikimatchPolicy,
  parsePolicyResponse,
  type WikimatchCandidate,
} from "../../src/wikimatch/index.js";
import {
  ParsedJsonError,
  type GuaranteedRequest,
} from "../../src/guaranteed/index.js";

describe("wikimatch/policy-judge", () => {
  it("retries with precise business errors when recalled mentions overlap", async () => {
    const input = createInput();
    const request = vi
      .fn<GuaranteedRequest>()
      .mockResolvedValueOnce(
        JSON.stringify({
          groups: [
            {
              decisions: [
                {
                  candidateId: "c1",
                  decision: "recall",
                  qid: "Q1",
                },
                {
                  candidateId: "c2",
                  decision: "recall",
                  qid: "Q2",
                },
              ],
              groupId: "g1",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          groups: [
            {
              decisions: [
                {
                  candidateId: "c1",
                  decision: "recall",
                  qid: "Q1",
                },
                {
                  candidateId: "c2",
                  decision: "skip_this_time",
                },
              ],
              groupId: "g1",
            },
            {
              decisions: [],
              groupId: "g2",
            },
          ],
        }),
      );

    const result = await judgeWikimatchPolicy({
      ...input,
      request,
    });

    expect(result.mentions).toStrictEqual([
      {
        candidateId: "c1",
        qid: "Q1",
        range: {
          end: 9,
          start: 5,
        },
        surface: "北京大学",
      },
    ]);
    expect(result.policyUpdates).toStrictEqual([
      {
        candidateId: "c2",
        decision: "skip_this_time",
        surface: "北京",
      },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0].at(-1)?.content).toContain(
      "Decision conflict: candidates c1 and c2 both use decision",
    );
  });

  it("shows disambiguation options in the prompt and rejects disambiguation qid as final grounding", async () => {
    const input = createInput();
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        groups: [
          {
            decisions: [
              {
                candidateId: "c3",
                decision: "recall",
                qid: "Q48397",
              },
            ],
            groupId: "g2",
          },
        ],
      }),
    );

    const result = await judgeWikimatchPolicy({
      ...input,
      maxRetries: 0,
      request,
    });

    expect(request.mock.calls[0]?.[0][0]?.content).toContain(
      "Recall policy:\n只召回专有名词实体。",
    );
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain(
      "只召回专有名词实体。",
    );
    expect(request.mock.calls[0]?.[0][1]?.content).toContain(
      '<group id="g2">Mercury</group>',
    );
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain('"id":"DIS1"');
    expect(request.mock.calls[0]?.[0][1]?.content).toContain('"qid":"Q308"');
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain("sourceQid");
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain(
      "isDisambiguation",
    );
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain('"range"');
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain('"offset"');
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain('"surface"');
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain(
      '"confidence"',
    );
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain('"note"');
    expect(result).toMatchObject({
      fallback: {
        reason: "guaranteed_json_failed",
      },
      mentions: [],
    });
    expect(result.fallback?.issues[0]).toContain("Source disambiguation QIDs");
  });

  it("can return empty fallback when guaranteed JSON keeps failing", async () => {
    const input = createInput();
    const result = await judgeWikimatchPolicy({
      ...input,
      maxRetries: 0,
      request: vi.fn<GuaranteedRequest>().mockResolvedValue("not json"),
    });

    expect(result.mentions).toStrictEqual([]);
    expect(result.policyUpdates).toStrictEqual([]);
    expect(result.fallback?.reason).toBe("guaranteed_json_failed");
  });

  it("rejects qids outside the candidate option set", () => {
    const input = createInput();

    try {
      parsePolicyResponse(
        input.candidates,
        {
          groups: [
            {
              decisions: [
                {
                  candidateId: "c1",
                  decision: "recall",
                  qid: "Q404",
                },
              ],
              groupId: "g1",
            },
            {
              decisions: [],
              groupId: "g2",
            },
          ],
        },
        input.window.groups,
      );
      throw new Error("Expected parsePolicyResponse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ParsedJsonError);
      expect((error as ParsedJsonError).issues[0]).toContain(
        "Allowed QIDs for",
      );
    }
  });

  it("ignores empty qid values on non-recall decisions", async () => {
    const input = createInput();
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        groups: [
          {
            decisions: [
              {
                candidateId: "c1",
                decision: "never_recall",
                qid: "",
              },
            ],
            groupId: "g1",
          },
          {
            decisions: [],
            groupId: "g2",
          },
        ],
      }),
    );

    const result = await judgeWikimatchPolicy({
      ...input,
      request,
    });

    expect(result.policyUpdates).toStrictEqual([
      {
        candidateId: "c1",
        decision: "never_recall",
        surface: "北京大学",
      },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("ignores null qid values on non-recall decisions", async () => {
    const input = createInput();
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        groups: [
          {
            decisions: [
              {
                candidateId: "c1",
                decision: "never_recall",
                qid: null,
              },
            ],
            groupId: "g1",
          },
          {
            decisions: [],
            groupId: "g2",
          },
        ],
      }),
    );

    const result = await judgeWikimatchPolicy({
      ...input,
      request,
    });

    expect(result.policyUpdates).toStrictEqual([
      {
        candidateId: "c1",
        decision: "never_recall",
        surface: "北京大学",
      },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("normalizes continue on the last candidate page to skip this time", () => {
    const input = createInput();

    const result = parsePolicyResponse(
      [
        {
          ...input.candidates[0]!,
          hasMoreOptions: true,
        },
      ],
      {
        groups: [
          {
            decisions: [
              {
                candidateId: "c1",
                decision: "continue",
              },
            ],
            groupId: "g1",
          },
        ],
      },
      [
        {
          candidateIds: ["c1"],
          id: "g1",
          range: input.candidates[0]!.range,
        },
      ],
    );

    expect(result.continuations).toStrictEqual([
      {
        candidateIds: ["c1"],
        groupId: "g1",
      },
    ]);

    expect(
      parsePolicyResponse(
        [input.candidates[0]!],
        {
          groups: [
            {
              decisions: [
                {
                  candidateId: "c1",
                  decision: "continue",
                },
              ],
              groupId: "g1",
            },
          ],
        },
        [
          {
            candidateIds: ["c1"],
            id: "g1",
            range: input.candidates[0]!.range,
          },
        ],
      ).policyUpdates,
    ).toStrictEqual([
      {
        candidateId: "c1",
        decision: "skip_this_time",
        surface: "北京大学",
      },
    ]);
  });
});

function createInput(): {
  readonly candidates: readonly WikimatchCandidate[];
  readonly policyPrompt: string;
  readonly window: ReturnType<typeof buildWikimatchWindows>[number];
} {
  const text = "张三就读于北京大学。Mercury 是一个有歧义的词。";
  const candidates: WikimatchCandidate[] = [
    {
      id: "c1",
      qidOptions: [
        {
          description: "中国北京市的一所大学",
          label: "北京大学",
          qid: "Q1",
        },
      ],
      range: {
        end: 9,
        start: 5,
      },
      surface: "北京大学",
    },
    {
      id: "c2",
      qidOptions: [
        {
          description: "中国首都",
          label: "北京",
          qid: "Q2",
        },
      ],
      range: {
        end: 7,
        start: 5,
      },
      surface: "北京",
    },
    {
      id: "c3",
      qidOptions: [
        {
          description: "Wikimedia disambiguation page",
          disambiguation: {
            checkedAt: "2026-06-26T00:00:00.000Z",
            disambiguationQid: "Q48397",
            linkedQids: [
              {
                qid: "Q308",
                title: "Mercury (planet)",
              },
            ],
            pages: [
              {
                linkedQids: [
                  {
                    qid: "Q308",
                    title: "Mercury (planet)",
                  },
                ],
                text: "* [[Mercury (planet)|wikg://qid=Q308]], the first planet from the Sun",
                title: "Mercury",
                wiki: "enwiki",
              },
            ],
          },
          isDisambiguation: true,
          label: "Mercury",
          qid: "Q48397",
        },
      ],
      range: {
        end: 17,
        start: 10,
      },
      surface: "Mercury",
    },
  ];
  const [window] = buildWikimatchWindows({
    candidates,
    contextWords: 30,
    optionBudget: 10,
    text,
  });

  if (window === undefined) {
    throw new Error("Missing test window");
  }

  return {
    candidates,
    policyPrompt: "只召回专有名词实体。",
    window,
  };
}

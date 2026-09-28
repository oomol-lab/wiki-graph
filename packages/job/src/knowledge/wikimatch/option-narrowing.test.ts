import { describe, expect, it, vi } from "vitest";

import {
  narrowWikimatchCandidateOptions,
  parseNarrowingResponse,
  type WikimatchCandidate,
} from "./index.js";
import {
  ParsedJsonError,
  type GuaranteedRequest,
} from "../../guaranteed/index.js";

describe("wikimatch/option-narrowing", () => {
  it("splits oversized options into bounded narrowing requests", async () => {
    const request = vi
      .fn<GuaranteedRequest>()
      .mockResolvedValueOnce(
        JSON.stringify({
          qids: [
            { decision: "reject", qid: "Q1" },
            { decision: "keep", qid: "Q2" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          qids: [
            { decision: "keep", qid: "Q3" },
            { decision: "reject", qid: "Q4" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          qids: [{ decision: "reject", qid: "Q5" }],
        }),
      );

    const result = await narrowWikimatchCandidateOptions({
      candidate: disambiguationCandidate(5),
      optionBudget: 2,
      policyPrompt: "只召回历史人物。",
      request,
      text: "朱元璋建立明朝。",
    });

    expect(request).toHaveBeenCalledTimes(3);
    expect(
      result.candidate.qidOptions.flatMap(
        (option) => option.disambiguation?.map((meaning) => meaning.qid) ?? [],
      ),
    ).toStrictEqual(["Q2", "Q3"]);
  });

  it("rejects incomplete narrowing responses with a precise error", () => {
    try {
      parseNarrowingResponse(disambiguationCandidate(2), {
        qids: [{ decision: "keep", qid: "Q1" }],
      });
      throw new Error("Expected parseNarrowingResponse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ParsedJsonError);
      expect((error as ParsedJsonError).issues[0]).toContain(
        "Missing narrowing result for qid Q2",
      );
    }
  });
});

function disambiguationCandidate(count: number): WikimatchCandidate {
  return {
    id: "c1",
    qidOptions: [
      {
        disambiguation: Array.from({ length: count }, (_, index) => ({
          information: `Information ${index + 1}`,
          qid: `Q${index + 1}`,
        })),
        isDisambiguation: true,
        label: "朱元璋",
        qid: "Q100",
      },
    ],
    range: {
      end: 3,
      start: 0,
    },
    surface: "朱元璋",
  };
}

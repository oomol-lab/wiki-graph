import { describe, expect, it } from "vitest";

import {
  countWikimatchCandidateOptions,
  filterCandidateQidOptions,
  listCandidateSelectableQids,
  splitCandidateByOptionBudget,
  type WikimatchCandidate,
} from "./index.js";

describe("wikimatch/options", () => {
  it("counts disambiguation meanings as selectable options", () => {
    const candidate = disambiguationCandidate(5);

    expect(countWikimatchCandidateOptions(candidate)).toBe(5);
    expect(listCandidateSelectableQids(candidate)).toStrictEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "Q5",
    ]);
  });

  it("splits oversized disambiguation options horizontally", () => {
    const chunks = splitCandidateByOptionBudget(disambiguationCandidate(5), 2);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => listChunkQids(chunk))).toStrictEqual([
      ["Q1", "Q2"],
      ["Q3", "Q4"],
      ["Q5"],
    ]);
  });

  it("keeps an empty disambiguation list empty", () => {
    const candidate = disambiguationCandidate(0);

    expect(countWikimatchCandidateOptions(candidate)).toBe(0);
    expect(listCandidateSelectableQids(candidate)).toStrictEqual([]);
  });

  it("filters disambiguation meanings by qid", () => {
    const filtered = filterCandidateQidOptions(
      disambiguationCandidate(3),
      new Set(["Q2"]),
    );

    expect(listCandidateSelectableQids(filtered)).toStrictEqual(["Q2"]);
    expect(filtered.qidOptions[0]?.disambiguation).toStrictEqual([
      { information: "Information 2", qid: "Q2" },
    ]);
  });

  it("rejects non-positive option budgets", () => {
    expect(() =>
      splitCandidateByOptionBudget(disambiguationCandidate(1), 0),
    ).toThrow("Wikimatch option budget must be positive.");
  });
});

function listChunkQids(candidate: WikimatchCandidate): readonly string[] {
  return listCandidateSelectableQids(candidate);
}

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
        label: "Example",
        qid: "Q100",
      },
    ],
    range: {
      end: 7,
      start: 4,
    },
    surface: "Example",
  };
}

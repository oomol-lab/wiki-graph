import { describe, expect, it } from "vitest";

import { buildWikimatchWindows, type WikimatchCandidate } from "./index.js";

describe("wikimatch/window", () => {
  it("keeps overlapping candidates in the same conflict group", () => {
    const text = "张三就读于北京大学，后来去了北京工作。";
    const candidates: WikimatchCandidate[] = [
      candidate("c1", "北京大学", 5, 9, "Q1"),
      candidate("c2", "北京", 5, 7, "Q2"),
      candidate("c3", "北京", 14, 16, "Q2"),
    ];
    const windows = buildWikimatchWindows({
      candidates,
      contextWords: 8,
      optionBudget: 2,
      text,
    });

    expect(windows).toHaveLength(2);
    expect(windows[0]?.groups).toStrictEqual([
      {
        candidateIds: ["c1", "c2"],
        id: "g1",
        range: {
          end: 9,
          start: 5,
        },
      },
    ]);
    expect(windows[1]?.candidates.map((item) => item.id)).toStrictEqual(["c3"]);
  });

  it("counts selectable qid options rather than candidate records", () => {
    const text = "张三去了华盛顿，又去了巴黎。";
    const candidates: WikimatchCandidate[] = [
      candidate("c1", "华盛顿", 4, 7, "Q1", "Q2", "Q3"),
      candidate("c2", "巴黎", 11, 13, "Q4"),
    ];
    const windows = buildWikimatchWindows({
      candidates,
      contextWords: 8,
      optionBudget: 3,
      text,
    });

    expect(windows).toHaveLength(2);
    expect(windows[0]?.candidates.map((item) => item.id)).toStrictEqual(["c1"]);
    expect(windows[1]?.candidates.map((item) => item.id)).toStrictEqual(["c2"]);
  });
});

function candidate(
  id: string,
  surface: string,
  start: number,
  end: number,
  ...qids: string[]
): WikimatchCandidate {
  return {
    id,
    qidOptions: qids.map((qid) => ({ qid })),
    range: { end, start },
    surface,
  };
}

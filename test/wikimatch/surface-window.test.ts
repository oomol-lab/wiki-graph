import { describe, expect, it } from "vitest";

import {
  buildWikimatchSurfaceWindows,
  type WikimatchCandidate,
} from "../../src/wikimatch/index.js";

describe("wikimatch/surface-window", () => {
  it("deduplicates equal surface strings without embedding markers", () => {
    const text = "恩典在神学语境中很重要，但日常也会说恩典。1234 不重要。";
    const candidates: WikimatchCandidate[] = [
      candidate("c1", "恩典", 0, 2),
      candidate("c2", "恩典", 20, 22),
      candidate("c3", "1234", 23, 27),
    ];
    const [window] = buildWikimatchSurfaceWindows({
      candidates,
      contextWords: 20,
      surfaceBudget: 10,
      text,
    });

    expect(window?.text).toContain("恩典在神学语境中很重要");
    expect(window?.surfaces).toStrictEqual([
      {
        id: "s1",
        ranges: [
          { end: 2, start: 0 },
          { end: 22, start: 20 },
        ],
        text: "恩典",
      },
      {
        id: "s2",
        ranges: [{ end: 27, start: 23 }],
        text: "1234",
      },
    ]);
  });
});

function candidate(
  id: string,
  surface: string,
  start: number,
  end: number,
): WikimatchCandidate {
  return {
    id,
    qidOptions: [],
    range: { end, start },
    surface,
  };
}

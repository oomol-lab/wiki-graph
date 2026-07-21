import { describe, expect, it } from "vitest";

import {
  buildWikimatchSurfaceProtectionInput,
  type WikimatchCandidate,
} from "../index.js";

describe("wikimatch/surface-window", () => {
  it("suppresses contained ranges before ranking high-frequency surfaces", () => {
    const text = "北京大学位于北京。北京大学很好。熵很重要。熵增也重要。";
    const result = buildWikimatchSurfaceProtectionInput({
      candidates: [
        candidate("c1", "北京大学", 0, 4),
        candidate("c2", "北京", 0, 2),
        candidate("c3", "大学", 2, 4),
        candidate("c4", "北京", 6, 8),
        candidate("c5", "北京大学", 9, 13),
        candidate("c6", "北京", 9, 11),
        candidate("c7", "大学", 11, 13),
        candidate("c8", "熵", 16, 17),
        candidate("c9", "熵", 21, 22),
      ],
      percentile: 0.5,
      text,
    });

    expect(
      result.suppressedCandidates.map((item) => item.surface),
    ).toStrictEqual(["北京大学", "北京", "北京大学", "熵", "熵"]);
    expect(result.suspiciousSurfaces).toStrictEqual([
      {
        count: 2,
        id: "s1",
        text: "北京大学",
      },
      {
        count: 2,
        id: "s3",
        text: "熵",
      },
    ]);
    expect(result.candidates.map((item) => item.surface)).toStrictEqual([
      "北京",
    ]);
  });

  it("filters suspicious surfaces by source range text", () => {
    const text = "北京北京上海";
    const result = buildWikimatchSurfaceProtectionInput({
      candidates: [
        candidate("c1", "stale", 0, 2),
        candidate("c2", "stale", 2, 4),
        candidate("c3", "上海", 4, 6),
      ],
      percentile: 0.5,
      text,
    });

    expect(result.suspiciousSurfaces).toStrictEqual([
      {
        count: 2,
        id: "s1",
        text: "北京",
      },
    ]);
    expect(result.candidates.map((item) => item.id)).toStrictEqual(["c3"]);
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

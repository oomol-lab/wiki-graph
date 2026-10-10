import { describe, expect, it } from "vitest";

import { normalizeSearchHitScore } from "./score-normalization.js";

describe("normalizeSearchHitScore", () => {
  it("maps the strongest first hit to one in both score directions", () => {
    expect(normalizeSearchHitScore(-12, 1, -12, "ascending")).toBe(1);
    expect(normalizeSearchHitScore(0.9, 1, 0.9, "descending")).toBe(1);
  });

  it("uses rank as the primary signal and raw score as a bounded adjustment", () => {
    expect(normalizeSearchHitScore(-6, 2, -12, "ascending")).toBeCloseTo(
      (61 / 62) * 0.9,
      12,
    );
    expect(normalizeSearchHitScore(0.45, 2, 0.9, "descending")).toBeCloseTo(
      (61 / 62) * 0.9,
      12,
    );
  });
});

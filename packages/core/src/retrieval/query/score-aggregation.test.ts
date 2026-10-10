import { describe, expect, it } from "vitest";

import { aggregateTopScores } from "./score-aggregation.js";

describe("aggregateTopScores", () => {
  it("preserves the score of a single match", () => {
    expect(aggregateTopScores([0.8])).toBeCloseTo(0.8, 12);
  });

  it("does not reward an object merely for repeating equal matches", () => {
    expect(
      aggregateTopScores(Array.from({ length: 10 }, () => 0.6)),
    ).toBeCloseTo(0.6, 12);
  });

  it("keeps the best matches dominant while incorporating weaker matches", () => {
    const score = aggregateTopScores([0.8, 0.7, 0.6]);

    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(0.8);
  });

  it("ignores non-positive and non-finite scores", () => {
    expect(
      aggregateTopScores([Number.NaN, Number.POSITIVE_INFINITY, 0, -1]),
    ).toBe(0);
  });
});

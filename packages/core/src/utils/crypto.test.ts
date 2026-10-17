import { describe, expect, it } from "vitest";

import { randomBase32Uuid } from "./crypto.js";

describe("randomBase32Uuid", () => {
  it("encodes the full UUID entropy with Windows-safe characters", () => {
    const values = new Set(Array.from({ length: 100 }, randomBase32Uuid));

    expect(values).toHaveLength(100);
    for (const value of values) {
      expect(value).toMatch(/^[A-Z2-7]{26}$/u);
    }
  });
});

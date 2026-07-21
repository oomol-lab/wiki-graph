import { describe, expect, it } from "vitest";

import { suppressContainedRanges } from "../../packages/core/src/external/wikimatch/index.js";

describe("wikimatch/range-suppression", () => {
  it("removes only occurrences contained by longer ranges", () => {
    const result = suppressContainedRanges([
      item("北京大学", 0, 4),
      item("北京", 0, 2),
      item("大学", 2, 4),
      item("北京", 8, 10),
      item("熵", 12, 13),
    ]);

    expect(result).toStrictEqual([
      item("北京大学", 0, 4),
      item("北京", 8, 10),
      item("熵", 12, 13),
    ]);
  });
});

function item(
  id: string,
  start: number,
  end: number,
): {
  readonly id: string;
  readonly range: { readonly end: number; readonly start: number };
} {
  return {
    id,
    range: { end, start },
  };
}

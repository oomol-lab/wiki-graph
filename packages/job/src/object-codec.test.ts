import { describe, expect, it } from "vitest";

import { encodeJobObject, parseJobObject } from "./object-codec.js";

describe("job object codec", () => {
  it("round-trips a source fragment", () => {
    const object = {
      fragmentId: 3,
      sentences: [{ text: "A sentence.", wordsCount: 2 }],
      summary: "fragment",
      type: "source-fragment",
    } as const;

    expect(parseJobObject(JSON.parse(encodeJobObject(object)))).toStrictEqual(
      object,
    );
  });

  it("rejects unknown fields", () => {
    expect(() =>
      parseJobObject({ extra: true, type: "end" }),
    ).toThrow();
  });
});

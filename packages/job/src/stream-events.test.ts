import { describe, expect, it } from "vitest";

import { parseChapterJobStreamEvent } from "./stream-events.js";

describe("parseChapterJobStreamEvent", () => {
  it("parses progress and artifact events", () => {
    expect(
      parseChapterJobStreamEvent({
        event: "progress",
        progress: {
          done: 2,
          phase: "matching",
          total: 4,
          unit: "sentence",
        },
      }),
    ).toEqual({
      event: "progress",
      progress: {
        done: 2,
        phase: "matching",
        total: 4,
        unit: "sentence",
      },
    });
    expect(
      parseChapterJobStreamEvent({
        event: "artifact",
        record: { position: 0, text: "Summary.", type: "summary-part" },
      }),
    ).toEqual({
      event: "artifact",
      record: { position: 0, text: "Summary.", type: "summary-part" },
    });
  });

  it("rejects malformed progress events", () => {
    expect(() =>
      parseChapterJobStreamEvent({
        event: "progress",
        progress: {
          done: -1,
          phase: "unknown",
          total: 4,
          unit: "sentence",
        },
      }),
    ).toThrow();
  });
});

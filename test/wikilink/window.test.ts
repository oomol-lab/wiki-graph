import { describe, expect, it } from "vitest";

import {
  buildWikilinkEvidenceWindows,
  type WikilinkMention,
} from "../../src/wikilink/index.js";

describe("wikilink/window", () => {
  it("covers every mention pair within maxEvidenceDistance", () => {
    const text = "x".repeat(10_000);
    const mentions = createMentions([
      0, 3, 99, 100, 499, 500, 501, 999, 1000, 1499, 1500, 2001, 2500, 3499,
      3500, 4100, 4999, 5000, 6200, 7600, 9000, 9998,
    ]);
    const windows = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 1000,
      mentions,
      text,
      windowLength: 3000,
    });

    expect(windows.length).toBeGreaterThan(0);

    for (const [left, right] of listEligiblePairs(mentions, 1000)) {
      expect(
        windows.some(
          (window) =>
            containsMention(window, left) && containsMention(window, right),
        ),
        `${left.id} and ${right.id} should be covered`,
      ).toBe(true);
    }
  });

  it("covers every eligible pair in an exhaustive small grid", () => {
    const text = "x".repeat(80);
    const mentions = createMentions(
      Array.from({ length: 80 }, (_, index) => index),
    );
    const windows = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: 7,
      mentions,
      text,
      windowLength: 20,
    });

    for (const [left, right] of listEligiblePairs(mentions, 7)) {
      expect(
        windows.some(
          (window) =>
            containsMention(window, left) && containsMention(window, right),
        ),
        `${left.id} and ${right.id} should be covered`,
      ).toBe(true);
    }
  });

  it("rejects window length that cannot guarantee pair coverage", () => {
    expect(() =>
      buildWikilinkEvidenceWindows({
        maxEvidenceDistance: 1000,
        mentions: createMentions([10, 20]),
        text: "x".repeat(100),
        windowLength: 1000,
      }),
    ).toThrow("windowLength must be greater than maxEvidenceDistance");
  });
});

function createMentions(
  positions: readonly number[],
): readonly WikilinkMention[] {
  return positions.map((position, index) => ({
    id: `m${index + 1}`,
    range: {
      end: position + 1,
      start: position,
    },
  }));
}

function listEligiblePairs(
  mentions: readonly WikilinkMention[],
  maxEvidenceDistance: number,
): readonly (readonly [WikilinkMention, WikilinkMention])[] {
  const pairs: Array<readonly [WikilinkMention, WikilinkMention]> = [];

  for (let leftIndex = 0; leftIndex < mentions.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < mentions.length;
      rightIndex += 1
    ) {
      const left = mentions[leftIndex]!;
      const right = mentions[rightIndex]!;

      if (right.range.start - left.range.start <= maxEvidenceDistance) {
        pairs.push([left, right]);
      }
    }
  }

  return pairs;
}

function containsMention(
  window: { readonly range: { readonly end: number; readonly start: number } },
  mention: WikilinkMention,
): boolean {
  return (
    mention.range.start >= window.range.start &&
    mention.range.end <= window.range.end
  );
}

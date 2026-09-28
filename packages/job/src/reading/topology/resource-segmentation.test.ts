import { describe, expect, it } from "vitest";

import { createSegmentGroups } from "./resource-segmentation.js";

describe("topology/resource-segmentation", () => {
  it("returns no groups for empty segment input", () => {
    expect(
      createSegmentGroups({
        segmentInfos: [],
        groupWordsCount: 100,
        serialId: 1,
      }),
    ).toStrictEqual([]);
  });

  it("greedily groups adjacent segments without duplicating ids", () => {
    expect(
      createSegmentGroups({
        segmentInfos: [
          {
            startSentenceIndex: 1,
            endIncision: 0,
            startIncision: 0,
            wordsCount: 40,
          },
          {
            startSentenceIndex: 2,
            endIncision: 0,
            startIncision: 0,
            wordsCount: 40,
          },
          {
            startSentenceIndex: 3,
            endIncision: 0,
            startIncision: 0,
            wordsCount: 40,
          },
        ],
        groupWordsCount: 100,
        serialId: 1,
      }),
    ).toStrictEqual([
      { endSentenceIndex: 2, groupId: 0, serialId: 1, startSentenceIndex: 1 },
      { endSentenceIndex: 3, groupId: 1, serialId: 1, startSentenceIndex: 3 },
    ]);
  });

  it("prefers strong incision boundaries when splitting oversized groups", () => {
    expect(
      createSegmentGroups({
        segmentInfos: [
          {
            startSentenceIndex: 1,
            endIncision: 1,
            startIncision: 0,
            wordsCount: 20,
          },
          {
            startSentenceIndex: 2,
            endIncision: 9,
            startIncision: 1,
            wordsCount: 20,
          },
          {
            startSentenceIndex: 3,
            endIncision: 1,
            startIncision: 9,
            wordsCount: 20,
          },
          {
            startSentenceIndex: 4,
            endIncision: 0,
            startIncision: 1,
            wordsCount: 20,
          },
        ],
        groupWordsCount: 60,
        serialId: 1,
      }),
    ).toStrictEqual([
      { endSentenceIndex: 2, groupId: 0, serialId: 1, startSentenceIndex: 1 },
      { endSentenceIndex: 4, groupId: 1, serialId: 1, startSentenceIndex: 3 },
    ]);
  });

  it("forces individually oversized segments into separate groups", () => {
    expect(
      createSegmentGroups({
        segmentInfos: [
          {
            startSentenceIndex: 1,
            endIncision: 0,
            startIncision: 0,
            wordsCount: 70,
          },
          {
            startSentenceIndex: 2,
            endIncision: 0,
            startIncision: 0,
            wordsCount: 70,
          },
          {
            startSentenceIndex: 3,
            endIncision: 0,
            startIncision: 0,
            wordsCount: 70,
          },
        ],
        groupWordsCount: 100,
        serialId: 1,
      }),
    ).toStrictEqual([
      { startSentenceIndex: 1, endSentenceIndex: 1, groupId: 0, serialId: 1 },
      { startSentenceIndex: 2, endSentenceIndex: 2, groupId: 1, serialId: 1 },
      { startSentenceIndex: 3, endSentenceIndex: 3, groupId: 2, serialId: 1 },
    ]);
  });
});

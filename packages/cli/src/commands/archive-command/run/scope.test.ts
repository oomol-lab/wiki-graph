import type { ChapterEntry } from "wiki-graph-sdk";
import { describe, expect, it } from "vitest";

import { selectChapterSubtreeScope, selectRootChapterScope } from "./scope.js";

function chapter(chapterId: number, path: string, depth: number): ChapterEntry {
  return {
    chapterId,
    childCount: 0,
    depth,
    documentOrder: chapterId,
    fragmentCount: 0,
    key: path.split("/").at(-1) ?? path,
    path,
    stage: "sourced",
    title: null,
    tocPath: [],
    uri: `wikg://chapter/${path}`,
    words: 0,
  };
}

describe("archive-command chapter scope", () => {
  const chapters = [
    chapter(1, "part", 0),
    chapter(2, "part/intro", 1),
    chapter(3, "part/intro/deep", 2),
    chapter(4, "appendix", 0),
    chapter(5, "appendix/a", 1),
  ];

  it("selects chapter subtree by depth", () => {
    expect(
      selectChapterSubtreeScope(chapters, 1, undefined).map(
        (entry) => entry.chapterId,
      ),
    ).toStrictEqual([1, 2, 3]);
    expect(
      selectChapterSubtreeScope(chapters, 1, 0).map((entry) => entry.chapterId),
    ).toStrictEqual([1]);
    expect(
      selectChapterSubtreeScope(chapters, 1, 1).map((entry) => entry.chapterId),
    ).toStrictEqual([1, 2]);
    expect(
      selectChapterSubtreeScope(chapters, 1, 2).map((entry) => entry.chapterId),
    ).toStrictEqual([1, 2, 3]);
  });

  it("treats chapter collection as a virtual root", () => {
    expect(
      selectRootChapterScope(chapters, undefined).map(
        (entry) => entry.chapterId,
      ),
    ).toStrictEqual([1, 2, 3, 4, 5]);
    expect(
      selectRootChapterScope(chapters, 0).map((entry) => entry.chapterId),
    ).toStrictEqual([1, 4]);
    expect(
      selectRootChapterScope(chapters, 1).map((entry) => entry.chapterId),
    ).toStrictEqual([1, 2, 4, 5]);
  });
});

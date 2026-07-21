export const CHAPTER_STAGES = [
  "planned",
  "sourced",
  "graphed",
  "summarized",
] as const;

export type ChapterStage = (typeof CHAPTER_STAGES)[number];

export interface ChapterEntry {
  readonly chapterId: number;
  readonly childCount: number;
  readonly depth: number;
  readonly documentOrder: number;
  readonly fragmentCount: number;
  readonly stage: ChapterStage;
  readonly title: string | null;
  readonly tocPath: readonly string[];
  readonly words: number;
}

export interface ChapterDetails extends ChapterEntry {
  readonly graphReady: boolean;
  readonly hasSummary: boolean;
  readonly words: number;
}

export interface ChapterTree {
  readonly chapters: readonly ChapterTreeNode[];
}

export interface ChapterTreeNode {
  readonly children: readonly ChapterTreeNode[];
  readonly id: number;
  readonly title: string | null;
}

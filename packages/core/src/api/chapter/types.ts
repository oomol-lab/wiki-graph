import type { Language } from "../../runtime/common/language.js";
import type { WikiGraphScope } from "../../runtime/common/llm-scope.js";
import type { LLM } from "../../external/llm/index.js";
export { CHAPTER_STAGES } from "../../document/chapter/index.js";
export type {
  ChapterDetails,
  ChapterEntry,
  ChapterStage,
  ChapterTree,
  ChapterTreeNode,
} from "../../document/chapter/index.js";
import type {
  ChapterEntry,
  ChapterStage,
} from "../../document/chapter/index.js";

export interface ChapterTreeInput {
  readonly chapters: readonly ChapterTreeInputNode[];
}

export interface ChapterTreeInputNode {
  readonly children: readonly ChapterTreeInputNode[];
  readonly uri: string;
  readonly title?: string | null | undefined;
}

export interface ChapterTreeApplyResult {
  readonly changed: boolean;
  readonly moved: readonly ChapterTreeMoveChange[];
  readonly renamed: readonly ChapterTreeTitleChange[];
  readonly unchanged: number;
}

export interface ChapterTreeMoveChange {
  readonly newUri: string;
  readonly newIndex: number;
  readonly newPath: readonly string[];
  readonly newParentUri: string | null;
  readonly oldUri: string;
  readonly oldIndex: number;
  readonly oldPath: readonly string[];
  readonly oldParentUri: string | null;
}

export interface ChapterTreeTitleChange {
  readonly uri: string;
  readonly newTitle: string | null;
  readonly oldTitle: string | null;
}

export interface MoveChapterOptions {
  readonly afterChapterId?: number;
  readonly beforeChapterId?: number;
  readonly first?: boolean;
  readonly last?: boolean;
  readonly parentChapterId?: number;
  readonly root?: boolean;
}

export interface AdvanceChapterStagesOptions {
  readonly chapterId?: number;
  readonly extractionPrompt?: string;
  readonly llm: LLM<WikiGraphScope>;
  readonly logDirPath?: string;
  readonly onProgress?: AdvanceChapterStagesProgressCallback;
  readonly targetStage: ChapterStage;
  readonly userLanguage?: Language;
}

export interface AdvanceChapterStagesProgressState {
  readonly graphWords: number;
  readonly summaryWords: number;
  readonly totalGraphWords: number;
  readonly totalSummaryWords: number;
}

export type AdvanceChapterStagesProgressCallback = (
  event: AdvanceChapterStagesProgressEvent,
) => void | Promise<void>;

export type AdvanceChapterStagesProgressEvent =
  | {
      readonly type: "selected";
      readonly state: AdvanceChapterStagesProgressState;
      readonly targetStage: ChapterStage;
      readonly totalChapters: number;
    }
  | {
      readonly type: "skipped";
      readonly chapter: ChapterEntry;
      readonly reason: "planned";
      readonly targetStage: ChapterStage;
    }
  | {
      readonly type: "progress";
      readonly state: AdvanceChapterStagesProgressState;
      readonly targetStage: ChapterStage;
    }
  | {
      readonly type: "started";
      readonly chapter: ChapterEntry;
      readonly step: "graph" | "summary";
      readonly targetStage: ChapterStage;
    }
  | {
      readonly type: "completed";
      readonly chapter: ChapterEntry;
      readonly step: "graph" | "summary";
      readonly targetStage: ChapterStage;
    };

export interface AdvanceChapterStagesResult {
  readonly advanced: readonly ChapterEntry[];
  readonly pending: readonly ChapterEntry[];
  readonly skipped: readonly ChapterEntry[];
}

export interface MutableAdvanceProgressState {
  addGraphWords(words: number): void;
  addSummaryWords(words: number): void;
  snapshot(): AdvanceChapterStagesProgressState;
}

export interface AddChapterOptions {
  readonly parentChapterId?: number;
  readonly title?: string | null | undefined;
}

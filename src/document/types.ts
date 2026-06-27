import {
  createEnumValueAsserter,
  createEnumValueGuard,
} from "../utils/enum.js";

export enum ChunkRetention {
  Verbatim = "verbatim",
  Detailed = "detailed",
  Focused = "focused",
  Relevant = "relevant",
}

export const isChunkRetention = createEnumValueGuard(ChunkRetention);
export const expectChunkRetention = createEnumValueAsserter(
  ChunkRetention,
  "chunk retention",
);

export enum ChunkImportance {
  Critical = "critical",
  Important = "important",
  Helpful = "helpful",
}

export const isChunkImportance = createEnumValueGuard(ChunkImportance);
export const expectChunkImportance = createEnumValueAsserter(
  ChunkImportance,
  "chunk importance",
);

export type SentenceId = readonly [
  serialId: number,
  fragmentId: number,
  sentenceIndex: number,
];

export interface SentenceRecord {
  readonly text: string;
  readonly wordsCount: number;
}

export interface FragmentRecord {
  readonly serialId: number;
  readonly fragmentId: number;
  readonly summary: string;
  readonly sentences: readonly SentenceRecord[];
}

export interface SerialRecord {
  readonly id: number;
  readonly topologyReady: boolean;
}

export interface ChunkRecord {
  readonly id: number;
  readonly generation: number;
  readonly sentenceId: SentenceId;
  readonly label: string;
  readonly content: string;
  readonly sentenceIds: readonly SentenceId[];
  readonly retention?: ChunkRetention;
  readonly importance?: ChunkImportance;
  readonly wordsCount: number;
  readonly weight: number;
}

export type CreateChunkRecord = Omit<ChunkRecord, "id">;

export interface ReadingEdgeRecord {
  readonly fromId: number;
  readonly toId: number;
  readonly strength?: string;
  readonly weight: number;
}

export interface MentionRecord {
  readonly id: string;
  readonly chapterId: number;
  readonly fragmentId: number;
  readonly sentenceIndex?: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly surface: string;
  readonly qid: string;
  readonly confidence?: number;
  readonly note?: string;
}

export interface MentionLinkRecord {
  readonly id: string;
  readonly sourceMentionId: string;
  readonly targetMentionId: string;
  readonly predicate: string;
  readonly evidenceStart?: number;
  readonly evidenceEnd?: number;
  readonly confidence?: number;
  readonly note?: string;
}

export interface SnakeRecord {
  readonly id: number;
  readonly serialId: number;
  readonly groupId: number;
  readonly localSnakeId: number;
  readonly size: number;
  readonly firstLabel: string;
  readonly lastLabel: string;
  readonly wordsCount: number;
  readonly weight: number;
}

export interface CreateSnakeRecord {
  readonly serialId: number;
  readonly groupId: number;
  readonly localSnakeId: number;
  readonly size: number;
  readonly firstLabel: string;
  readonly lastLabel: string;
  readonly wordsCount?: number;
  readonly weight?: number;
}

export interface SnakeChunkRecord {
  readonly snakeId: number;
  readonly chunkId: number;
  readonly position: number;
}

export interface SnakeEdgeRecord {
  readonly fromSnakeId: number;
  readonly toSnakeId: number;
  readonly weight: number;
}

export interface FragmentGroupRecord {
  readonly serialId: number;
  readonly groupId: number;
  readonly fragmentId: number;
}

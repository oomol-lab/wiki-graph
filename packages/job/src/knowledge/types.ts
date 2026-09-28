import type { JobMention, JobMentionLink } from "../contracts.js";

export type SentenceId = readonly [number, number];

export interface KnowledgeSentence {
  readonly text: string;
  readonly wordsCount: number;
}

export interface FragmentRecord {
  readonly fragmentId: number;
  readonly sentences: readonly KnowledgeSentence[];
  readonly serialId: number;
  readonly summary: string;
}

export type MentionRecord = JobMention & {
  readonly chapterId: number;
};

export interface MentionLinkRecord extends Omit<
  JobMentionLink,
  "evidenceSentenceIndexes"
> {
  readonly evidenceSentenceIds: readonly SentenceId[];
}

export interface ChunkExtractionSentence {
  readonly sentenceId: SentenceId;
  readonly text: string;
  readonly wordsCount: number;
}

export interface KnowledgeGraphProgressTracker {
  throwIfStopped(): Promise<void> | void;
  updatePhase(input: {
    readonly done: number;
    readonly force?: boolean;
    readonly phase:
      | "enrichment"
      | "grounding"
      | "matching"
      | "narrowing"
      | "relation-discovery"
      | "screening";
    readonly phaseDetail?: string;
    readonly total: number;
    readonly unit: "candidate" | "char" | "qid" | "window";
  }): Promise<void> | void;
}

export interface WikimediaDisambiguationItem {
  readonly information: string;
  readonly qid: string;
}

import type { SentenceId } from "../../../document/index.js";

export interface RankedSentenceCandidate {
  readonly occurrenceId: string;
  readonly sentenceId: SentenceId;
  readonly index: number;
  readonly text: string;
  readonly prevText: string;
  readonly nextText: string;
  readonly score: number;
  readonly exactRaw: boolean;
  readonly exactNormalized: boolean;
  readonly exactSubstring: boolean;
}

export interface EvidenceResolutionResult {
  readonly sentenceIds: SentenceId[];
  readonly strategy: string;
  readonly confidence: number;
}

export interface EvidenceResolutionFailure {
  readonly fieldName: string;
  readonly code: string;
  readonly message: string;
  readonly candidates: readonly RankedSentenceCandidate[];
}

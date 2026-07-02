export type EvidenceSentenceId = readonly [number, number];

export interface EvidenceSelectionSentence {
  readonly id: string;
  readonly sentenceId: EvidenceSentenceId;
  readonly text: string;
}

export interface EvidenceSelection {
  readonly quote?: string;
  readonly sentence_id?: string;
}

export type EvidenceSelectionList =
  | EvidenceSelection
  | readonly EvidenceSelection[];

export interface EvidenceSelectionCandidate {
  readonly exactNormalized: boolean;
  readonly exactRaw: boolean;
  readonly exactSubstring: boolean;
  readonly index: number;
  readonly nextText: string;
  readonly occurrenceId: string;
  readonly prevText: string;
  readonly score: number;
  readonly sentence: EvidenceSelectionSentence;
  readonly strategy: string;
}

export interface EvidenceSelectionResolution {
  readonly candidate: EvidenceSelectionCandidate;
  readonly confidence: number;
  readonly sentenceIds: readonly EvidenceSentenceId[];
  readonly strategy: string;
}

export interface EvidenceSelectionFailure {
  readonly candidates: readonly EvidenceSelectionCandidate[];
  readonly code:
    | "ambiguous"
    | "invalid"
    | "low_confidence"
    | "missing_sentence"
    | "none";
  readonly message: string;
}

import type {
  EvidenceSelectionCandidate,
  EvidenceSelectionList,
  EvidenceResolutionFailure,
  RankedSentenceCandidate,
} from "../../../../graph/evidence-selection/index.js";
import type { RawChunkEvidence } from "./schema.js";

export function createEvidenceSelectionList(
  evidence: RawChunkEvidence,
): EvidenceSelectionList | undefined {
  if (Array.isArray(evidence)) {
    return evidence.map(createEvidenceSelection);
  }

  const hasSelectionEvidence =
    typeof evidence.quote === "string" ||
    typeof evidence.sentence_id === "string";

  return hasSelectionEvidence ? createEvidenceSelection(evidence) : undefined;
}

function createEvidenceSelection(evidence: {
  readonly quote?: unknown;
  readonly sentence_id?: unknown;
}): {
  readonly quote?: string;
  readonly sentence_id?: string;
} {
  return {
    ...(typeof evidence.quote === "string" ? { quote: evidence.quote } : {}),
    ...(typeof evidence.sentence_id === "string"
      ? { sentence_id: evidence.sentence_id }
      : {}),
  };
}

export function toEvidenceResolutionFailure(
  failure: {
    readonly candidates: readonly EvidenceSelectionCandidate[];
    readonly code: string;
    readonly message: string;
  },
  fieldName: string,
): EvidenceResolutionFailure {
  return {
    candidates: failure.candidates.map(toRankedSentenceCandidate),
    code: failure.code,
    fieldName,
    message: failure.message,
  };
}

function toRankedSentenceCandidate(
  candidate: EvidenceSelectionCandidate,
): RankedSentenceCandidate {
  return {
    exactNormalized: candidate.exactNormalized,
    exactRaw: candidate.exactRaw,
    exactSubstring: candidate.exactSubstring,
    index: candidate.index,
    nextText: candidate.nextText,
    occurrenceId: candidate.occurrenceId,
    prevText: candidate.prevText,
    score: candidate.score,
    sentenceId: candidate.sentence.sentenceId,
    text: candidate.sentence.text,
  };
}

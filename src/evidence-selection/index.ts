export { EvidenceResolver } from "./anchor-resolver.js";
export type {
  EvidenceResolutionFailure,
  EvidenceResolutionResult,
  RankedSentenceCandidate,
} from "./anchor-types.js";
export {
  EVIDENCE_SELECTION_JSON_SHAPE,
  EVIDENCE_SELECTION_PROMPT_FRAGMENT,
  formatEvidenceSelectionChoicePrompt,
} from "./prompt.js";
export {
  normalizeEvidenceText,
  scoreEvidenceQuote,
  type EvidenceQuoteMatchStrategy,
  type EvidenceQuoteScore,
} from "./quote-score.js";
export {
  rankEvidenceQuote,
  resolveEvidenceSelection,
} from "./selection-resolver.js";
export { normalizeText, splitTextIntoSentences } from "./text.js";
export type {
  EvidenceSelection,
  EvidenceSelectionCandidate,
  EvidenceSelectionFailure,
  EvidenceSelectionResolution,
  EvidenceSelectionSentence,
  EvidenceSentenceId,
} from "./types.js";

export { EvidenceResolver } from "./anchor/index.js";
export type {
  EvidenceResolutionFailure,
  EvidenceResolutionResult,
  RankedSentenceCandidate,
} from "./anchor/types.js";
export {
  EVIDENCE_SELECTION_JSON_SHAPE,
  EVIDENCE_SELECTION_PROMPT_FRAGMENT,
  formatEvidenceSelectionChoicePrompt,
} from "./prompt.js";
export {
  normalizeEvidenceDisplayText,
  normalizeEvidenceText,
  scoreEvidenceQuote,
  type EvidenceQuoteMatchStrategy,
  type EvidenceQuoteScore,
} from "./quote-score.js";
export {
  rankEvidenceQuote,
  resolveEvidenceSelection,
  resolveEvidenceSelectionList,
} from "./resolver.js";
export { normalizeText, splitTextIntoSentences } from "./text.js";
export type {
  EvidenceSelection,
  EvidenceSelectionCandidate,
  EvidenceSelectionFailure,
  EvidenceSelectionList,
  EvidenceSelectionResolution,
  EvidenceSelectionSentence,
  EvidenceSentenceId,
} from "./types.js";

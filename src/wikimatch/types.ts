import type { DisambiguationExpansion } from "../wikipage/index.js";

export interface WikimatchCandidate {
  readonly id: string;
  readonly qidOptions: readonly WikimatchQidOption[];
  readonly range: WikimatchTextRange;
  readonly surface: string;
}

export interface WikimatchQidOption {
  readonly description?: string;
  readonly disambiguation?: DisambiguationExpansion;
  readonly isDisambiguation?: boolean;
  readonly label?: string;
  readonly qid: string;
}

export interface WikimatchTextRange {
  readonly end: number;
  readonly start: number;
}

export interface WikimatchWindow {
  readonly baseOffset: number;
  readonly candidates: readonly WikimatchCandidate[];
  readonly groups: readonly WikimatchConflictGroup[];
  readonly text: string;
}

export interface WikimatchSurfaceWindow {
  readonly baseOffset: number;
  readonly surfaces: readonly WikimatchSurface[];
  readonly text: string;
}

export interface WikimatchSurface {
  readonly id: string;
  readonly ranges: readonly WikimatchTextRange[];
  readonly text: string;
}

export interface WikimatchConflictGroup {
  readonly candidateIds: readonly string[];
  readonly id: string;
  readonly range: WikimatchTextRange;
}

export interface BuildWikimatchWindowsOptions {
  readonly candidates: readonly WikimatchCandidate[];
  readonly candidateBudget: number;
  readonly contextWords: number;
  readonly text: string;
}

export interface BuildWikimatchSurfaceWindowsOptions {
  readonly candidates: readonly WikimatchCandidate[];
  readonly contextWords: number;
  readonly surfaceBudget: number;
  readonly text: string;
}

export type WikimatchSurfaceScreeningDecision =
  | "allow"
  | "global_blocklist_candidate"
  | "skip_this_time";

export interface WikimatchSurfaceScreeningInput {
  readonly policyPrompt: string;
  readonly window: WikimatchSurfaceWindow;
}

export interface WikimatchSurfaceScreeningResult {
  readonly fallback?: WikimatchSurfaceScreeningFallback;
  readonly surfaces: readonly WikimatchSurfaceScreeningItem[];
}

export interface WikimatchSurfaceScreeningItem {
  readonly decision: WikimatchSurfaceScreeningDecision;
  readonly note?: string;
  readonly surfaceId: string;
  readonly text: string;
}

export interface WikimatchSurfaceScreeningFallback {
  readonly issues: readonly string[];
  readonly reason: "guaranteed_json_failed";
}

export interface WikimatchSurfaceScreeningItemOutput {
  readonly decision: WikimatchSurfaceScreeningDecision;
  readonly note?: string;
  readonly surfaceId: string;
}

export interface WikimatchSurfaceScreeningResponse {
  readonly surfaces: readonly WikimatchSurfaceScreeningItemOutput[];
}

export type WikimatchPolicyDecision =
  | "never_recall"
  | "recall"
  | "skip_this_time";

export interface WikimatchPolicyJudgeInput {
  readonly candidates: readonly WikimatchCandidate[];
  readonly policyPrompt: string;
  readonly window: WikimatchWindow;
}

export interface WikimatchPolicyJudgeResult {
  readonly fallback?: WikimatchPolicyFallback;
  readonly mentions: readonly WikimatchAcceptedMention[];
  readonly policyUpdates: readonly WikimatchPolicyUpdate[];
}

export interface WikimatchAcceptedMention {
  readonly candidateId: string;
  readonly confidence?: number;
  readonly qid: string;
  readonly range: WikimatchTextRange;
  readonly note?: string;
  readonly surface: string;
}

export interface WikimatchPolicyUpdate {
  readonly candidateId: string;
  readonly decision: Exclude<WikimatchPolicyDecision, "recall">;
  readonly note?: string;
  readonly qid?: string;
  readonly surface: string;
}

export interface WikimatchPolicyFallback {
  readonly issues: readonly string[];
  readonly reason: "guaranteed_json_failed";
}

export interface WikimatchPolicyDecisionOutput {
  readonly candidateId: string;
  readonly confidence?: number;
  readonly decision: WikimatchPolicyDecision;
  readonly qid?: string;
}

export interface WikimatchPolicyGroupOutput {
  readonly decisions: readonly WikimatchPolicyDecisionOutput[];
  readonly groupId: string;
  readonly note?: string;
}

export interface WikimatchPolicyResponse {
  readonly groups: readonly WikimatchPolicyGroupOutput[];
}

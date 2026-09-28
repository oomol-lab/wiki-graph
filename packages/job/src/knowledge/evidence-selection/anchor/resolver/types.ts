export const MIN_AUTO_RESOLVE_GAP = 0.07;
export const MIN_AUTO_RESOLVE_SCORE = 0.9;
export const MIN_BOUNDARY_BONUS_LENGTH = 12;
export const MIN_CANDIDATE_SCORE = 0.55;
export const VERY_HIGH_CONFIDENCE_SCORE = 0.97;
export const MAX_BOUNDARY_BONUS = 0.08;
export const MAX_CANDIDATE_DISPLAY = 3;

export interface AnchorSpec {
  readonly mode: "full" | "head_tail";
  readonly text?: string;
  readonly head?: string;
  readonly tail?: string;
}

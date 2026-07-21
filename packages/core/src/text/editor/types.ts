import {
  createEnumValueAsserter,
  createEnumValueGuard,
} from "../../utils/enum.js";

export enum ReviewSeverity {
  Critical = "critical",
  Major = "major",
  Minor = "minor",
}

export const isReviewSeverity = createEnumValueGuard(ReviewSeverity);
export const expectReviewSeverity = createEnumValueAsserter(
  ReviewSeverity,
  "review severity",
);

export interface ClueReviewerInfo {
  readonly clueId: number;
  readonly label: string;
  readonly reviewerInfo: string;
  readonly weight: number;
}

export interface ReviewIssue {
  readonly problem: string;
  readonly severity: ReviewSeverity;
  readonly suggestion: string;
}

export interface ReviewResult {
  readonly clueId: number;
  readonly issues: readonly ReviewIssue[];
  readonly weight: number;
}

export interface CompressionVersion {
  readonly iteration: number;
  readonly reviews: readonly ReviewResult[];
  readonly score: number;
  readonly text: string;
}

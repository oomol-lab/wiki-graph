export enum ReviewSeverity {
  Critical = "critical",
  Major = "major",
  Minor = "minor",
}

export function isReviewSeverity(value: unknown): value is ReviewSeverity {
  return Object.values(ReviewSeverity).includes(value as ReviewSeverity);
}

export function expectReviewSeverity(value: unknown): ReviewSeverity {
  if (isReviewSeverity(value)) return value;
  throw new Error(`Unknown review severity ${String(value)}.`);
}

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

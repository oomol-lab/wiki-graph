import type { LLM } from "../../external/llm/index.js";
import { REVISION_FEEDBACK_PROMPT_TEMPLATE } from "./prompt-templates.js";
import type { CompressionVersion, ReviewIssue, ReviewResult } from "./types.js";
import { ReviewSeverity } from "./types.js";

const REVIEW_SEVERITY_VALUE: Readonly<Record<ReviewSeverity, number>> =
  Object.freeze({
    [ReviewSeverity.Critical]: 9,
    [ReviewSeverity.Major]: 3,
    [ReviewSeverity.Minor]: 1,
  });

export function calculateScore(reviews: readonly ReviewResult[]): number {
  let totalScore = 0;

  for (const review of reviews) {
    for (const issue of review.issues) {
      totalScore += REVIEW_SEVERITY_VALUE[issue.severity] * review.weight;
    }
  }

  return totalScore;
}

export function createRevisionFeedback<S extends string>(input: {
  llm: LLM<S>;
  reviews: readonly ReviewResult[];
}): string {
  const allIssues = collectIssues(input.reviews);
  const visibleIssues = allIssues.slice(0, 9);
  const hiddenCount = allIssues.length - visibleIssues.length;
  const issueLines: string[] = [];

  for (let index = 0; index < visibleIssues.length; index += 1) {
    const issue = visibleIssues[index];

    if (issue === undefined) {
      continue;
    }

    issueLines.push(
      `${index + 1}. [${issue.severity.toUpperCase()}]`,
      `   Problem: ${issue.problem}`,
    );

    if (issue.suggestion !== "") {
      issueLines.push(`   Suggestion: ${issue.suggestion}`);
    }

    issueLines.push("");
  }

  if (hiddenCount > 0) {
    issueLines.push(
      `... and ${hiddenCount} more issues hidden (lower priority)`,
    );
  }

  return input.llm.loadSystemPrompt(REVISION_FEEDBACK_PROMPT_TEMPLATE, {
    issues_description: issueLines.join("\n"),
  });
}

export function formatIssuesForLog(reviews: readonly ReviewResult[]): string {
  const issues = collectIssues(reviews);

  if (issues.length === 0) {
    return "No issues found - all reviewers are satisfied.\n";
  }

  const lines: string[] = [];

  for (let index = 0; index < issues.length; index += 1) {
    const issue = issues[index];

    if (issue === undefined) {
      continue;
    }

    lines.push(
      `${index + 1}. [${issue.severity.toUpperCase()}]`,
      `   Problem: ${issue.problem}`,
    );

    if (issue.suggestion !== "") {
      lines.push(`   Suggestion: ${issue.suggestion}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function pickBestVersion(
  versions: readonly CompressionVersion[],
): CompressionVersion {
  const bestVersion = versions.reduce<CompressionVersion | undefined>(
    (currentBest, version) => {
      if (currentBest === undefined || version.score < currentBest.score) {
        return version;
      }

      return currentBest;
    },
    undefined,
  );

  if (bestVersion === undefined) {
    throw new Error("Compression failed: no versions generated");
  }

  return bestVersion;
}

function collectIssues(
  reviews: readonly ReviewResult[],
): Array<ReviewIssue & { readonly weight: number }> {
  const issues = reviews.flatMap((review) =>
    review.issues.map((issue) => ({
      ...issue,
      weight: review.weight,
    })),
  );

  issues.sort((left, right) => {
    const severityDelta =
      REVIEW_SEVERITY_VALUE[right.severity] -
      REVIEW_SEVERITY_VALUE[left.severity];

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.weight - left.weight;
  });

  return issues;
}

import { describe, expect, it } from "vitest";

import type { WikiGraphScope } from "../../packages/core/src/runtime/common/llm-scope.js";
import {
  calculateScore,
  createRevisionFeedback,
  formatIssuesForLog,
  pickBestVersion,
} from "../../packages/core/src/text/editor/feedback.js";
import { REVISION_FEEDBACK_PROMPT_TEMPLATE } from "../../packages/core/src/text/editor/prompt-templates.js";
import {
  ReviewSeverity,
  type CompressionVersion,
  type ReviewResult,
} from "../../packages/core/src/text/editor/types.js";
import { ScriptedLLM } from "../helpers/scripted-llm.js";

describe("editor/feedback", () => {
  it("calculates weighted review scores", () => {
    expect(
      calculateScore([
        {
          clueId: 1,
          issues: [
            {
              problem: "Critical issue",
              severity: ReviewSeverity.Critical,
              suggestion: "",
            },
            {
              problem: "Minor issue",
              severity: ReviewSeverity.Minor,
              suggestion: "",
            },
          ],
          weight: 2,
        },
        {
          clueId: 2,
          issues: [
            {
              problem: "Major issue",
              severity: ReviewSeverity.Major,
              suggestion: "",
            },
          ],
          weight: 3,
        },
      ]),
    ).toBe(29);
  });

  it("creates revision feedback from the top 9 sorted issues", () => {
    const llm = new ScriptedLLM<WikiGraphScope>();
    const reviews = Array.from({ length: 11 }, (_, index) => ({
      clueId: index + 1,
      issues: [
        {
          problem: `Issue ${index + 1}`,
          severity:
            index === 0
              ? ReviewSeverity.Critical
              : index < 4
                ? ReviewSeverity.Major
                : ReviewSeverity.Minor,
          suggestion: index % 2 === 0 ? `Suggestion ${index + 1}` : "",
        },
      ],
      weight: 11 - index,
    })) satisfies ReviewResult[];

    const feedback = createRevisionFeedback({
      llm: llm as never,
      reviews,
    });

    expect(feedback).toContain(REVISION_FEEDBACK_PROMPT_TEMPLATE);
    expect(llm.prompts).toHaveLength(1);
    expect(llm.prompts[0]?.templateName).toBe(
      REVISION_FEEDBACK_PROMPT_TEMPLATE,
    );
    expect(
      String(llm.prompts[0]?.templateContext.issues_description),
    ).toContain("[CRITICAL]");
    expect(
      String(llm.prompts[0]?.templateContext.issues_description),
    ).toContain("... and 2 more issues hidden");
  });

  it("formats issue logs and picks the best version", () => {
    const versions = [
      {
        iteration: 1,
        reviews: [],
        score: 5,
        text: "v1",
      },
      {
        iteration: 2,
        reviews: [],
        score: 1,
        text: "v2",
      },
    ] satisfies CompressionVersion[];

    expect(
      formatIssuesForLog([
        {
          clueId: 1,
          issues: [
            {
              problem: "Major gap",
              severity: ReviewSeverity.Major,
              suggestion: "Add context",
            },
          ],
          weight: 1,
        },
      ]),
    ).toContain("Major gap");
    expect(formatIssuesForLog([])).toBe(
      "No issues found - all reviewers are satisfied.\n",
    );
    expect(pickBestVersion(versions).text).toBe("v2");
    expect(() => pickBestVersion([])).toThrow(
      "Compression failed: no versions generated",
    );
  });
});

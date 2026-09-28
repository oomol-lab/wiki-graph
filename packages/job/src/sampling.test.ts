import { describe, expect, it } from "vitest";

import { JOB_LLM_SCOPES, resolveJobLlmSampling } from "./sampling.js";

describe("resolveJobLlmSampling", () => {
  it("keeps fixed editor profiles", () => {
    expect(
      resolveJobLlmSampling(JOB_LLM_SCOPES.readingSummaryCompress),
    ).toEqual({ temperature: 0.7, topP: 0.9 });
    expect(
      resolveJobLlmSampling(JOB_LLM_SCOPES.readingSummaryReviewGuide),
    ).toEqual({ temperature: 0.4, topP: 0.6 });
  });

  it("interpolates retry profiles", () => {
    expect(
      resolveJobLlmSampling(JOB_LLM_SCOPES.readingSummaryReview, 1, 2),
    ).toEqual({ temperature: 0.625, topP: 0.6000000000000001 });
    expect(
      resolveJobLlmSampling(JOB_LLM_SCOPES.readingGraphEvidenceChoice, 2, 2),
    ).toEqual({ temperature: 0.95, topP: 0.8 });
  });
});

export const JOB_LLM_SCOPES = Object.freeze({
  guaranteedResponseIntent: "guaranteed-response-intent",
  knowledgeGraph: "knowledge-graph",
  readingGraphEvidenceChoice: "reading-graph-evidence-choice",
  readingGraphExtraction: "reading-graph-extraction",
  readingSummaryCompress: "reading-summary-compress",
  readingSummaryReview: "reading-summary-review",
  readingSummaryReviewGuide: "reading-summary-review-guide",
} as const);

export type JobLlmScope = (typeof JOB_LLM_SCOPES)[keyof typeof JOB_LLM_SCOPES];

export interface JobLlmSampling {
  readonly temperature: number;
  readonly topP: number;
}

/** Resolves the default sampling used when a host has no user configuration. */
export function resolveJobLlmSampling(
  scope: string,
  retryIndex?: number,
  retryMax?: number,
): JobLlmSampling {
  switch (scope) {
    case JOB_LLM_SCOPES.readingSummaryCompress:
      return { temperature: 0.7, topP: 0.9 };
    case JOB_LLM_SCOPES.readingSummaryReviewGuide:
      return { temperature: 0.4, topP: 0.6 };
    default:
      return {
        temperature: interpolate(0.3, 0.95, retryIndex, retryMax),
        topP: interpolate(0.4, 0.8, retryIndex, retryMax),
      };
  }
}

function interpolate(
  start: number,
  end: number,
  retryIndex: number | undefined,
  retryMax: number | undefined,
): number {
  if (retryIndex === undefined || retryMax === undefined || retryMax <= 0) {
    return start;
  }
  const boundedIndex = Math.min(Math.max(retryIndex, 0), retryMax);
  return start + (end - start) * (boundedIndex / retryMax);
}

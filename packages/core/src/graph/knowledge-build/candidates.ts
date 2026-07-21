import type { GuaranteedRequestController } from "../../external/guaranteed/index.js";
import {
  buildWikimatchSurfaceProtectionInput,
  judgeWikimatchSurfaceProtection,
  type WikimatchCandidate,
} from "../../external/wikimatch/index.js";
import { WIKIMATCH_SURFACE_PROTECTION_PERCENTILE } from "./constants.js";
import type { KnowledgeGraphProgressTracker } from "./types.js";

export async function screenCandidates(input: {
  readonly candidates: readonly WikimatchCandidate[];
  readonly policyPrompt: string;
  readonly progressTracker?: KnowledgeGraphProgressTracker;
  readonly request: GuaranteedRequestController;
  readonly text: string;
}): Promise<readonly WikimatchCandidate[]> {
  if (input.candidates.length === 0) {
    return [];
  }

  const protectionInput = buildWikimatchSurfaceProtectionInput({
    candidates: input.candidates,
    percentile: WIKIMATCH_SURFACE_PROTECTION_PERCENTILE,
    text: input.text,
  });

  await input.progressTracker?.updatePhase({
    done: 0,
    phase: "screening",
    phaseDetail: `${protectionInput.suspiciousSurfaces.length} high-frequency surfaces`,
    total: 1,
    unit: "window",
  });
  await input.progressTracker?.throwIfStopped();
  const protection = await judgeWikimatchSurfaceProtection({
    policyPrompt: input.policyPrompt,
    request: input.request,
    suspiciousSurfaces: protectionInput.suspiciousSurfaces,
  });
  await input.progressTracker?.throwIfStopped();
  const protectedSurfaces = new Set(
    protection.protectedSurfaces.map((surface) => surface.text),
  );
  const allowedCandidateKeys = new Set(
    protectionInput.candidates.map(createCandidateRangeKey),
  );

  await input.progressTracker?.updatePhase({
    done: 1,
    phase: "screening",
    phaseDetail: `${protectedSurfaces.size} protected surfaces`,
    total: 1,
    unit: "window",
  });

  return protectionInput.suppressedCandidates.filter(
    (candidate) =>
      allowedCandidateKeys.has(createCandidateRangeKey(candidate)) ||
      protectedSurfaces.has(candidate.surface),
  );
}

export function countUniqueQids(
  candidates: readonly WikimatchCandidate[],
): number {
  return new Set(
    candidates.flatMap((candidate) =>
      candidate.qidOptions.map((option) => option.qid),
    ),
  ).size;
}

function createCandidateRangeKey(candidate: WikimatchCandidate): string {
  return `${candidate.range.start}\0${candidate.range.end}\0${candidate.surface}`;
}

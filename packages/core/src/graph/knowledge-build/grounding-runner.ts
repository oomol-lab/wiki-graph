import type { GuaranteedRequestController } from "../../external/guaranteed/index.js";
import {
  buildWikimatchWindows,
  judgeWikimatchPolicy,
  type WikimatchAcceptedMention,
  type WikimatchCandidate,
} from "../../external/wikimatch/index.js";
import { WIKIMATCH_GROUNDING_MAX_OPTION_BUDGET } from "./constants.js";
import {
  createGroundingCandidatePages,
  formatGroundingEfficiency,
} from "./grounding.js";
import { mapLazyGuaranteedRequests } from "./request.js";
import type { KnowledgeGraphProgressTracker } from "./types.js";

export async function groundWikimatchCandidates(input: {
  readonly candidates: readonly WikimatchCandidate[];
  readonly policyPrompt: string;
  readonly progressTracker?: KnowledgeGraphProgressTracker;
  readonly request: GuaranteedRequestController;
  readonly text: string;
}): Promise<readonly WikimatchAcceptedMention[]> {
  const mentions: WikimatchAcceptedMention[] = [];
  const candidatePages = createGroundingCandidatePages(input.candidates);
  let completedWindows = 0;
  let totalWindows = 0;

  let activeCandidates = candidatePages.nextPage();

  while (activeCandidates.length > 0) {
    const windows = buildWikimatchWindows({
      candidates: activeCandidates,
      contextWords: 220,
      optionBudget: WIKIMATCH_GROUNDING_MAX_OPTION_BUDGET,
      text: input.text,
    });

    totalWindows += windows.length;
    if (windows.length === 0) {
      break;
    }
    await input.progressTracker?.updatePhase({
      done: completedWindows,
      phase: "grounding",
      total: totalWindows,
      unit: "window",
    });

    const results = await mapLazyGuaranteedRequests(
      input.request,
      windows,
      async (window, request) => {
        try {
          await input.progressTracker?.throwIfStopped();
          return await judgeWikimatchPolicy({
            candidates: window.candidates,
            policyPrompt: input.policyPrompt,
            request,
            window,
          });
        } finally {
          completedWindows += 1;
          await input.progressTracker?.updatePhase({
            done: completedWindows,
            phase: "grounding",
            total: totalWindows,
            unit: "window",
          });
        }
      },
    );

    const continuedCandidateIds = new Set<string>();

    for (const result of results) {
      for (const mention of result.mentions) {
        mentions.push(mention);
        candidatePages.accept(mention);
      }
      for (const update of result.policyUpdates) {
        candidatePages.close(update.candidateId, update.decision);
      }
      for (const continuation of result.continuations) {
        for (const candidateId of continuation.candidateIds) {
          continuedCandidateIds.add(candidateId);
          candidatePages.continue(candidateId);
        }
      }
    }

    activeCandidates = candidatePages.nextPage(continuedCandidateIds);
  }

  await input.progressTracker?.updatePhase({
    done: completedWindows,
    phase: "grounding",
    phaseDetail: formatGroundingEfficiency(
      candidatePages.getStats(),
      mentions.length,
    ),
    total: totalWindows,
    unit: "window",
  });

  return mentions;
}

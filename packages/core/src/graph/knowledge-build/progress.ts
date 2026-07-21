import type { WikipageResolveProgress } from "../../external/wikipage/index.js";
import type { BuildJobProgressReporter } from "../../runtime/jobs/index.js";

export function createEnrichmentProgressReporter(
  progressTracker: Pick<
    BuildJobProgressReporter,
    "throwIfStopped" | "updatePhase"
  >,
): (event: WikipageResolveProgress) => Promise<void> {
  return async (event) => {
    await progressTracker.throwIfStopped();
    const phase = formatEnrichmentProgressPhase(event);

    await progressTracker.updatePhase({
      done: event.done,
      ...(phase.detail === undefined ? {} : { phaseDetail: phase.detail }),
      phase: "enrichment",
      total: event.total,
      unit: phase.unit,
    });
  };
}

function formatEnrichmentProgressPhase(event: WikipageResolveProgress): {
  readonly detail?: string;
  readonly unit: "page" | "qid" | "record";
} {
  switch (event.detail) {
    case "disambiguation-page":
      return {
        detail: "disambiguation",
        unit: "page",
      };
    case "entity":
      return {
        detail: "entity",
        unit: "record",
      };
    case "linked-page":
      return {
        detail: "linked",
        unit: "page",
      };
    case "page":
      return {
        detail: "page",
        unit: "page",
      };
    case "qid":
      return {
        unit: "qid",
      };
  }
}

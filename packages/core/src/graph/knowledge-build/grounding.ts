import {
  filterCandidateQidOptions,
  listCandidateSelectableQids,
  type WikimatchAcceptedMention,
  type WikimatchCandidate,
} from "../../external/wikimatch/index.js";

const WIKIMATCH_GROUNDING_DEFAULT_OPTION_BUDGETS = [5, 10, 20, 35] as const;
const WIKIMATCH_GROUNDING_PRIOR_OPTION_BUDGETS = [3, 5, 10, 20, 35] as const;
const WIKIMATCH_GROUNDING_SURFACE_PRIOR_THRESHOLD = 3;

export function createGroundingCandidatePages(
  candidates: readonly WikimatchCandidate[],
): {
  readonly accept: (mention: WikimatchAcceptedMention) => void;
  readonly close: (
    candidateId: string,
    decision?: "skip_this_time" | "never_recall",
  ) => void;
  readonly continue: (candidateId: string) => void;
  readonly getStats: () => GroundingCandidatePageStats;
  readonly nextPage: (
    continuedCandidateIds?: ReadonlySet<string>,
  ) => readonly WikimatchCandidate[];
} {
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const shownQidsByCandidateId = new Map(
    candidates.map((candidate) => [candidate.id, new Set<string>()]),
  );
  const pageIndexesByCandidateId = new Map(
    candidates.map((candidate) => [candidate.id, 0]),
  );
  const closedCandidateIds = new Set<string>();
  const recallCounts = new Map<string, number>();
  const surfaceStats = new Map<string, GroundingSurfaceStats>();
  const stats: GroundingCandidatePageStats = {
    candidatePageCount: 0,
    qidAppearanceCount: 0,
  };

  return {
    accept(mention) {
      closedCandidateIds.add(mention.candidateId);
      getSurfaceStats(surfaceStats, mention.surface).recallCount += 1;
      recallCounts.set(
        createSurfaceQidKey(mention.surface, mention.qid),
        (recallCounts.get(createSurfaceQidKey(mention.surface, mention.qid)) ??
          0) + 1,
      );
    },
    close(candidateId, decision) {
      closedCandidateIds.add(candidateId);
      const candidate = candidatesById.get(candidateId);

      if (
        candidate !== undefined &&
        (decision === "skip_this_time" || decision === "never_recall")
      ) {
        getSurfaceStats(surfaceStats, candidate.surface).rejectCount += 1;
      }
    },
    continue(candidateId) {
      const candidate = candidatesById.get(candidateId);

      if (candidate !== undefined) {
        getSurfaceStats(surfaceStats, candidate.surface).continueCount += 1;
      }
    },
    getStats() {
      return { ...stats };
    },
    nextPage(continuedCandidateIds) {
      const pageCandidates: WikimatchCandidate[] = [];
      const candidateIds =
        continuedCandidateIds === undefined
          ? candidates.map((candidate) => candidate.id)
          : [...continuedCandidateIds];

      for (const candidateId of candidateIds) {
        if (closedCandidateIds.has(candidateId)) {
          continue;
        }

        const candidate = candidatesById.get(candidateId);
        const shownQids = shownQidsByCandidateId.get(candidateId);

        if (candidate === undefined || shownQids === undefined) {
          continue;
        }

        const sortedCandidate = sortCandidateOptionsByRecall(
          candidate,
          recallCounts,
        );
        const selectableQids = listCandidateSelectableQids(sortedCandidate);
        const pageIndex = pageIndexesByCandidateId.get(candidateId) ?? 0;
        const optionBudget = getGroundingCandidateOptionBudget(
          getSurfaceStats(surfaceStats, candidate.surface),
          pageIndex,
        );
        const selectedQids = selectableQids
          .filter((qid) => !shownQids.has(qid))
          .slice(0, optionBudget);

        if (selectedQids.length === 0) {
          closedCandidateIds.add(candidateId);
          continue;
        }

        for (const qid of selectedQids) {
          shownQids.add(qid);
        }

        const hasMoreOptions = selectableQids.some(
          (qid) => !shownQids.has(qid),
        );
        const pageCandidate = filterCandidateQidOptions(
          sortedCandidate,
          new Set(selectedQids),
        );

        if (!hasMoreOptions) {
          closedCandidateIds.add(candidateId);
        }
        getSurfaceStats(surfaceStats, candidate.surface).seenCount += 1;
        pageIndexesByCandidateId.set(candidateId, pageIndex + 1);
        stats.candidatePageCount += 1;
        stats.qidAppearanceCount += selectedQids.length;
        pageCandidates.push({
          ...pageCandidate,
          ...(hasMoreOptions ? { hasMoreOptions: true } : {}),
        });
      }

      return pageCandidates;
    },
  };
}

interface GroundingSurfaceStats {
  continueCount: number;
  recallCount: number;
  rejectCount: number;
  seenCount: number;
}

interface GroundingCandidatePageStats {
  candidatePageCount: number;
  qidAppearanceCount: number;
}

function getSurfaceStats(
  surfaceStats: Map<string, GroundingSurfaceStats>,
  surface: string,
): GroundingSurfaceStats {
  const existing = surfaceStats.get(surface);

  if (existing !== undefined) {
    return existing;
  }

  const created = {
    continueCount: 0,
    recallCount: 0,
    rejectCount: 0,
    seenCount: 0,
  };
  surfaceStats.set(surface, created);

  return created;
}

function getGroundingCandidateOptionBudget(
  stats: GroundingSurfaceStats,
  pageIndex: number,
): number {
  const budgets = hasStrongGroundingSurfacePrior(stats)
    ? WIKIMATCH_GROUNDING_PRIOR_OPTION_BUDGETS
    : WIKIMATCH_GROUNDING_DEFAULT_OPTION_BUDGETS;

  return budgets[Math.min(pageIndex, budgets.length - 1)]!;
}

function hasStrongGroundingSurfacePrior(stats: GroundingSurfaceStats): boolean {
  if (stats.seenCount < WIKIMATCH_GROUNDING_SURFACE_PRIOR_THRESHOLD) {
    return false;
  }

  return (
    (stats.recallCount >= 2 && stats.continueCount === 0) ||
    (stats.rejectCount >= 2 && stats.recallCount === 0) ||
    stats.continueCount >= WIKIMATCH_GROUNDING_SURFACE_PRIOR_THRESHOLD
  );
}

export function formatGroundingEfficiency(
  stats: GroundingCandidatePageStats,
  mentionCount: number,
): string {
  const qidPerMention =
    mentionCount === 0
      ? "n/a"
      : (stats.qidAppearanceCount / mentionCount).toFixed(1);

  return `efficiency qid/mention=${qidPerMention} qids=${stats.qidAppearanceCount} mentions=${mentionCount} pages=${stats.candidatePageCount}`;
}

function sortCandidateOptionsByRecall(
  candidate: WikimatchCandidate,
  recallCounts: ReadonlyMap<string, number>,
): WikimatchCandidate {
  return {
    ...candidate,
    qidOptions: [...candidate.qidOptions].sort((left, right) => {
      return (
        getOptionRecallScore(candidate.surface, right, recallCounts) -
        getOptionRecallScore(candidate.surface, left, recallCounts)
      );
    }),
  };
}

function getOptionRecallScore(
  surface: string,
  option: WikimatchCandidate["qidOptions"][number],
  recallCounts: ReadonlyMap<string, number>,
): number {
  const directScore =
    recallCounts.get(createSurfaceQidKey(surface, option.qid)) ?? 0;
  const disambiguationScore =
    option.disambiguation?.linkedQids.reduce(
      (total, item) =>
        total + (recallCounts.get(createSurfaceQidKey(surface, item.qid)) ?? 0),
      0,
    ) ?? 0;
  const profileScore =
    option.disambiguation?.profile?.meanings.reduce(
      (total, item) =>
        total + (recallCounts.get(createSurfaceQidKey(surface, item.qid)) ?? 0),
      0,
    ) ?? 0;

  return directScore + disambiguationScore + profileScore;
}

function createSurfaceQidKey(surface: string, qid: string): string {
  return `${surface}\0${qid}`;
}

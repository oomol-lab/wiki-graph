import type { DisambiguationProfile } from "../wikipage/index.js";

import type { WikimatchCandidate, WikimatchQidOption } from "./types.js";

export function countWikimatchCandidateOptions(
  candidate: WikimatchCandidate,
): number {
  return candidate.qidOptions.reduce(
    (total, option) => total + countWikimatchQidOption(option),
    0,
  );
}

export function countWikimatchQidOption(option: WikimatchQidOption): number {
  if (option.disambiguation === undefined) {
    return 1;
  }

  return listSelectableQids(option).length;
}

export function listCandidateSelectableQids(
  candidate: WikimatchCandidate,
): readonly string[] {
  return [
    ...new Set(
      candidate.qidOptions.flatMap((option) => listSelectableQids(option)),
    ),
  ];
}

export function filterCandidateQidOptions(
  candidate: WikimatchCandidate,
  allowedQids: ReadonlySet<string>,
): WikimatchCandidate {
  return {
    ...candidate,
    qidOptions: candidate.qidOptions.flatMap((option) => {
      const filtered = filterQidOption(option, allowedQids);

      return filtered === undefined ? [] : [filtered];
    }),
  };
}

export function splitCandidateByOptionBudget(
  candidate: WikimatchCandidate,
  optionBudget: number,
): readonly WikimatchCandidate[] {
  if (!Number.isFinite(optionBudget) || optionBudget <= 0) {
    throw new Error("Wikimatch option budget must be positive.");
  }

  const chunks: WikimatchCandidate[] = [];
  let pendingOptions: WikimatchQidOption[] = [];
  let pendingCost = 0;

  for (const option of candidate.qidOptions) {
    const optionChunks = splitQidOptionByBudget(option, optionBudget);

    for (const optionChunk of optionChunks) {
      const cost = countWikimatchQidOption(optionChunk);

      if (pendingOptions.length > 0 && pendingCost + cost > optionBudget) {
        chunks.push({
          ...candidate,
          qidOptions: pendingOptions,
        });
        pendingOptions = [];
        pendingCost = 0;
      }

      pendingOptions.push(optionChunk);
      pendingCost += cost;
    }
  }

  if (pendingOptions.length > 0) {
    chunks.push({
      ...candidate,
      qidOptions: pendingOptions,
    });
  }

  return chunks;
}

export function sliceCandidateByOptionBudget(
  candidate: WikimatchCandidate,
  optionBudget: number,
  offset: number,
): {
  readonly candidate: WikimatchCandidate;
  readonly nextOffset?: number;
} {
  if (!Number.isFinite(optionBudget) || optionBudget <= 0) {
    throw new Error("Wikimatch option budget must be positive.");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Wikimatch option offset must be a non-negative integer.");
  }

  const selectedQids = listCandidateSelectableQids(candidate).slice(
    offset,
    offset + optionBudget,
  );
  const filtered = filterCandidateQidOptions(candidate, new Set(selectedQids));
  const nextOffset =
    offset + selectedQids.length < listCandidateSelectableQids(candidate).length
      ? offset + selectedQids.length
      : undefined;

  return {
    candidate: {
      ...filtered,
      ...(nextOffset === undefined ? {} : { hasMoreOptions: true }),
    },
    ...(nextOffset === undefined ? {} : { nextOffset }),
  };
}

function splitQidOptionByBudget(
  option: WikimatchQidOption,
  optionBudget: number,
): readonly WikimatchQidOption[] {
  if (option.disambiguation === undefined) {
    return [option];
  }

  const selectableQids = listSelectableQids(option);

  if (selectableQids.length <= optionBudget) {
    return [option];
  }

  const chunks: WikimatchQidOption[] = [];

  for (let index = 0; index < selectableQids.length; index += optionBudget) {
    const qids = new Set(selectableQids.slice(index, index + optionBudget));
    const filtered = filterQidOption(option, qids);

    if (filtered !== undefined) {
      chunks.push(filtered);
    }
  }

  return chunks;
}

function filterQidOption(
  option: WikimatchQidOption,
  allowedQids: ReadonlySet<string>,
): WikimatchQidOption | undefined {
  if (option.disambiguation === undefined) {
    return allowedQids.has(option.qid) ? option : undefined;
  }

  const profileMeanings = option.disambiguation.profile?.meanings ?? [];
  const hasProfileMeanings = profileMeanings.length > 0;
  const linkedQids = hasProfileMeanings
    ? option.disambiguation.linkedQids
    : option.disambiguation.linkedQids.filter((item) =>
        allowedQids.has(item.qid),
      );
  const profile = filterDisambiguationProfile(
    option.disambiguation.profile,
    allowedQids,
  );
  const hasFilteredProfileMeanings = (profile?.meanings.length ?? 0) > 0;

  if (hasProfileMeanings && !hasFilteredProfileMeanings) {
    return undefined;
  }
  if (linkedQids.length === 0 && !hasFilteredProfileMeanings) {
    return undefined;
  }

  return {
    ...option,
    disambiguation: {
      ...option.disambiguation,
      linkedQids,
      ...(profile === undefined ? {} : { profile }),
    },
  };
}

function filterDisambiguationProfile(
  profile: DisambiguationProfile | undefined,
  allowedQids: ReadonlySet<string>,
): DisambiguationProfile | undefined {
  if (profile === undefined) {
    return undefined;
  }

  return {
    ...profile,
    meanings: profile.meanings.filter((meaning) =>
      allowedQids.has(meaning.qid),
    ),
  };
}

function listSelectableQids(option: WikimatchQidOption): readonly string[] {
  if (option.disambiguation === undefined) {
    return [option.qid];
  }

  const profileQids =
    option.disambiguation.profile?.meanings.map((meaning) => meaning.qid) ?? [];

  return profileQids.length > 0
    ? [...new Set(profileQids)]
    : [...new Set(option.disambiguation.linkedQids.map((item) => item.qid))];
}

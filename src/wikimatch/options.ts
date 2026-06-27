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

  const linkedQids = option.disambiguation.linkedQids.filter((item) =>
    allowedQids.has(item.qid),
  );
  const profile = filterDisambiguationProfile(
    option.disambiguation.profile,
    allowedQids,
  );
  const hasProfileMeanings = (profile?.meanings.length ?? 0) > 0;

  if (linkedQids.length === 0 && !hasProfileMeanings) {
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

  return [
    ...new Set([
      ...(option.disambiguation.profile?.meanings.map(
        (meaning) => meaning.qid,
      ) ?? []),
      ...option.disambiguation.linkedQids.map((item) => item.qid),
    ]),
  ];
}

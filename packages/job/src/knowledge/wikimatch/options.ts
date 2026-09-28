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

  const disambiguation = option.disambiguation.filter((item) =>
    allowedQids.has(item.qid),
  );

  if (disambiguation.length === 0) {
    return undefined;
  }

  return {
    ...option,
    disambiguation,
  };
}

function listSelectableQids(option: WikimatchQidOption): readonly string[] {
  if (option.disambiguation === undefined) {
    return [option.qid];
  }

  return [...new Set(option.disambiguation.map((item) => item.qid))];
}

import { WikipageResolver } from "../wikipage/index.js";

import type {
  QidResolution,
  WikipageResolverOptions,
  WikipageResolveProgressReporter,
} from "../wikipage/index.js";
import type { WikimatchCandidate, WikimatchQidOption } from "./types.js";

export async function enrichWikimatchCandidates(
  candidates: readonly WikimatchCandidate[],
  options: {
    readonly progress?: WikipageResolveProgressReporter;
    readonly resolverOptions?: Omit<WikipageResolverOptions, "progress">;
  } = {},
): Promise<readonly WikimatchCandidate[]> {
  if (candidates.length === 0) {
    return [];
  }

  const resolver = await WikipageResolver.open({
    ...(options.resolverOptions ?? {}),
    ...(options.progress === undefined ? {} : { progress: options.progress }),
  });

  try {
    return applyQidResolutions(
      candidates,
      await resolver.resolveQids(listQids(candidates)),
    );
  } finally {
    await resolver.close();
  }
}

export function applyQidResolutions(
  candidates: readonly WikimatchCandidate[],
  resolutions: readonly QidResolution[],
): readonly WikimatchCandidate[] {
  const resolutionsByQid = new Map(
    resolutions.map((resolution) => [resolution.qid, resolution]),
  );

  return candidates.map((candidate) => ({
    ...candidate,
    qidOptions: candidate.qidOptions.map((option) =>
      enrichQidOption(option, resolutionsByQid.get(option.qid)),
    ),
  }));
}

function enrichQidOption(
  option: WikimatchQidOption,
  resolution: QidResolution | undefined,
): WikimatchQidOption {
  if (resolution === undefined) {
    return option;
  }

  return {
    ...option,
    ...(resolution.description === undefined
      ? {}
      : { description: resolution.description }),
    ...(resolution.disambiguation === undefined
      ? {}
      : { disambiguation: resolution.disambiguation }),
    isDisambiguation: resolution.isDisambiguation,
    ...(resolution.label === undefined ? {} : { label: resolution.label }),
  };
}

function listQids(
  candidates: readonly WikimatchCandidate[],
): readonly string[] {
  return [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.qidOptions.map((option) => option.qid),
      ),
    ),
  ];
}

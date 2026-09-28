import type {
  WikimediaResolution,
  WikimediaResolver,
} from "../wikipage/index.js";
import type { WikimatchCandidate, WikimatchQidOption } from "./types.js";

export async function enrichWikimatchCandidates(
  candidates: readonly WikimatchCandidate[],
  options: {
    readonly language?: string;
    readonly resolver: WikimediaResolver;
  },
): Promise<readonly WikimatchCandidate[]> {
  if (candidates.length === 0) {
    return [];
  }

  return applyQidResolutions(
    candidates,
    await options.resolver.resolve(listQids(candidates)),
    options.language,
  );
}

export function applyQidResolutions(
  candidates: readonly WikimatchCandidate[],
  resolutions: readonly WikimediaResolution[],
  language = "zh",
): readonly WikimatchCandidate[] {
  const resolutionsByQid = new Map(
    resolutions.map((resolution) => [resolution.qid, resolution]),
  );

  return candidates.map((candidate) => ({
    ...candidate,
    qidOptions: candidate.qidOptions.map((option) =>
      enrichQidOption(option, resolutionsByQid.get(option.qid), language),
    ),
  }));
}

function enrichQidOption(
  option: WikimatchQidOption,
  resolution: WikimediaResolution | undefined,
  language: string,
): WikimatchQidOption {
  if (resolution === undefined) {
    return option;
  }

  const profile = language === "en" ? resolution.en : resolution.zh;

  return {
    ...option,
    ...(profile.description === null
      ? {}
      : { description: profile.description }),
    ...(resolution.disambiguation === undefined
      ? {}
      : { disambiguation: resolution.disambiguation }),
    ...(profile.label === null ? {} : { label: profile.label }),
    ...(profile.url === null ? {} : { url: profile.url }),
  };
}

function listQids(
  candidates: readonly WikimatchCandidate[],
): readonly { readonly disambiguation: boolean; readonly qid: string }[] {
  return [
    ...new Map(
      candidates.flatMap((candidate) =>
        candidate.qidOptions.map((option) => [
          option.qid,
          {
            disambiguation: option.isDisambiguation === true,
            qid: option.qid,
          },
        ]),
      ),
    ).values(),
  ];
}

import type {
  JobWikimediaResolution as WikimediaResolution,
  JobWikimediaResolver as WikimediaResolver,
} from "../../ports.js";
import type { WikimatchCandidate, WikimatchQidOption } from "./types.js";

export async function enrichWikimatchCandidates(
  candidates: readonly WikimatchCandidate[],
  options: {
    readonly language?: string;
    readonly onProgress?: (resolved: number) => Promise<void> | void;
    readonly resolver: WikimediaResolver;
    readonly signal?: AbortSignal;
  },
): Promise<readonly WikimatchCandidate[]> {
  if (candidates.length === 0) {
    return [];
  }

  const input = listQids(candidates);
  const resolutions: WikimediaResolution[] = [];
  const received = new Set<number>();
  const stream =
    options.signal === undefined
      ? options.resolver.resolve(input)
      : options.resolver.resolve(input, { signal: options.signal });
  for await (const item of stream) {
    validateResolutionIndex(item.index, input.length, received);
    resolutions[item.index] = item.resolution;
    received.add(item.index);
    await options.onProgress?.(received.size);
  }
  if (received.size !== input.length) {
    throw new Error(
      `Wikimedia resolver ended after ${received.size} of ${input.length} results`,
    );
  }
  return applyQidResolutions(candidates, input, resolutions, options.language);
}

function validateResolutionIndex(
  index: number,
  length: number,
  received: ReadonlySet<number>,
): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error(`Wikimedia resolver returned invalid input index ${index}`);
  }
  if (received.has(index)) {
    throw new Error(`Wikimedia resolver returned input index ${index} twice`);
  }
}

export function applyQidResolutions(
  candidates: readonly WikimatchCandidate[],
  input: readonly {
    readonly disambiguation: boolean;
    readonly qid: string;
  }[],
  resolutions: readonly WikimediaResolution[],
  language = "zh",
): readonly WikimatchCandidate[] {
  const resolutionsByInput = new Map(
    input.map((item, index) => [
      resolutionInputKey(item.qid, item.disambiguation),
      resolutions[index],
    ]),
  );

  return candidates.map((candidate) => ({
    ...candidate,
    qidOptions: candidate.qidOptions.map((option) =>
      enrichQidOption(
        option,
        resolutionsByInput.get(
          resolutionInputKey(option.qid, option.isDisambiguation === true),
        ),
        language,
      ),
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
    ...(option.isDisambiguation === true
      ? { disambiguation: resolution.disambiguation ?? [] }
      : resolution.disambiguation === undefined
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
          resolutionInputKey(option.qid, option.isDisambiguation === true),
          {
            disambiguation: option.isDisambiguation === true,
            qid: option.qid,
          },
        ]),
      ),
    ).values(),
  ];
}

function resolutionInputKey(qid: string, disambiguation: boolean): string {
  return JSON.stringify([qid, disambiguation]);
}

import type {
  BuildWikimatchSurfaceProtectionInputOptions,
  WikimatchCandidate,
  WikimatchSurface,
  WikimatchSurfaceProtectionBuildResult,
} from "./types.js";
import { suppressContainedRanges } from "./range-suppression.js";

export function buildWikimatchSurfaceProtectionInput(
  options: BuildWikimatchSurfaceProtectionInputOptions,
): WikimatchSurfaceProtectionBuildResult {
  const suppressedCandidates = suppressContainedRanges(options.candidates);
  const surfaces = listSurfaces(suppressedCandidates, options.text);
  const suspiciousSurfaces = selectTopSurfaces(surfaces, options.percentile);
  const suspiciousTexts = new Set(
    suspiciousSurfaces.map((surface) => surface.text),
  );

  return {
    candidates: suppressedCandidates.filter(
      (candidate) =>
        !suspiciousTexts.has(
          options.text.slice(candidate.range.start, candidate.range.end),
        ),
    ),
    suppressedCandidates,
    suspiciousSurfaces,
  };
}

function listSurfaces(
  candidates: readonly WikimatchCandidate[],
  text: string,
): readonly WikimatchSurface[] {
  const surfaces = new Map<string, number>();

  for (const candidate of candidates) {
    const surface = text.slice(candidate.range.start, candidate.range.end);

    surfaces.set(surface, (surfaces.get(surface) ?? 0) + 1);
  }

  return [...surfaces.entries()]
    .map(([surface, count], index) => ({
      count,
      id: `s${index + 1}`,
      text: surface,
    }))
    .sort(compareSurface);
}

function selectTopSurfaces(
  surfaces: readonly WikimatchSurface[],
  percentile: number,
): readonly WikimatchSurface[] {
  if (surfaces.length === 0 || percentile <= 0) {
    return [];
  }

  const count = Math.ceil(surfaces.length * Math.min(1, percentile));

  return surfaces.slice(0, count);
}

function compareSurface(
  left: WikimatchSurface,
  right: WikimatchSurface,
): number {
  return (
    right.count - left.count ||
    left.text.localeCompare(right.text) ||
    left.id.localeCompare(right.id)
  );
}

import { expandRangeByWords } from "./words.js";
import type {
  BuildWikimatchSurfaceWindowsOptions,
  WikimatchCandidate,
  WikimatchSurface,
  WikimatchSurfaceWindow,
  WikimatchTextRange,
} from "./types.js";

export function buildWikimatchSurfaceWindows(
  options: BuildWikimatchSurfaceWindowsOptions,
): readonly WikimatchSurfaceWindow[] {
  const surfaces = listSurfaces(normalizeCandidates(options.candidates ?? []));
  const windows: WikimatchSurfaceWindow[] = [];
  let pending: WikimatchSurface[] = [];

  for (const surface of surfaces) {
    if (pending.length > 0 && pending.length + 1 > options.surfaceBudget) {
      windows.push(createSurfaceWindow(options.text, pending, options));
      pending = [];
    }

    pending.push(surface);
  }

  if (pending.length > 0) {
    windows.push(createSurfaceWindow(options.text, pending, options));
  }

  return windows;
}

function createSurfaceWindow(
  text: string,
  surfaces: readonly WikimatchSurface[],
  options: BuildWikimatchSurfaceWindowsOptions,
): WikimatchSurfaceWindow {
  const ranges = surfaces.flatMap((surface) => surface.ranges);
  const start = Math.min(...ranges.map((range) => range.start));
  const end = Math.max(...ranges.map((range) => range.end));
  const expandedRange = expandRangeByWords({
    rangeEnd: end,
    rangeStart: start,
    text,
    words: options.contextWords,
  });

  return {
    baseOffset: expandedRange.start,
    surfaces,
    text: text.slice(expandedRange.start, expandedRange.end),
  };
}

function listSurfaces(
  candidates: readonly WikimatchCandidate[],
): readonly WikimatchSurface[] {
  const surfaces = new Map<
    string,
    { readonly index: number; readonly ranges: WikimatchTextRange[] }
  >();

  for (const candidate of candidates) {
    const existing = surfaces.get(candidate.surface);

    if (existing === undefined) {
      surfaces.set(candidate.surface, {
        index: candidate.range.start,
        ranges: [candidate.range],
      });
      continue;
    }

    existing.ranges.push(candidate.range);
  }

  return [...surfaces.entries()]
    .sort((left, right) => left[1].index - right[1].index)
    .map(([text, item], index) => ({
      id: `s${index + 1}`,
      ranges: item.ranges,
      text,
    }));
}

function normalizeCandidates(
  candidates: readonly WikimatchCandidate[],
): readonly WikimatchCandidate[] {
  return candidates
    .filter((candidate) => candidate.range.start < candidate.range.end)
    .sort(compareCandidate);
}

function compareCandidate(
  left: WikimatchCandidate,
  right: WikimatchCandidate,
): number {
  return (
    left.range.start - right.range.start ||
    right.range.end - left.range.end ||
    left.id.localeCompare(right.id)
  );
}

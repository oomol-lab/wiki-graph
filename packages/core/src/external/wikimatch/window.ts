import { expandRangeByWords } from "./words.js";
import { countWikimatchCandidateOptions } from "./options.js";
import type {
  BuildWikimatchWindowsOptions,
  WikimatchCandidate,
  WikimatchWindow,
} from "./types.js";

interface CandidateGroup {
  readonly candidates: readonly WikimatchCandidate[];
  readonly range: {
    readonly end: number;
    readonly start: number;
  };
}

export function buildWikimatchWindows(
  options: BuildWikimatchWindowsOptions,
): readonly WikimatchWindow[] {
  const groups = groupOverlappingCandidates(
    normalizeCandidates(options.candidates ?? []),
  );
  const windows: WikimatchWindow[] = [];
  let pendingGroups: CandidateGroup[] = [];
  let pendingOptionCount = 0;

  for (const group of groups) {
    const groupOptionCount = countGroupOptions(group);

    if (
      pendingGroups.length > 0 &&
      pendingOptionCount + groupOptionCount > options.optionBudget
    ) {
      windows.push(createWindow(options.text, pendingGroups, options));
      pendingGroups = [];
      pendingOptionCount = 0;
    }

    pendingGroups.push(group);
    pendingOptionCount += groupOptionCount;
  }

  if (pendingGroups.length > 0) {
    windows.push(createWindow(options.text, pendingGroups, options));
  }

  return windows;
}

function countGroupOptions(group: CandidateGroup): number {
  return group.candidates.reduce(
    (total, candidate) => total + countWikimatchCandidateOptions(candidate),
    0,
  );
}

function createWindow(
  text: string,
  groups: readonly CandidateGroup[],
  options: BuildWikimatchWindowsOptions,
): WikimatchWindow {
  const groupStart = Math.min(...groups.map((group) => group.range.start));
  const groupEnd = Math.max(...groups.map((group) => group.range.end));
  const expandedRange = expandRangeByWords({
    rangeEnd: groupEnd,
    rangeStart: groupStart,
    text,
    words: options.contextWords,
  });

  return {
    baseOffset: expandedRange.start,
    candidates: groups.flatMap((group) => group.candidates),
    groups: groups.map((group, index) => ({
      candidateIds: group.candidates.map((candidate) => candidate.id),
      id: `g${index + 1}`,
      range: group.range,
    })),
    text: text.slice(expandedRange.start, expandedRange.end),
  };
}

function groupOverlappingCandidates(
  candidates: readonly WikimatchCandidate[],
): readonly CandidateGroup[] {
  const groups: CandidateGroup[] = [];
  let current: CandidateGroup | undefined;

  for (const candidate of candidates) {
    if (current === undefined || candidate.range.start >= current.range.end) {
      current = {
        candidates: [candidate],
        range: candidate.range,
      };
      groups.push(current);
      continue;
    }

    current = {
      candidates: [...current.candidates, candidate],
      range: {
        end: Math.max(current.range.end, candidate.range.end),
        start: Math.min(current.range.start, candidate.range.start),
      },
    };
    groups[groups.length - 1] = current;
  }

  return groups;
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

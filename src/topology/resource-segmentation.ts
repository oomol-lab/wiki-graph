import type { SentenceGroupRecord } from "../document/index.js";
import type { SegmentInfo } from "./segment-incision.js";

interface SegmentResource {
  readonly count: number;
  readonly startIncision: number;
  readonly endIncision: number;
  readonly startSentenceIndex: number;
}

export function createSegmentGroups(input: {
  segmentInfos: readonly SegmentInfo[];
  groupWordsCount: number;
  serialId: number;
}): SentenceGroupRecord[] {
  if (input.segmentInfos.length === 0) {
    return [];
  }

  const resources = input.segmentInfos.map(
    (segmentInfo): SegmentResource => ({
      count: segmentInfo.wordsCount,
      endIncision: segmentInfo.endIncision,
      startSentenceIndex: segmentInfo.startSentenceIndex,
      startIncision: segmentInfo.startIncision,
    }),
  );
  const groups = allocateSegmentGroups(resources, input.groupWordsCount);

  return groups.map((startSentenceIndexes, groupId) => ({
    endSentenceIndex: Math.max(...startSentenceIndexes),
    groupId,
    serialId: input.serialId,
    startSentenceIndex: Math.min(...startSentenceIndexes),
  }));
}

function allocateSegmentGroups(
  resources: readonly SegmentResource[],
  maxCount: number,
): number[][] {
  return splitResources(resources, maxCount).map((group) =>
    group.map((resource) => resource.startSentenceIndex),
  );
}

function splitResources(
  resources: readonly SegmentResource[],
  maxCount: number,
): SegmentResource[][] {
  if (resources.length === 0) {
    return [];
  }

  if (maxCount <= 0) {
    return resources.map((resource) => [resource]);
  }

  const totalCount = resources.reduce((total, resource) => {
    return total + resource.count;
  }, 0);

  if (resources.length === 1 || totalCount <= maxCount) {
    return [[...resources]];
  }

  const splitIndex = findPreferredSplitIndex(resources, maxCount);

  if (splitIndex === undefined) {
    return splitGreedily(resources, maxCount);
  }

  const left = resources.slice(0, splitIndex + 1);
  const right = resources.slice(splitIndex + 1);

  if (
    left.length === 0 ||
    right.length === 0 ||
    left.length === resources.length ||
    right.length === resources.length
  ) {
    return splitGreedily(resources, maxCount);
  }

  return [
    ...splitResources(left, maxCount),
    ...splitResources(right, maxCount),
  ];
}

function findPreferredSplitIndex(
  resources: readonly SegmentResource[],
  maxCount: number,
): number | undefined {
  const totalCount = resources.reduce((total, resource) => {
    return total + resource.count;
  }, 0);
  let leftCount = 0;
  let bestIndex: number | undefined;
  let bestBoundary = 0;
  let bestOversizedSides = Number.POSITIVE_INFINITY;
  let bestOverflow = Number.POSITIVE_INFINITY;

  for (let index = 0; index < resources.length - 1; index += 1) {
    const current = resources[index];
    const next = resources[index + 1];

    if (current === undefined || next === undefined) {
      continue;
    }

    leftCount += current.count;
    const rightCount = totalCount - leftCount;
    const boundary = current.endIncision + next.startIncision;

    if (boundary <= 0) {
      continue;
    }

    const oversizedSides =
      Number(leftCount > maxCount) + Number(rightCount > maxCount);
    const overflow =
      Math.max(0, leftCount - maxCount) + Math.max(0, rightCount - maxCount);

    if (
      oversizedSides < bestOversizedSides ||
      (oversizedSides === bestOversizedSides && boundary > bestBoundary) ||
      (oversizedSides === bestOversizedSides &&
        boundary === bestBoundary &&
        overflow < bestOverflow)
    ) {
      bestBoundary = boundary;
      bestIndex = index;
      bestOversizedSides = oversizedSides;
      bestOverflow = overflow;
    }
  }

  return bestIndex;
}

function splitGreedily(
  resources: readonly SegmentResource[],
  maxCount: number,
): SegmentResource[][] {
  const groups: SegmentResource[][] = [];
  let currentGroup: SegmentResource[] = [];
  let currentCount = 0;

  for (const resource of resources) {
    if (currentGroup.length > 0 && currentCount + resource.count > maxCount) {
      groups.push(currentGroup);
      currentGroup = [];
      currentCount = 0;
    }

    currentGroup.push(resource);
    currentCount += resource.count;

    if (currentCount >= maxCount) {
      groups.push(currentGroup);
      currentGroup = [];
      currentCount = 0;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

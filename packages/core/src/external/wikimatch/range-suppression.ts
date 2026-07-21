export interface SuppressContainedRangeInput {
  readonly range: {
    readonly end: number;
    readonly start: number;
  };
}

export function suppressContainedRanges<T extends SuppressContainedRangeInput>(
  items: readonly T[],
): readonly T[] {
  const sorted = [...items]
    .filter((item) => item.range.start < item.range.end)
    .sort(compareByRangeForSuppression);
  const kept: T[] = [];

  for (const item of sorted) {
    if (kept.some((candidate) => containsRange(candidate, item))) {
      continue;
    }

    kept.push(item);
  }

  return kept.sort(compareByOriginalOrder);
}

function compareByRangeForSuppression<T extends SuppressContainedRangeInput>(
  left: T,
  right: T,
): number {
  return (
    left.range.start - right.range.start ||
    right.range.end - left.range.end ||
    rangeLength(right) - rangeLength(left)
  );
}

function compareByOriginalOrder<T extends SuppressContainedRangeInput>(
  left: T,
  right: T,
): number {
  return (
    left.range.start - right.range.start ||
    left.range.end - right.range.end ||
    rangeLength(left) - rangeLength(right)
  );
}

function containsRange<T extends SuppressContainedRangeInput>(
  container: T,
  item: T,
): boolean {
  return (
    container.range.start <= item.range.start &&
    item.range.end <= container.range.end &&
    rangeLength(container) > rangeLength(item)
  );
}

function rangeLength(item: SuppressContainedRangeInput): number {
  return item.range.end - item.range.start;
}

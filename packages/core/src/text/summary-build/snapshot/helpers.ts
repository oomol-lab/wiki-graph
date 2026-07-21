import type {
  ChunkRecord,
  FragmentRecord,
  ReadingEdgeRecord,
  SentenceGroupRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "../../../document/index.js";

export function compareNumber(left: number, right: number): number {
  return left - right;
}

export function createFragmentStartIndexesBySerialId(
  fragments: readonly FragmentRecord[],
): ReadonlyMap<number, readonly number[]> {
  const indexesBySerialId = new Map<number, number[]>();

  for (const fragment of fragments) {
    const indexes = indexesBySerialId.get(fragment.serialId) ?? [];

    indexes.push(fragment.fragmentId);
    indexesBySerialId.set(fragment.serialId, indexes);
  }

  return new Map(
    [...indexesBySerialId.entries()].map(
      ([serialId, indexes]) => [serialId, indexes.sort(compareNumber)] as const,
    ),
  );
}

export function createSegmentRanges(
  allStartIndexes: readonly number[],
  selectedStartIndexes: readonly number[],
): Array<{
  readonly endSentenceIndex: number;
  readonly startSentenceIndex: number;
}> {
  const selected = new Set(selectedStartIndexes);

  return allStartIndexes.flatMap((startSentenceIndex, index) => {
    if (!selected.has(startSentenceIndex)) {
      return [];
    }

    const nextStartSentenceIndex = allStartIndexes[index + 1];

    return [
      {
        endSentenceIndex:
          nextStartSentenceIndex === undefined
            ? Infinity
            : nextStartSentenceIndex - 1,
        startSentenceIndex,
      },
    ];
  });
}

export function compareChunkById(
  left: ChunkRecord,
  right: ChunkRecord,
): number {
  return left.id - right.id;
}

export function compareFragmentGroup(
  left: SentenceGroupRecord,
  right: SentenceGroupRecord,
): number {
  return (
    left.serialId - right.serialId ||
    left.groupId - right.groupId ||
    left.startSentenceIndex - right.startSentenceIndex ||
    left.endSentenceIndex - right.endSentenceIndex
  );
}

export function compareReadingEdge(
  left: ReadingEdgeRecord,
  right: ReadingEdgeRecord,
): number {
  return left.fromId - right.fromId || left.toId - right.toId;
}

export function comparePair(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return left[0] - right[0] || left[1] - right[1];
}

export function compareSnake(left: SnakeRecord, right: SnakeRecord): number {
  return left.groupId - right.groupId || left.id - right.id;
}

export function compareSnakeChunk(
  left: SnakeChunkRecord,
  right: SnakeChunkRecord,
): number {
  return left.snakeId - right.snakeId || left.position - right.position;
}

export function compareSnakeEdge(
  left: SnakeEdgeRecord,
  right: SnakeEdgeRecord,
): number {
  return (
    left.fromSnakeId - right.fromSnakeId || left.toSnakeId - right.toSnakeId
  );
}

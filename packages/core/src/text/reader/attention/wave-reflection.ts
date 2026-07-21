import type { CognitiveChunk } from "../chunk-batch/types.js";

export class WaveReflection {
  readonly #generationDecayFactor: number;

  public constructor(generationDecayFactor: number) {
    this.#generationDecayFactor = generationDecayFactor;
  }

  public selectTopChunks(input: {
    allChunks: readonly CognitiveChunk[];
    capacity: number;
    getSuccessorChunkIds: (chunkId: number) => readonly number[];
    latestChunkIds: readonly number[];
  }): CognitiveChunk[] {
    if (input.allChunks.length === 0) {
      return [];
    }

    if (input.latestChunkIds.length === 0) {
      return [...input.allChunks].slice(0, input.capacity);
    }

    const latestChunkIdRecord = createMembershipRecord(input.latestChunkIds);
    const historicalChunks = input.allChunks.filter(
      (chunk) => !hasMembership(latestChunkIdRecord, chunk.id),
    );

    if (historicalChunks.length === 0) {
      return [];
    }

    const forwardScores = this.#forwardPropagation({
      getSuccessorChunkIds: input.getSuccessorChunkIds,
      latestChunkIds: input.latestChunkIds,
    });

    if (countOwnKeys(forwardScores) === 0) {
      return [...historicalChunks]
        .sort((left, right) => right.generation - left.generation)
        .slice(0, input.capacity);
    }

    const reflectionScores = this.#reflectionPropagation({
      allChunkIds: input.allChunks.map((chunk) => chunk.id),
      forwardScores,
      getSuccessorChunkIds: input.getSuccessorChunkIds,
    });

    return historicalChunks
      .map((chunk) => ({
        chunk,
        decayedScore:
          (reflectionScores[String(chunk.id)] ?? 0) *
          this.#generationDecayFactor ** chunk.generation,
      }))
      .sort((left, right) => {
        if (left.decayedScore !== right.decayedScore) {
          return right.decayedScore - left.decayedScore;
        }

        return left.chunk.id - right.chunk.id;
      })
      .slice(0, input.capacity)
      .map((item) => item.chunk);
  }

  #forwardPropagation(input: {
    getSuccessorChunkIds: (chunkId: number) => readonly number[];
    latestChunkIds: readonly number[];
  }): Record<string, number> {
    const latestChunkCount = input.latestChunkIds.length;

    if (latestChunkCount === 0) {
      return createEmptyRecord<number>();
    }

    const initialScore = 1 / latestChunkCount;
    const scores = createEmptyRecord<number>();
    const visited = createEmptyRecord<true>();
    const queue = [...input.latestChunkIds];
    let queueOffset = 0;

    for (const chunkId of input.latestChunkIds) {
      scores[String(chunkId)] = initialScore;
      visited[String(chunkId)] = true;
    }

    while (queueOffset < queue.length) {
      const currentId = queue[queueOffset];
      queueOffset += 1;

      if (currentId === undefined) {
        continue;
      }

      const currentScore = scores[String(currentId)];

      if (currentScore === undefined) {
        continue;
      }

      const successors = [...input.getSuccessorChunkIds(currentId)].sort(
        compareNumber,
      );

      if (successors.length === 0) {
        continue;
      }

      const scorePerSuccessor = currentScore / successors.length;

      for (const successorId of successors) {
        const successorKey = String(successorId);
        scores[successorKey] = (scores[successorKey] ?? 0) + scorePerSuccessor;

        if (hasMembership(visited, successorId)) {
          continue;
        }

        visited[successorKey] = true;
        queue.push(successorId);
      }
    }

    return scores;
  }

  #reflectionPropagation(input: {
    allChunkIds: readonly number[];
    forwardScores: Readonly<Record<string, number>>;
    getSuccessorChunkIds: (chunkId: number) => readonly number[];
  }): Record<string, number> {
    const reverseSuccessorIdsByChunkId = createEmptyRecord<number[]>();

    for (const chunkId of input.allChunkIds) {
      for (const successorId of input.getSuccessorChunkIds(chunkId)) {
        const successorKey = String(successorId);
        const reverseSuccessors =
          reverseSuccessorIdsByChunkId[successorKey] ?? [];

        reverseSuccessorIdsByChunkId[successorKey] = [
          ...reverseSuccessors,
          chunkId,
        ];
      }
    }

    const reflectionScores = { ...input.forwardScores };
    const queue = Object.keys(input.forwardScores).map(Number);
    const visited = createMembershipRecord(queue);
    let queueOffset = 0;

    while (queueOffset < queue.length) {
      const currentId = queue[queueOffset];
      queueOffset += 1;

      if (currentId === undefined) {
        continue;
      }

      const currentScore = reflectionScores[String(currentId)];

      if (currentScore === undefined) {
        continue;
      }

      const successors = [
        ...(reverseSuccessorIdsByChunkId[String(currentId)] ?? []),
      ].sort(compareNumber);

      if (successors.length === 0) {
        continue;
      }

      const scorePerSuccessor = currentScore / successors.length;

      for (const successorId of successors) {
        const successorKey = String(successorId);

        reflectionScores[successorKey] =
          (reflectionScores[successorKey] ?? 0) + scorePerSuccessor;

        if (hasMembership(visited, successorId)) {
          continue;
        }

        visited[successorKey] = true;
        queue.push(successorId);
      }
    }

    return reflectionScores;
  }
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function createMembershipRecord(
  values: readonly number[],
): Record<string, true> {
  const record = createEmptyRecord<true>();

  for (const value of values) {
    record[String(value)] = true;
  }

  return record;
}

function hasMembership(
  record: Readonly<Record<string, true>>,
  value: number,
): boolean {
  return Object.hasOwn(record, String(value));
}

function countOwnKeys(record: Readonly<Record<string, unknown>>): number {
  return Object.keys(record).length;
}

function createEmptyRecord<TValue>(): Record<string, TValue> {
  return Object.create(null) as Record<string, TValue>;
}

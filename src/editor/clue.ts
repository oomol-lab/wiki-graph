import type {
  ChunkRecord,
  ReadonlyDocument,
  SnakeRecord,
} from "../document/index.js";

interface Clue {
  readonly clueId: number;
  readonly chunks: readonly ChunkRecord[];
  readonly isMerged: boolean;
  readonly label: string;
  readonly sourceSnakeIds: readonly number[];
  readonly weight: number;
}

export async function extractCluesFromDocument(input: {
  groupId: number;
  maxClues: number;
  serialId: number;
  document: ReadonlyDocument;
}): Promise<readonly Clue[]> {
  const snakeIds = await input.document.snakes.listIdsByGroup(
    input.serialId,
    input.groupId,
  );
  const snakes = await Promise.all(
    snakeIds.map(
      async (snakeId) => await input.document.snakes.getById(snakeId),
    ),
  );
  const clues = await Promise.all(
    snakes
      .filter((snake): snake is SnakeRecord => snake !== undefined)
      .map(async (snake) => await convertSnakeToClue(snake, input.document)),
  );

  if (clues.length <= input.maxClues) {
    return normalizeClueWeights(clues);
  }

  let currentClues = [...clues];
  let mergedClueId = -1;

  while (currentClues.length > input.maxClues) {
    currentClues.sort(compareClueByWeightDescending);

    const cutoffRank = Math.floor(input.maxClues * 0.75);
    const candidates = currentClues.slice(cutoffRank);

    if (candidates.length < 2) {
      break;
    }

    const pair = findBestMergePair(candidates);
    const [leftClue, rightClue] =
      pair ?? [...currentClues].sort(compareClueByWeightAscending).slice(0, 2);

    if (leftClue === undefined || rightClue === undefined) {
      break;
    }

    currentClues = currentClues.filter(
      (clue) => clue !== leftClue && clue !== rightClue,
    );
    currentClues.push(mergeClues(leftClue, rightClue, mergedClueId));
    mergedClueId -= 1;
  }

  return normalizeClueWeights(currentClues);
}

function calculateFragmentReduction(leftClue: Clue, rightClue: Clue): number {
  const leftFragmentIds = collectFragmentIds(leftClue.chunks);
  const rightFragmentIds = collectFragmentIds(rightClue.chunks);
  const mergedFragmentIds = Object.create(null) as Record<string, true>;
  let mergedCount = 0;

  for (const fragmentId of leftFragmentIds) {
    mergedFragmentIds[String(fragmentId)] = true;
    mergedCount += 1;
  }

  for (const fragmentId of rightFragmentIds) {
    const fragmentKey = String(fragmentId);

    if (mergedFragmentIds[fragmentKey] === true) {
      continue;
    }

    mergedFragmentIds[fragmentKey] = true;
    mergedCount += 1;
  }

  return leftFragmentIds.length + rightFragmentIds.length - mergedCount;
}

function collectFragmentIds(chunks: readonly ChunkRecord[]): number[] {
  const fragmentIdRecord = Object.create(null) as Record<string, true>;
  const fragmentIds: number[] = [];

  for (const chunk of chunks) {
    for (const sentenceId of chunk.sentenceIds) {
      const fragmentId = sentenceId[1];
      const fragmentKey = String(fragmentId);

      if (fragmentIdRecord[fragmentKey] === true) {
        continue;
      }

      fragmentIdRecord[fragmentKey] = true;
      fragmentIds.push(fragmentId);
    }
  }

  fragmentIds.sort(compareNumber);

  return fragmentIds;
}

function compareClueByWeightAscending(left: Clue, right: Clue): number {
  return left.weight - right.weight;
}

function compareClueByWeightDescending(left: Clue, right: Clue): number {
  return right.weight - left.weight;
}

function compareChunkBySentenceId(
  left: ChunkRecord,
  right: ChunkRecord,
): number {
  const [leftSerialId, leftSentenceIndex] = left.sentenceId;
  const [rightSerialId, rightSentenceIndex] = right.sentenceId;

  if (leftSerialId !== rightSerialId) {
    return leftSerialId - rightSerialId;
  }

  return leftSentenceIndex - rightSentenceIndex;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

async function convertSnakeToClue(
  snake: SnakeRecord,
  document: ReadonlyDocument,
): Promise<Clue> {
  const chunkIds = await document.snakeChunks.listChunkIds(snake.id);
  const chunks = (
    await Promise.all(
      chunkIds.map(async (chunkId) => await document.chunks.getById(chunkId)),
    )
  ).filter((chunk): chunk is ChunkRecord => chunk !== undefined);

  return {
    clueId: snake.id,
    chunks,
    isMerged: false,
    label: `${snake.firstLabel} -> ${snake.lastLabel}`,
    sourceSnakeIds: [snake.id],
    weight: snake.weight,
  };
}

function findBestMergePair(
  clues: readonly Clue[],
): readonly [Clue, Clue] | undefined {
  let bestPair: [Clue, Clue] | undefined;
  let bestReduction = -1;

  for (let leftIndex = 0; leftIndex < clues.length; leftIndex += 1) {
    const leftClue = clues[leftIndex];

    if (leftClue === undefined) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < clues.length;
      rightIndex += 1
    ) {
      const rightClue = clues[rightIndex];

      if (rightClue === undefined) {
        continue;
      }

      const reduction = calculateFragmentReduction(leftClue, rightClue);

      if (reduction <= bestReduction) {
        continue;
      }

      bestReduction = reduction;
      bestPair = [leftClue, rightClue];
    }
  }

  return bestPair;
}

function mergeClues(leftClue: Clue, rightClue: Clue, clueId: number): Clue {
  const sourceSnakeIds = [
    ...leftClue.sourceSnakeIds,
    ...rightClue.sourceSnakeIds,
  ].sort(compareNumber);
  const chunks = [...leftClue.chunks, ...rightClue.chunks].sort(
    compareChunkBySentenceId,
  );

  return {
    clueId,
    chunks,
    isMerged: true,
    label: `Merged minor clues (${sourceSnakeIds.length})`,
    sourceSnakeIds,
    weight: leftClue.weight + rightClue.weight,
  };
}

function normalizeClueWeights(clues: readonly Clue[]): readonly Clue[] {
  const totalWeight = clues.reduce((sum, clue) => sum + clue.weight, 0);
  const normalizedClues = clues.map((clue) => ({
    ...clue,
    weight: totalWeight === 0 ? 0 : clue.weight / totalWeight,
  }));

  normalizedClues.sort(compareClueByWeightDescending);

  return normalizedClues;
}

export type { Clue };

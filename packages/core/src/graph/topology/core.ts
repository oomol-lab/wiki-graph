import type {
  ChunkRecord,
  Document,
  ReadingEdgeRecord,
  SentenceGroupRecord,
} from "../../document/index.js";
import type { ReaderChunk, ReaderGraphDelta } from "../../text/reader/index.js";
import { groupSegments } from "./grouping.js";
import {
  buildSnakeGraph,
  detectSnakesInComponent,
  splitConnectedComponents,
} from "./snake/index.js";
import {
  computeChunkWeights,
  computeReadingEdgeWeights,
  getReadingEdgeKey,
} from "./weights.js";

const DEFAULT_SNAKE_WORDS_COUNT = 280;

export class Topology {
  readonly #chunkIds: number[] = [];
  readonly #chunksById = createChunkRecord();
  readonly #document: Document;
  readonly #edgeKeys: string[] = [];
  readonly #edgesByKey = createEdgeRecord();
  readonly #groupWordsCount: number;
  readonly #serialId: number;

  public constructor(
    document: Document,
    serialId: number,
    groupWordsCount: number,
  ) {
    this.#document = document;
    this.#groupWordsCount = groupWordsCount;
    this.#serialId = serialId;
  }

  public accept(delta: ReaderGraphDelta): void {
    for (const chunk of delta.chunks) {
      this.#saveChunk(chunk);
    }

    if (delta.importanceAnnotations !== undefined) {
      for (const annotation of delta.importanceAnnotations) {
        const chunk = this.#chunksById[String(annotation.chunkId)];

        if (chunk === undefined) {
          continue;
        }

        this.#chunksById[String(annotation.chunkId)] = {
          ...chunk,
          importance: annotation.importance,
        };
      }
    }

    for (const edge of delta.edges) {
      this.#saveEdge(edge);
    }
  }

  public async finalize(): Promise<void> {
    const chunks = this.#listChunks();
    const edges = this.#listEdges();
    const chunkWeights = computeChunkWeights(chunks);
    const edgeWeights = computeReadingEdgeWeights({
      chunkWeights,
      edges,
    });
    const weightedChunks = chunks.map((chunk) => ({
      ...chunk,
      weight: chunkWeights[String(chunk.id)] ?? 0,
    }));
    const weightedEdges = edges.map((edge) => ({
      ...edge,
      weight: edgeWeights[getReadingEdgeKey(edge.fromId, edge.toId)] ?? 0,
    }));
    const sentenceGroups = await groupSegments({
      chunks: weightedChunks,
      edges: weightedEdges,
      fragments: this.#document.getSerialFragments(this.#serialId),
      groupWordsCount: this.#groupWordsCount,
      serialId: this.#serialId,
    });
    const snakeTopology = buildSnakeTopology({
      chunks: weightedChunks,
      edges: weightedEdges,
      sentenceGroups,
      serialId: this.#serialId,
    });

    await this.#document.serials.ensure(this.#serialId);

    const chunkIdMap = new Map<number, number>();

    for (const chunk of weightedChunks) {
      const createdChunk = await this.#document.chunks.create({
        content: chunk.content,
        generation: chunk.generation,
        label: chunk.label,
        sentenceId: chunk.sentenceId,
        sentenceIds: chunk.sentenceIds,
        weight: chunk.weight,
        wordsCount: chunk.wordsCount,
        ...(chunk.importance === undefined
          ? {}
          : { importance: chunk.importance }),
        ...(chunk.retention === undefined
          ? {}
          : { retention: chunk.retention }),
      });

      chunkIdMap.set(chunk.id, createdChunk.id);
    }

    for (const edge of weightedEdges) {
      const fromId = chunkIdMap.get(edge.fromId);
      const toId = chunkIdMap.get(edge.toId);

      if (fromId === undefined || toId === undefined) {
        continue;
      }

      await this.#document.readingEdges.save({
        ...edge,
        fromId,
        toId,
      });
    }

    await this.#document.fragmentGroups.saveMany(sentenceGroups);

    const snakeIds: number[] = [];

    for (const snake of snakeTopology.snakes) {
      snakeIds.push(
        await this.#document.snakes.create({
          firstLabel: snake.firstLabel,
          groupId: snake.groupId,
          lastLabel: snake.lastLabel,
          localSnakeId: snake.localSnakeId,
          serialId: this.#serialId,
          size: snake.size,
          weight: snake.weight,
          wordsCount: snake.wordsCount,
        }),
      );
    }

    for (const snakeChunk of snakeTopology.snakeChunks) {
      const snakeId = snakeIds[snakeChunk.snakeIndex];

      if (snakeId === undefined) {
        continue;
      }

      await this.#document.snakeChunks.save({
        chunkId: chunkIdMap.get(snakeChunk.chunkId) ?? snakeChunk.chunkId,
        position: snakeChunk.position,
        snakeId,
      });
    }

    for (const snakeEdge of snakeTopology.snakeEdges) {
      const fromSnakeId = snakeIds[snakeEdge.fromSnakeIndex];
      const toSnakeId = snakeIds[snakeEdge.toSnakeIndex];

      if (fromSnakeId === undefined || toSnakeId === undefined) {
        continue;
      }

      await this.#document.snakeEdges.save({
        fromSnakeId,
        toSnakeId,
        weight: snakeEdge.weight,
      });
    }
  }

  #listChunks(): ChunkRecord[] {
    return [...this.#chunkIds]
      .sort(compareNumber)
      .map((chunkId) => this.#chunksById[String(chunkId)])
      .filter((chunk): chunk is ChunkRecord => chunk !== undefined);
  }

  #listEdges(): ReadingEdgeRecord[] {
    return [...this.#edgeKeys]
      .sort(compareEdgeKey)
      .map((edgeKey) => this.#edgesByKey[edgeKey])
      .filter((edge): edge is ReadingEdgeRecord => edge !== undefined);
  }

  #saveChunk(chunk: ReaderChunk): void {
    const chunkId = String(chunk.id);

    if (this.#chunksById[chunkId] === undefined) {
      this.#chunkIds.push(chunk.id);
    }

    const importance = chunk.importance;
    const retention = chunk.retention;

    this.#chunksById[chunkId] = {
      content: chunk.content,
      generation: chunk.generation,
      id: chunk.id,
      label: chunk.label,
      sentenceId: chunk.sentenceId,
      sentenceIds: [...chunk.sentenceIds],
      wordsCount: chunk.wordsCount,
      weight: 0,
      ...(importance === undefined ? {} : { importance }),
      ...(retention === undefined ? {} : { retention }),
    };
  }

  #saveEdge(edge: ReaderGraphDelta["edges"][number]): void {
    const edgeKey = getReadingEdgeKey(edge.fromId, edge.toId);

    if (this.#edgesByKey[edgeKey] === undefined) {
      this.#edgeKeys.push(edgeKey);
    }

    const strength = edge.strength;

    this.#edgesByKey[edgeKey] = {
      fromId: edge.fromId,
      toId: edge.toId,
      weight: 0,
      ...(strength === undefined ? {} : { strength }),
    };
  }
}

function compareEdgeKey(left: string, right: string): number {
  const [leftFromIdText = "", leftToIdText = ""] = left.split(":");
  const [rightFromIdText = "", rightToIdText = ""] = right.split(":");
  const leftFromId = Number(leftFromIdText);
  const rightFromId = Number(rightFromIdText);

  if (leftFromId !== rightFromId) {
    return leftFromId - rightFromId;
  }

  return Number(leftToIdText) - Number(rightToIdText);
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function createChunkRecord(): Record<string, ChunkRecord | undefined> {
  return Object.create(null) as Record<string, ChunkRecord | undefined>;
}

function createEdgeRecord(): Record<string, ReadingEdgeRecord | undefined> {
  return Object.create(null) as Record<string, ReadingEdgeRecord | undefined>;
}

interface SnakeDraft {
  readonly firstLabel: string;
  readonly groupId: number;
  readonly lastLabel: string;
  readonly localSnakeId: number;
  readonly size: number;
  readonly weight: number;
  readonly wordsCount: number;
}

interface SnakeChunkDraft {
  readonly chunkId: number;
  readonly position: number;
  readonly snakeIndex: number;
}

interface SnakeEdgeDraft {
  readonly fromSnakeIndex: number;
  readonly toSnakeIndex: number;
  readonly weight: number;
}

function buildSnakeTopology(input: {
  chunks: readonly ChunkRecord[];
  edges: readonly ReadingEdgeRecord[];
  sentenceGroups: readonly SentenceGroupRecord[];
  serialId: number;
}): {
  readonly snakeChunks: readonly SnakeChunkDraft[];
  readonly snakeEdges: readonly SnakeEdgeDraft[];
  readonly snakes: readonly SnakeDraft[];
} {
  const chunksById = createChunkRecord();
  const chunkIdsByGroupId = createNumberListRecord();
  const edgesByGroupId = createReadingEdgeListRecord();
  const sentenceRangesByGroupId: Array<{
    readonly endSentenceIndex: number;
    readonly groupId: number;
    readonly startSentenceIndex: number;
  }> = [];

  for (const sentenceGroup of input.sentenceGroups) {
    if (sentenceGroup.serialId !== input.serialId) {
      continue;
    }

    sentenceRangesByGroupId.push(sentenceGroup);
  }

  for (const chunk of input.chunks) {
    const groupId = findSentenceGroupId(
      sentenceRangesByGroupId,
      chunk.sentenceId[1],
    );

    chunksById[String(chunk.id)] = chunk;
    if (groupId === undefined) {
      continue;
    }
    if (chunkIdsByGroupId[String(groupId)] === undefined) {
      chunkIdsByGroupId[String(groupId)] = [];
    }
    chunkIdsByGroupId[String(groupId)]?.push(chunk.id);
  }

  for (const edge of input.edges) {
    const fromChunk = chunksById[String(edge.fromId)];
    const toChunk = chunksById[String(edge.toId)];

    if (fromChunk === undefined || toChunk === undefined) {
      continue;
    }

    const fromGroupId = findSentenceGroupId(
      sentenceRangesByGroupId,
      fromChunk.sentenceId[1],
    );
    const toGroupId = findSentenceGroupId(
      sentenceRangesByGroupId,
      toChunk.sentenceId[1],
    );

    if (fromGroupId === undefined || toGroupId === undefined) {
      continue;
    }
    if (fromGroupId !== toGroupId) {
      continue;
    }
    if (edgesByGroupId[String(fromGroupId)] === undefined) {
      edgesByGroupId[String(fromGroupId)] = [];
    }

    edgesByGroupId[String(fromGroupId)]?.push(edge);
  }

  const snakes: SnakeDraft[] = [];
  const snakeChunks: SnakeChunkDraft[] = [];
  const snakeEdges: SnakeEdgeDraft[] = [];

  for (const groupId of listSortedRecordNumbers(chunkIdsByGroupId)) {
    const groupChunkIds = [...(chunkIdsByGroupId[String(groupId)] ?? [])].sort(
      compareNumber,
    );
    const groupEdges = edgesByGroupId[String(groupId)] ?? [];
    const groupSnakeChunkIds: number[][] = [];

    for (const componentChunkIds of splitConnectedComponents({
      chunkIds: groupChunkIds,
      edges: groupEdges,
    })) {
      const componentChunkIdRecord = createBooleanRecord();

      for (const chunkId of componentChunkIds) {
        componentChunkIdRecord[String(chunkId)] = true;
      }

      groupSnakeChunkIds.push(
        ...detectSnakesInComponent({
          chunks: componentChunkIds
            .map((chunkId) => chunksById[String(chunkId)])
            .filter((chunk): chunk is ChunkRecord => chunk !== undefined),
          edges: groupEdges.filter(
            (edge) =>
              componentChunkIdRecord[String(edge.fromId)] === true &&
              componentChunkIdRecord[String(edge.toId)] === true,
          ),
          snakeWordsCount: DEFAULT_SNAKE_WORDS_COUNT,
        }),
      );
    }

    const snakeStartIndex = snakes.length;

    for (const [localSnakeId, snakeChunkIds] of groupSnakeChunkIds.entries()) {
      const firstChunkId = snakeChunkIds[0];
      const lastChunkId = snakeChunkIds[snakeChunkIds.length - 1];
      const firstChunk =
        firstChunkId === undefined
          ? undefined
          : chunksById[String(firstChunkId)];
      const lastChunk =
        lastChunkId === undefined ? undefined : chunksById[String(lastChunkId)];

      if (firstChunk === undefined || lastChunk === undefined) {
        continue;
      }

      const snakeIndex = snakeStartIndex + localSnakeId;

      snakes.push({
        firstLabel: firstChunk.label,
        groupId,
        lastLabel: lastChunk.label,
        localSnakeId,
        size: snakeChunkIds.length,
        weight: snakeChunkIds.reduce((sum, chunkId) => {
          return sum + (chunksById[String(chunkId)]?.weight ?? 0);
        }, 0),
        wordsCount: snakeChunkIds.reduce((sum, chunkId) => {
          return sum + (chunksById[String(chunkId)]?.wordsCount ?? 0);
        }, 0),
      });

      for (const [position, chunkId] of snakeChunkIds.entries()) {
        snakeChunks.push({
          chunkId,
          position,
          snakeIndex,
        });
      }
    }

    snakeEdges.push(
      ...buildSnakeGraph({
        chunksById,
        edges: groupEdges,
        snakes: groupSnakeChunkIds,
      }).map((edge) => ({
        fromSnakeIndex: snakeStartIndex + edge.fromSnakeIndex,
        toSnakeIndex: snakeStartIndex + edge.toSnakeIndex,
        weight: edge.weight,
      })),
    );
  }

  return {
    snakeChunks,
    snakeEdges,
    snakes,
  };
}

function findSentenceGroupId(
  groups: readonly {
    readonly endSentenceIndex: number;
    readonly groupId: number;
    readonly startSentenceIndex: number;
  }[],
  sentenceIndex: number,
): number | undefined {
  return groups.find(
    (group) =>
      sentenceIndex >= group.startSentenceIndex &&
      sentenceIndex <= group.endSentenceIndex,
  )?.groupId;
}

function createBooleanRecord(): Record<string, boolean | undefined> {
  return Object.create(null) as Record<string, boolean | undefined>;
}

function createNumberListRecord(): Record<string, number[] | undefined> {
  return Object.create(null) as Record<string, number[] | undefined>;
}

function createReadingEdgeListRecord(): Record<
  string,
  ReadingEdgeRecord[] | undefined
> {
  return Object.create(null) as Record<string, ReadingEdgeRecord[] | undefined>;
}

function listSortedRecordNumbers(
  record: Readonly<Record<string, number[] | undefined>>,
): number[] {
  return Object.keys(record).map(Number).sort(compareNumber);
}

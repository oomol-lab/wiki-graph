import type {
  ChunkRecord,
  ReadingEdgeRecord,
  ReadonlyFragmentGroupStore,
  ReadonlyReadingEdgeStore,
  ReadonlySnakeChunkStore,
  ReadonlySnakeEdgeStore,
  ReadonlySnakeStore,
  SentenceGroupRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "../../../document/index.js";
import {
  compareFragmentGroup,
  compareNumber,
  compareReadingEdge,
  compareSnake,
  compareSnakeChunk,
  compareSnakeEdge,
} from "./helpers.js";

export class SnapshotReadingEdgeStore implements ReadonlyReadingEdgeStore {
  readonly #edges: readonly ReadingEdgeRecord[];
  readonly #serialIdByChunkId: Map<number, number>;

  public constructor(
    edges: readonly ReadingEdgeRecord[],
    chunks: readonly ChunkRecord[],
  ) {
    this.#edges = [...edges].sort(compareReadingEdge);
    this.#serialIdByChunkId = new Map(
      chunks.map((chunk) => [chunk.id, chunk.sentenceId[0]]),
    );
  }

  public listAll(): Promise<ReadingEdgeRecord[]> {
    return Promise.resolve([...this.#edges]);
  }

  public countAll(): Promise<number> {
    return Promise.resolve(this.#edges.length);
  }

  public listBySerial(serialId: number): Promise<ReadingEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter(
        (edge) =>
          this.#serialIdByChunkId.get(edge.fromId) === serialId &&
          this.#serialIdByChunkId.get(edge.toId) === serialId,
      ),
    );
  }

  public listIncoming(chunkId: number): Promise<ReadingEdgeRecord[]> {
    return Promise.resolve(this.#edges.filter((edge) => edge.toId === chunkId));
  }

  public listOutgoing(chunkId: number): Promise<ReadingEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter((edge) => edge.fromId === chunkId),
    );
  }
}

export class SnapshotSnakeStore implements ReadonlySnakeStore {
  readonly #snakes: readonly SnakeRecord[];
  readonly #snakesById: Map<number, SnakeRecord>;

  public constructor(snakes: readonly SnakeRecord[]) {
    this.#snakes = [...snakes].sort(compareSnake);
    this.#snakesById = new Map(snakes.map((snake) => [snake.id, snake]));
  }

  public getById(snakeId: number): Promise<SnakeRecord | undefined> {
    return Promise.resolve(this.#snakesById.get(snakeId));
  }

  public listIdsByGroup(serialId: number, groupId: number): Promise<number[]> {
    return Promise.resolve(
      this.#snakes
        .filter(
          (snake) => snake.serialId === serialId && snake.groupId === groupId,
        )
        .map((snake) => snake.id)
        .sort(compareNumber),
    );
  }

  public listBySerial(serialId: number): Promise<SnakeRecord[]> {
    return Promise.resolve(
      this.#snakes.filter((snake) => snake.serialId === serialId),
    );
  }
}

export class SnapshotSnakeChunkStore implements ReadonlySnakeChunkStore {
  readonly #snakeChunks: readonly SnakeChunkRecord[];

  public constructor(snakeChunks: readonly SnakeChunkRecord[]) {
    this.#snakeChunks = [...snakeChunks].sort(compareSnakeChunk);
  }

  public listChunkIds(snakeId: number): Promise<number[]> {
    return Promise.resolve(
      this.#snakeChunks
        .filter((snakeChunk) => snakeChunk.snakeId === snakeId)
        .map((snakeChunk) => snakeChunk.chunkId),
    );
  }

  public listBySnake(snakeId: number): Promise<SnakeChunkRecord[]> {
    return Promise.resolve(
      this.#snakeChunks.filter((snakeChunk) => snakeChunk.snakeId === snakeId),
    );
  }
}

export class SnapshotSnakeEdgeStore implements ReadonlySnakeEdgeStore {
  readonly #edges: readonly SnakeEdgeRecord[];
  readonly #serialIdBySnakeId: Map<number, number>;

  public constructor(
    edges: readonly SnakeEdgeRecord[],
    snakes: readonly SnakeRecord[],
  ) {
    this.#edges = [...edges].sort(compareSnakeEdge);
    this.#serialIdBySnakeId = new Map(
      snakes.map((snake) => [snake.id, snake.serialId]),
    );
  }

  public listIncoming(snakeId: number): Promise<SnakeEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter((edge) => edge.toSnakeId === snakeId),
    );
  }

  public listOutgoing(snakeId: number): Promise<SnakeEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter((edge) => edge.fromSnakeId === snakeId),
    );
  }

  public listWithin(snakeIds: readonly number[]): Promise<SnakeEdgeRecord[]> {
    const snakeIdSet = new Set(snakeIds);

    return Promise.resolve(
      this.#edges.filter(
        (edge) =>
          snakeIdSet.has(edge.fromSnakeId) && snakeIdSet.has(edge.toSnakeId),
      ),
    );
  }

  public listBySerial(serialId: number): Promise<SnakeEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter(
        (edge) =>
          this.#serialIdBySnakeId.get(edge.fromSnakeId) === serialId &&
          this.#serialIdBySnakeId.get(edge.toSnakeId) === serialId,
      ),
    );
  }
}

export class SnapshotFragmentGroupStore implements ReadonlyFragmentGroupStore {
  readonly #groups: readonly SentenceGroupRecord[];

  public constructor(groups: readonly SentenceGroupRecord[]) {
    this.#groups = [...groups].sort(compareFragmentGroup);
  }

  public listBySerial(serialId: number): Promise<SentenceGroupRecord[]> {
    return Promise.resolve(
      this.#groups.filter((group) => group.serialId === serialId),
    );
  }

  public listSerialIds(): Promise<number[]> {
    return Promise.resolve(
      [...new Set(this.#groups.map((group) => group.serialId))].sort(
        compareNumber,
      ),
    );
  }

  public listGroupIdsForSerial(serialId: number): Promise<number[]> {
    return Promise.resolve(
      [
        ...new Set(
          this.#groups
            .filter((group) => group.serialId === serialId)
            .map((group) => group.groupId),
        ),
      ].sort(compareNumber),
    );
  }
}

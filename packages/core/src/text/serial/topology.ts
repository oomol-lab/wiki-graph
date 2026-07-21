import type {
  ChunkRecord,
  ReadingEdgeRecord,
  ReadonlyChunkStore,
  ReadonlyDocument,
  ReadonlyFragmentGroupStore,
  ReadonlyReadingEdgeStore,
  ReadonlySnakeChunkStore,
  ReadonlySnakeEdgeStore,
  ReadonlySnakeStore,
  SentenceGroupRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "../../document/index.js";

export class Serial {
  readonly #id: number;
  readonly #summary: string;
  readonly #topology: SerialTopology;

  public constructor(
    document: ReadonlyDocument,
    serialId: number,
    summary: string,
  ) {
    this.#id = serialId;
    this.#summary = summary;
    this.#topology = new SerialTopology(document, serialId);
  }

  public get id(): number {
    return this.#id;
  }

  public getSummary(): string {
    return this.#summary;
  }

  public getTopology(): SerialTopology {
    return this.#topology;
  }
}

export class SerialTopology {
  readonly #chunks: ReadonlyChunkStore;
  readonly #fragmentGroups: ReadonlyFragmentGroupStore;
  readonly #readingEdges: ReadonlyReadingEdgeStore;
  readonly #serialId: number;
  readonly #snakeChunks: ReadonlySnakeChunkStore;
  readonly #snakeEdges: ReadonlySnakeEdgeStore;
  readonly #snakes: ReadonlySnakeStore;

  public constructor(document: ReadonlyDocument, serialId: number) {
    this.#chunks = document.chunks;
    this.#fragmentGroups = document.fragmentGroups;
    this.#readingEdges = document.readingEdges;
    this.#serialId = serialId;
    this.#snakeChunks = document.snakeChunks;
    this.#snakeEdges = document.snakeEdges;
    this.#snakes = document.snakes;
  }

  public async listChunks(): Promise<readonly ChunkRecord[]> {
    return await this.#chunks.listBySerial(this.#serialId);
  }

  public async listEdges(): Promise<readonly ReadingEdgeRecord[]> {
    return await this.#readingEdges.listBySerial(this.#serialId);
  }

  public async listGroups(): Promise<readonly SentenceGroupRecord[]> {
    return await this.#fragmentGroups.listBySerial(this.#serialId);
  }

  public async listSnakeChunks(
    snakeId: number,
  ): Promise<readonly SnakeChunkRecord[]> {
    const snake = await this.#snakes.getById(snakeId);
    if (snake === undefined || snake.serialId !== this.#serialId) {
      throw new Error(`Snake ${snakeId} does not belong to this serial`);
    }
    return await this.#snakeChunks.listBySnake(snakeId);
  }

  public async listSnakeEdges(): Promise<readonly SnakeEdgeRecord[]> {
    return await this.#snakeEdges.listBySerial(this.#serialId);
  }

  public async listSnakes(): Promise<readonly SnakeRecord[]> {
    return await this.#snakes.listBySerial(this.#serialId);
  }
}

import { getNumber } from "../database.js";
import type { Database } from "../database.js";
import type { SnakeChunkRecord } from "../types.js";
import type { ReadonlySnakeChunkStore } from "./types.js";

export class SnakeChunkStore implements ReadonlySnakeChunkStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: SnakeChunkRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO snake_chunks (snake_id, chunk_id, position)
        VALUES (?, ?, ?)
      `,
      [record.snakeId, record.chunkId, record.position],
    );
  }

  public async listChunkIds(snakeId: number): Promise<number[]> {
    return await this.#database.queryAll(
      `
        SELECT chunk_id
        FROM snake_chunks
        WHERE snake_id = ?
        ORDER BY position
      `,
      [snakeId],
      (row) => getNumber(row, "chunk_id"),
    );
  }

  public async listBySnake(snakeId: number): Promise<SnakeChunkRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT snake_id, chunk_id, position
        FROM snake_chunks
        WHERE snake_id = ?
        ORDER BY position
      `,
      [snakeId],
      (row) => ({
        chunkId: getNumber(row, "chunk_id"),
        position: getNumber(row, "position"),
        snakeId: getNumber(row, "snake_id"),
      }),
    );
  }
}

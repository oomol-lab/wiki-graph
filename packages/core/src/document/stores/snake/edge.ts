import { getNumber } from "../../database.js";
import type { Database } from "../../database.js";
import type { SnakeEdgeRecord } from "../../types.js";
import type { ReadonlySnakeEdgeStore } from "../types.js";

export class SnakeEdgeStore implements ReadonlySnakeEdgeStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: SnakeEdgeRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO snake_edges (from_snake_id, to_snake_id, weight)
        VALUES (?, ?, ?)
      `,
      [record.fromSnakeId, record.toSnakeId, record.weight],
    );
  }

  public async listIncoming(snakeId: number): Promise<SnakeEdgeRecord[]> {
    return await this.#listByDirection("to_snake_id", snakeId);
  }

  public async listOutgoing(snakeId: number): Promise<SnakeEdgeRecord[]> {
    return await this.#listByDirection("from_snake_id", snakeId);
  }

  public async listWithin(
    snakeIds: readonly number[],
  ): Promise<SnakeEdgeRecord[]> {
    if (snakeIds.length === 0) {
      return [];
    }

    const placeholders = snakeIds.map(() => "?").join(", ");

    return await this.#database.queryAll(
      `
        SELECT from_snake_id, to_snake_id, weight
        FROM snake_edges
        WHERE from_snake_id IN (${placeholders})
          AND to_snake_id IN (${placeholders})
        ORDER BY from_snake_id, to_snake_id
      `,
      [...snakeIds, ...snakeIds],
      (row) => ({
        fromSnakeId: getNumber(row, "from_snake_id"),
        toSnakeId: getNumber(row, "to_snake_id"),
        weight: getNumber(row, "weight"),
      }),
    );
  }

  public async listBySerial(serialId: number): Promise<SnakeEdgeRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          snake_edges.from_snake_id AS from_snake_id,
          snake_edges.to_snake_id AS to_snake_id,
          snake_edges.weight AS weight
        FROM snake_edges
        INNER JOIN snakes AS from_snakes
          ON from_snakes.id = snake_edges.from_snake_id
        INNER JOIN snakes AS to_snakes
          ON to_snakes.id = snake_edges.to_snake_id
        WHERE from_snakes.serial_id = ? AND to_snakes.serial_id = ?
        ORDER BY snake_edges.from_snake_id, snake_edges.to_snake_id
      `,
      [serialId, serialId],
      (row) => ({
        fromSnakeId: getNumber(row, "from_snake_id"),
        toSnakeId: getNumber(row, "to_snake_id"),
        weight: getNumber(row, "weight"),
      }),
    );
  }

  async #listByDirection(
    column: "from_snake_id" | "to_snake_id",
    snakeId: number,
  ): Promise<SnakeEdgeRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT from_snake_id, to_snake_id, weight
        FROM snake_edges
        WHERE ${column} = ?
        ORDER BY from_snake_id, to_snake_id
      `,
      [snakeId],
      (row) => ({
        fromSnakeId: getNumber(row, "from_snake_id"),
        toSnakeId: getNumber(row, "to_snake_id"),
        weight: getNumber(row, "weight"),
      }),
    );
  }
}

import { getNumber } from "../database.js";
import type { Database } from "../database.js";
import type { ReadingEdgeRecord } from "../types.js";
import { mapReadingEdgeRow } from "./helpers.js";
import type { ReadonlyReadingEdgeStore } from "./types.js";

export class ReadingEdgeStore implements ReadonlyReadingEdgeStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async countAll(): Promise<number> {
    return (
      (await this.#database.queryOne(
        `
          SELECT COUNT(*) AS count
          FROM reading_edges
        `,
        undefined,
        (row) => getNumber(row, "count"),
      )) ?? 0
    );
  }

  public async save(record: ReadingEdgeRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO reading_edges (from_id, to_id, strength, weight)
        VALUES (?, ?, ?, ?)
      `,
      [record.fromId, record.toId, record.strength ?? null, record.weight],
    );
  }

  public async listAll(): Promise<ReadingEdgeRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT from_id, to_id, strength, weight
        FROM reading_edges
        ORDER BY from_id, to_id
      `,
      undefined,
      (row) => mapReadingEdgeRow(row),
    );
  }

  public async listBySerial(serialId: number): Promise<ReadingEdgeRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          reading_edges.from_id AS from_id,
          reading_edges.to_id AS to_id,
          reading_edges.strength AS strength,
          reading_edges.weight AS weight
        FROM reading_edges
        INNER JOIN chunks AS from_chunks
          ON from_chunks.id = reading_edges.from_id
        INNER JOIN chunks AS to_chunks
          ON to_chunks.id = reading_edges.to_id
        WHERE from_chunks.serial_id = ? AND to_chunks.serial_id = ?
        ORDER BY reading_edges.from_id, reading_edges.to_id
      `,
      [serialId, serialId],
      (row) => mapReadingEdgeRow(row),
    );
  }

  public async listIncoming(chunkId: number): Promise<ReadingEdgeRecord[]> {
    return await this.#listByDirection("to_id", chunkId);
  }

  public async listOutgoing(chunkId: number): Promise<ReadingEdgeRecord[]> {
    return await this.#listByDirection("from_id", chunkId);
  }

  async #listByDirection(
    column: "from_id" | "to_id",
    chunkId: number,
  ): Promise<ReadingEdgeRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT from_id, to_id, strength, weight
        FROM reading_edges
        WHERE ${column} = ?
        ORDER BY from_id, to_id
      `,
      [chunkId],
      (row) => mapReadingEdgeRow(row),
    );
  }
}

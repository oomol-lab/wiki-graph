import { getNumber, getString } from "../database.js";
import type { Database } from "../database.js";
import type { CreateSnakeRecord, SnakeRecord } from "../types.js";
import type { ReadonlySnakeStore } from "./types.js";

export class SnakeStore implements ReadonlySnakeStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async create(record: CreateSnakeRecord): Promise<number> {
    await this.#database.run(
      `
        INSERT INTO snakes (
          serial_id,
          group_id,
          local_snake_id,
          size,
          first_label,
          last_label,
          wordsCount,
          weight
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.serialId,
        record.groupId,
        record.localSnakeId,
        record.size,
        record.firstLabel,
        record.lastLabel,
        record.wordsCount ?? 0,
        record.weight ?? 0,
      ],
    );

    return await this.#database.getLastInsertRowId();
  }

  public async getById(snakeId: number): Promise<SnakeRecord | undefined> {
    return await this.#database.queryOne(
      `
        SELECT
          id,
          serial_id,
          group_id,
          local_snake_id,
          size,
          first_label,
          last_label,
          wordsCount,
          weight
        FROM snakes
        WHERE id = ?
      `,
      [snakeId],
      (row) => ({
        serialId: getNumber(row, "serial_id"),
        firstLabel: getString(row, "first_label"),
        groupId: getNumber(row, "group_id"),
        id: getNumber(row, "id"),
        lastLabel: getString(row, "last_label"),
        localSnakeId: getNumber(row, "local_snake_id"),
        size: getNumber(row, "size"),
        wordsCount: getNumber(row, "wordsCount"),
        weight: getNumber(row, "weight"),
      }),
    );
  }

  public async listIdsByGroup(
    serialId: number,
    groupId: number,
  ): Promise<number[]> {
    return await this.#database.queryAll(
      `
        SELECT id
        FROM snakes
        WHERE serial_id = ? AND group_id = ?
        ORDER BY id
      `,
      [serialId, groupId],
      (row) => getNumber(row, "id"),
    );
  }

  public async listBySerial(serialId: number): Promise<SnakeRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          id,
          serial_id,
          group_id,
          local_snake_id,
          size,
          first_label,
          last_label,
          wordsCount,
          weight
        FROM snakes
        WHERE serial_id = ?
        ORDER BY group_id, id
      `,
      [serialId],
      (row) => ({
        serialId: getNumber(row, "serial_id"),
        firstLabel: getString(row, "first_label"),
        groupId: getNumber(row, "group_id"),
        id: getNumber(row, "id"),
        lastLabel: getString(row, "last_label"),
        localSnakeId: getNumber(row, "local_snake_id"),
        size: getNumber(row, "size"),
        wordsCount: getNumber(row, "wordsCount"),
        weight: getNumber(row, "weight"),
      }),
    );
  }
}

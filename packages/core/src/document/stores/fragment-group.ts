import { getNumber } from "../database.js";
import type { Database } from "../database.js";
import type { SentenceGroupRecord } from "../types.js";
import type { ReadonlyFragmentGroupStore } from "./types.js";

export class FragmentGroupStore implements ReadonlyFragmentGroupStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: SentenceGroupRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO sentence_groups (
          serial_id,
          group_id,
          start_sentence_index,
          end_sentence_index
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        record.serialId,
        record.groupId,
        record.startSentenceIndex,
        record.endSentenceIndex,
      ],
    );
  }

  public async saveMany(
    records: readonly SentenceGroupRecord[],
  ): Promise<void> {
    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.save(record);
      }
    });
  }

  public async listBySerial(serialId: number): Promise<SentenceGroupRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT serial_id, group_id, start_sentence_index, end_sentence_index
        FROM sentence_groups
        WHERE serial_id = ?
        ORDER BY group_id, start_sentence_index
      `,
      [serialId],
      (row) => ({
        serialId: getNumber(row, "serial_id"),
        groupId: getNumber(row, "group_id"),
        startSentenceIndex: getNumber(row, "start_sentence_index"),
        endSentenceIndex: getNumber(row, "end_sentence_index"),
      }),
    );
  }

  public async listSerialIds(): Promise<number[]> {
    return await this.#database.queryAll(
      `
        SELECT DISTINCT serial_id
        FROM sentence_groups
        ORDER BY serial_id
      `,
      undefined,
      (row) => getNumber(row, "serial_id"),
    );
  }

  public async listGroupIdsForSerial(serialId: number): Promise<number[]> {
    return await this.#database.queryAll(
      `
        SELECT DISTINCT group_id
        FROM sentence_groups
        WHERE serial_id = ?
        ORDER BY group_id
      `,
      [serialId],
      (row) => getNumber(row, "group_id"),
    );
  }
}

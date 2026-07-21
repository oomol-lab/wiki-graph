import { getNumber, getOptionalString, getString } from "../database.js";
import type { Database, SqlRow } from "../database.js";
import type { ChunkRecord, CreateChunkRecord, SentenceId } from "../types.js";
import {
  deduplicateById,
  parseChunkImportance,
  parseChunkRetention,
} from "./helpers.js";
import type { ReadonlyChunkStore } from "./types.js";

export class ChunkStore implements ReadonlyChunkStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async countAll(): Promise<number> {
    return (
      (await this.#database.queryOne(
        `
          SELECT COUNT(*) AS count
          FROM chunks
        `,
        undefined,
        (row) => getNumber(row, "count"),
      )) ?? 0
    );
  }

  public async create(record: CreateChunkRecord): Promise<ChunkRecord> {
    return await this.#database.transaction(async () => {
      await this.#database.run(
        `
          INSERT INTO chunks (
            generation,
            serial_id,
            sentence_index,
            label,
            content,
            retention,
            importance,
            wordsCount,
            weight
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.generation,
          record.sentenceId[0],
          record.sentenceId[1],
          record.label,
          record.content,
          record.retention ?? null,
          record.importance ?? null,
          record.wordsCount,
          record.weight,
        ],
      );

      const id = await this.#database.getLastInsertRowId();
      const createdRecord = {
        ...record,
        id,
      };

      await this.#replaceChunkSentences(createdRecord);

      return createdRecord;
    });
  }

  public async save(record: ChunkRecord): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#database.run(
        `
          INSERT OR REPLACE INTO chunks (
            id,
            generation,
            serial_id,
            sentence_index,
            label,
            content,
            retention,
            importance,
            wordsCount,
            weight
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.id,
          record.generation,
          record.sentenceId[0],
          record.sentenceId[1],
          record.label,
          record.content,
          record.retention ?? null,
          record.importance ?? null,
          record.wordsCount,
          record.weight,
        ],
      );

      await this.#replaceChunkSentences(record);
    });
  }

  public async getById(chunkId: number): Promise<ChunkRecord | undefined> {
    const row = await this.#database.queryOne(
      `
        SELECT
          id,
          generation,
          serial_id,
          sentence_index,
          label,
          content,
          retention,
          importance,
          wordsCount,
          weight
        FROM chunks
        WHERE id = ?
      `,
      [chunkId],
      (value) => value,
    );

    if (row === undefined) {
      return undefined;
    }

    return await this.#mapChunkRow(row);
  }

  public async listAll(): Promise<ChunkRecord[]> {
    const rows = await this.#database.queryAll(
      `
          SELECT
            id,
            generation,
            serial_id,
            sentence_index,
            label,
            content,
            retention,
            importance,
            wordsCount,
            weight
          FROM chunks
          ORDER BY id
        `,
      undefined,
      (row) => row,
    );

    return await Promise.all(
      rows.map(async (row) => await this.#mapChunkRow(row)),
    );
  }

  public async listBySentenceStartIndexes(
    serialId: number,
    sentenceStartIndexes: readonly number[],
  ): Promise<ChunkRecord[]> {
    if (sentenceStartIndexes.length === 0) {
      return [];
    }

    const results = await Promise.all(
      sentenceStartIndexes.map(
        async (sentenceStartIndex) =>
          await this.listBySentenceRange(
            serialId,
            sentenceStartIndex,
            sentenceStartIndex,
          ),
      ),
    );

    return deduplicateById(results.flat());
  }

  public async listBySentenceRange(
    serialId: number,
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<ChunkRecord[]> {
    const rows = await this.#database.queryAll(
      `
        SELECT
          id,
          generation,
          serial_id,
          sentence_index,
          label,
          content,
          retention,
          importance,
          wordsCount,
          weight
        FROM chunks
        WHERE serial_id = ?
          AND sentence_index BETWEEN ? AND ?
        ORDER BY id
      `,
      [serialId, startSentenceIndex, endSentenceIndex],
      (row) => row,
    );

    return await Promise.all(
      rows.map(async (row) => await this.#mapChunkRow(row)),
    );
  }

  public async listBySerial(serialId: number): Promise<ChunkRecord[]> {
    const rows = await this.#database.queryAll(
      `
          SELECT
            id,
            generation,
            serial_id,
            sentence_index,
            label,
            content,
            retention,
            importance,
            wordsCount,
            weight
          FROM chunks
          WHERE serial_id = ?
          ORDER BY id
        `,
      [serialId],
      (row) => row,
    );

    return await Promise.all(
      rows.map(async (row) => await this.#mapChunkRow(row)),
    );
  }

  public async getMaxId(): Promise<number> {
    return (
      (await this.#database.queryOne(
        `
          SELECT MAX(id) AS id
          FROM chunks
        `,
        undefined,
        (row) => {
          const value = row.id;

          return typeof value === "number" ? value : 0;
        },
      )) ?? 0
    );
  }

  public async listFragmentPairs(): Promise<
    ReadonlyArray<readonly [number, number]>
  > {
    return await this.#database.queryAll(
      `
        SELECT DISTINCT serial_id, sentence_index
        FROM chunks
        ORDER BY serial_id, sentence_index
      `,
      undefined,
      (row) =>
        [
          getNumber(row, "serial_id"),
          getNumber(row, "sentence_index"),
        ] as const,
    );
  }

  async #getSentenceIds(chunkId: number): Promise<SentenceId[]> {
    return await this.#database.queryAll(
      `
        SELECT serial_id, sentence_index
        FROM chunk_sentences
        WHERE chunk_id = ?
        ORDER BY serial_id, sentence_index
      `,
      [chunkId],
      (row) =>
        [
          getNumber(row, "serial_id"),
          getNumber(row, "sentence_index"),
        ] as const,
    );
  }

  async #replaceChunkSentences(record: ChunkRecord): Promise<void> {
    await this.#database.run(
      `
        DELETE FROM chunk_sentences
        WHERE chunk_id = ?
      `,
      [record.id],
    );

    for (const sentenceId of record.sentenceIds) {
      await this.#database.run(
        `
          INSERT INTO chunk_sentences (
            chunk_id,
            serial_id,
            sentence_index
          )
          VALUES (?, ?, ?)
        `,
        [record.id, sentenceId[0], sentenceId[1]],
      );
    }
  }

  async #mapChunkRow(row: SqlRow): Promise<ChunkRecord> {
    const chunkId = getNumber(row, "id");
    const importance = parseChunkImportance(
      getOptionalString(row, "importance"),
    );
    const retention = parseChunkRetention(getOptionalString(row, "retention"));

    return {
      content: getString(row, "content"),
      generation: getNumber(row, "generation"),
      id: chunkId,
      label: getString(row, "label"),
      sentenceId: [
        getNumber(row, "serial_id"),
        getNumber(row, "sentence_index"),
      ] as const,
      sentenceIds: await this.#getSentenceIds(chunkId),
      wordsCount: getNumber(row, "wordsCount"),
      weight: getNumber(row, "weight"),
      ...(importance === undefined ? {} : { importance }),
      ...(retention === undefined ? {} : { retention }),
    };
  }
}

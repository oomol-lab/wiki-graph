import { getNumber, getOptionalString, getString } from "./database.js";
import type { Database, SqlRow } from "./database.js";
import {
  isChunkImportance,
  isChunkRetention,
  type ChunkImportance,
  type ChunkRecord,
  type ChunkRetention,
  type CreateChunkRecord,
  type CreateSnakeRecord,
  type FragmentGroupRecord,
  type ReadingEdgeRecord,
  type MentionLinkRecord,
  type MentionRecord,
  type SerialRecord,
  type SentenceId,
  type SnakeChunkRecord,
  type SnakeEdgeRecord,
  type SnakeRecord,
} from "./types.js";

export interface ReadonlySerialStore {
  getById(serialId: number): Promise<SerialRecord | undefined>;
  getMaxId(): Promise<number>;
  listIds(): Promise<number[]>;
}

export interface ReadonlyChunkStore {
  getById(chunkId: number): Promise<ChunkRecord | undefined>;
  listAll(): Promise<ChunkRecord[]>;
  listByFragments(
    serialId: number,
    fragmentIds: readonly number[],
  ): Promise<ChunkRecord[]>;
  listBySerial(serialId: number): Promise<ChunkRecord[]>;
  getMaxId(): Promise<number>;
  listFragmentPairs(): Promise<ReadonlyArray<readonly [number, number]>>;
}

export interface ReadonlyReadingEdgeStore {
  listAll(): Promise<ReadingEdgeRecord[]>;
  listBySerial(serialId: number): Promise<ReadingEdgeRecord[]>;
  listIncoming(chunkId: number): Promise<ReadingEdgeRecord[]>;
  listOutgoing(chunkId: number): Promise<ReadingEdgeRecord[]>;
}

export interface ReadonlyMentionStore {
  getById(mentionId: string): Promise<MentionRecord | undefined>;
  listBySurfaceTerms(terms: readonly string[]): Promise<MentionRecord[]>;
  listBySurfaces(surfaces: readonly string[]): Promise<MentionRecord[]>;
  listByQid(qid: string): Promise<MentionRecord[]>;
  listByChapter(chapterId: number): Promise<MentionRecord[]>;
}

export interface ReadonlyMentionLinkStore {
  getById(linkId: string): Promise<MentionLinkRecord | undefined>;
  listByTriple(input: {
    readonly objectQid: string;
    readonly predicate: string;
    readonly subjectQid: string;
  }): Promise<MentionLinkRecord[]>;
  listByChapter(chapterId: number): Promise<MentionLinkRecord[]>;
}

export interface ReadonlySnakeStore {
  getById(snakeId: number): Promise<SnakeRecord | undefined>;
  listIdsByGroup(serialId: number, groupId: number): Promise<number[]>;
  listBySerial(serialId: number): Promise<SnakeRecord[]>;
}

export interface ReadonlySnakeChunkStore {
  listChunkIds(snakeId: number): Promise<number[]>;
  listBySnake(snakeId: number): Promise<SnakeChunkRecord[]>;
}

export interface ReadonlySnakeEdgeStore {
  listIncoming(snakeId: number): Promise<SnakeEdgeRecord[]>;
  listOutgoing(snakeId: number): Promise<SnakeEdgeRecord[]>;
  listWithin(snakeIds: readonly number[]): Promise<SnakeEdgeRecord[]>;
  listBySerial(serialId: number): Promise<SnakeEdgeRecord[]>;
}

export interface ReadonlyFragmentGroupStore {
  listBySerial(serialId: number): Promise<FragmentGroupRecord[]>;
  listSerialIds(): Promise<number[]>;
  listGroupIdsForSerial(serialId: number): Promise<number[]>;
}

export class SerialStore implements ReadonlySerialStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async create(): Promise<number> {
    return await this.#database.transaction(async () => {
      await this.#database.run(
        `
          INSERT INTO serials DEFAULT VALUES
        `,
      );

      const serialId = await this.#database.getLastInsertRowId();

      await this.#database.run(
        `
          INSERT INTO serial_states (serial_id, topology_ready)
          VALUES (?, ?)
        `,
        [serialId, 0],
      );

      return serialId;
    });
  }

  public async createWithId(serialId: number): Promise<void> {
    try {
      await this.#database.transaction(async () => {
        await this.#database.run(
          `
            INSERT INTO serials (id)
            VALUES (?)
          `,
          [serialId],
        );

        await this.#database.run(
          `
            INSERT INTO serial_states (serial_id, topology_ready)
            VALUES (?, ?)
          `,
          [serialId, 0],
        );
      });
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        throw new Error(`Serial ${serialId} already exists`);
      }

      throw error;
    }
  }

  public async ensure(serialId: number): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#database.run(
        `
          INSERT OR IGNORE INTO serials (id)
          VALUES (?)
        `,
        [serialId],
      );

      await this.#database.run(
        `
          INSERT OR IGNORE INTO serial_states (serial_id, topology_ready)
          VALUES (?, ?)
        `,
        [serialId, 0],
      );
    });
  }

  public async getById(serialId: number): Promise<SerialRecord | undefined> {
    return await this.#database.queryOne(
      `
        SELECT
          serials.id AS id,
          COALESCE(serial_states.topology_ready, 0) AS topology_ready
        FROM serials
        LEFT JOIN serial_states
          ON serial_states.serial_id = serials.id
        WHERE serials.id = ?
      `,
      [serialId],
      (row) => ({
        id: getNumber(row, "id"),
        topologyReady: getNumber(row, "topology_ready") !== 0,
      }),
    );
  }

  public async getMaxId(): Promise<number> {
    const maxId = await this.#database.queryOne(
      `
          SELECT COALESCE(MAX(id), 0) AS max_id
          FROM serials
        `,
      undefined,
      (row) => getNumber(row, "max_id"),
    );

    return maxId ?? 0;
  }

  public async setTopologyReady(serialId: number, ready = true): Promise<void> {
    await this.ensure(serialId);
    await this.#database.run(
      `
        UPDATE serial_states
        SET topology_ready = ?
        WHERE serial_id = ?
      `,
      [ready ? 1 : 0, serialId],
    );
  }

  public async listIds(): Promise<number[]> {
    return await this.#database.queryAll(
      `
        SELECT id
        FROM serials
        ORDER BY id
      `,
      undefined,
      (row) => getNumber(row, "id"),
    );
  }
}

function isSqliteConstraintError(
  error: unknown,
): error is { readonly code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT")
  );
}

export class ChunkStore implements ReadonlyChunkStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async create(record: CreateChunkRecord): Promise<ChunkRecord> {
    return await this.#database.transaction(async () => {
      await this.#database.run(
        `
          INSERT INTO chunks (
            generation,
            serial_id,
            fragment_id,
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
          record.generation,
          record.sentenceId[0],
          record.sentenceId[1],
          record.sentenceId[2],
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
            fragment_id,
            sentence_index,
            label,
            content,
            retention,
            importance,
            wordsCount,
            weight
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.id,
          record.generation,
          record.sentenceId[0],
          record.sentenceId[1],
          record.sentenceId[2],
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
          fragment_id,
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
            fragment_id,
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

  public async listByFragments(
    serialId: number,
    fragmentIds: readonly number[],
  ): Promise<ChunkRecord[]> {
    if (fragmentIds.length === 0) {
      return [];
    }

    const placeholders = fragmentIds.map(() => "?").join(", ");

    const rows = await this.#database.queryAll(
      `
          SELECT
            id,
            generation,
            serial_id,
            fragment_id,
            sentence_index,
            label,
            content,
            retention,
            importance,
            wordsCount,
            weight
          FROM chunks
          WHERE serial_id = ? AND fragment_id IN (${placeholders})
          ORDER BY id
        `,
      [serialId, ...fragmentIds],
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
            fragment_id,
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
        SELECT DISTINCT serial_id, fragment_id
        FROM chunks
        ORDER BY serial_id, fragment_id
      `,
      undefined,
      (row) =>
        [getNumber(row, "serial_id"), getNumber(row, "fragment_id")] as const,
    );
  }

  async #getSentenceIds(chunkId: number): Promise<SentenceId[]> {
    return await this.#database.queryAll(
      `
        SELECT serial_id, fragment_id, sentence_index
        FROM chunk_sentences
        WHERE chunk_id = ?
        ORDER BY serial_id, fragment_id, sentence_index
      `,
      [chunkId],
      (row) =>
        [
          getNumber(row, "serial_id"),
          getNumber(row, "fragment_id"),
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
            fragment_id,
            sentence_index
          )
          VALUES (?, ?, ?, ?)
        `,
        [record.id, sentenceId[0], sentenceId[1], sentenceId[2]],
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
        getNumber(row, "fragment_id"),
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

export class ReadingEdgeStore implements ReadonlyReadingEdgeStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
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

export class MentionStore implements ReadonlyMentionStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: MentionRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO mentions (
          id,
          chapter_id,
          fragment_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.chapterId,
        record.fragmentId,
        record.sentenceIndex ?? null,
        record.rangeStart,
        record.rangeEnd,
        record.surface,
        record.qid,
        record.confidence ?? null,
        record.note ?? null,
      ],
    );
  }

  public async saveMany(records: readonly MentionRecord[]): Promise<void> {
    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.save(record);
      }
    });
  }

  public async getById(mentionId: string): Promise<MentionRecord | undefined> {
    return await this.#database.queryOne(
      `
        SELECT
          id,
          chapter_id,
          fragment_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE id = ?
      `,
      [mentionId],
      mapMentionRow,
    );
  }

  public async listByQid(qid: string): Promise<MentionRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          fragment_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE qid = ?
        ORDER BY chapter_id, fragment_id, sentence_index, range_start, range_end, id
      `,
      [qid],
      mapMentionRow,
    );
  }

  public async listBySurfaces(
    surfaces: readonly string[],
  ): Promise<MentionRecord[]> {
    const normalizedSurfaces = [
      ...new Set(surfaces.map((surface) => surface.trim())),
    ].filter((surface) => surface !== "");

    if (normalizedSurfaces.length === 0) {
      return [];
    }

    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          fragment_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE surface IN (${normalizedSurfaces.map(() => "?").join(", ")})
        ORDER BY chapter_id, fragment_id, sentence_index, range_start, range_end, id
      `,
      normalizedSurfaces,
      mapMentionRow,
    );
  }

  public async listBySurfaceTerms(
    terms: readonly string[],
  ): Promise<MentionRecord[]> {
    const normalizedTerms = [
      ...new Set(terms.map((term) => term.trim().toLowerCase())),
    ].filter((term) => term !== "");

    if (normalizedTerms.length === 0) {
      return [];
    }

    const filters = normalizedTerms
      .map(() => "lower(surface) LIKE ? ESCAPE '\\'")
      .join(" OR ");

    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          fragment_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE ${filters}
        ORDER BY chapter_id, fragment_id, sentence_index, range_start, range_end, id
      `,
      normalizedTerms.map((term) => `%${escapeLikePattern(term)}%`),
      mapMentionRow,
    );
  }

  public async listByChapter(chapterId: number): Promise<MentionRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          fragment_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE chapter_id = ?
        ORDER BY fragment_id, sentence_index, range_start, range_end, id
      `,
      [chapterId],
      mapMentionRow,
    );
  }

  public async deleteByChapter(chapterId: number): Promise<void> {
    await this.#database.run(
      `
        DELETE FROM mentions
        WHERE chapter_id = ?
      `,
      [chapterId],
    );
  }
}

export class MentionLinkStore implements ReadonlyMentionLinkStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: MentionLinkRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO mention_links (
          id,
          source_mention_id,
          target_mention_id,
          predicate,
          evidence_start,
          evidence_end,
          confidence,
          note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.sourceMentionId,
        record.targetMentionId,
        record.predicate,
        record.evidenceStart ?? null,
        record.evidenceEnd ?? null,
        record.confidence ?? null,
        record.note ?? null,
      ],
    );
  }

  public async saveMany(records: readonly MentionLinkRecord[]): Promise<void> {
    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.save(record);
      }
    });
  }

  public async getById(linkId: string): Promise<MentionLinkRecord | undefined> {
    return await this.#database.queryOne(
      `
        SELECT
          id,
          source_mention_id,
          target_mention_id,
          predicate,
          evidence_start,
          evidence_end,
          confidence,
          note
        FROM mention_links
        WHERE id = ?
      `,
      [linkId],
      mapMentionLinkRow,
    );
  }

  public async listByTriple(input: {
    readonly objectQid: string;
    readonly predicate: string;
    readonly subjectQid: string;
  }): Promise<MentionLinkRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          mention_links.id AS id,
          mention_links.source_mention_id AS source_mention_id,
          mention_links.target_mention_id AS target_mention_id,
          mention_links.predicate AS predicate,
          mention_links.evidence_start AS evidence_start,
          mention_links.evidence_end AS evidence_end,
          mention_links.confidence AS confidence,
          mention_links.note AS note
        FROM mention_links
        INNER JOIN mentions AS source_mentions
          ON source_mentions.id = mention_links.source_mention_id
        INNER JOIN mentions AS target_mentions
          ON target_mentions.id = mention_links.target_mention_id
        WHERE source_mentions.qid = ?
          AND mention_links.predicate = ?
          AND target_mentions.qid = ?
        ORDER BY
          source_mentions.chapter_id,
          source_mentions.fragment_id,
          source_mentions.sentence_index,
          mention_links.evidence_start,
          mention_links.evidence_end,
          mention_links.id
      `,
      [input.subjectQid, input.predicate, input.objectQid],
      mapMentionLinkRow,
    );
  }

  public async listByChapter(chapterId: number): Promise<MentionLinkRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          mention_links.id AS id,
          mention_links.source_mention_id AS source_mention_id,
          mention_links.target_mention_id AS target_mention_id,
          mention_links.predicate AS predicate,
          mention_links.evidence_start AS evidence_start,
          mention_links.evidence_end AS evidence_end,
          mention_links.confidence AS confidence,
          mention_links.note AS note
        FROM mention_links
        INNER JOIN mentions AS source_mentions
          ON source_mentions.id = mention_links.source_mention_id
        INNER JOIN mentions AS target_mentions
          ON target_mentions.id = mention_links.target_mention_id
        WHERE source_mentions.chapter_id = ?
          OR target_mentions.chapter_id = ?
        ORDER BY mention_links.id
      `,
      [chapterId, chapterId],
      mapMentionLinkRow,
    );
  }

  public async deleteByChapter(chapterId: number): Promise<void> {
    await this.#database.run(
      `
        DELETE FROM mention_links
        WHERE source_mention_id IN (
          SELECT id
          FROM mentions
          WHERE chapter_id = ?
        )
        OR target_mention_id IN (
          SELECT id
          FROM mentions
          WHERE chapter_id = ?
        )
      `,
      [chapterId, chapterId],
    );
  }
}

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

export class FragmentGroupStore implements ReadonlyFragmentGroupStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: FragmentGroupRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO fragment_groups (serial_id, group_id, fragment_id)
        VALUES (?, ?, ?)
      `,
      [record.serialId, record.groupId, record.fragmentId],
    );
  }

  public async saveMany(
    records: readonly FragmentGroupRecord[],
  ): Promise<void> {
    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.save(record);
      }
    });
  }

  public async listBySerial(serialId: number): Promise<FragmentGroupRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT serial_id, group_id, fragment_id
        FROM fragment_groups
        WHERE serial_id = ?
        ORDER BY group_id, fragment_id
      `,
      [serialId],
      (row) => ({
        serialId: getNumber(row, "serial_id"),
        fragmentId: getNumber(row, "fragment_id"),
        groupId: getNumber(row, "group_id"),
      }),
    );
  }

  public async listSerialIds(): Promise<number[]> {
    return await this.#database.queryAll(
      `
        SELECT DISTINCT serial_id
        FROM fragment_groups
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
        FROM fragment_groups
        WHERE serial_id = ?
        ORDER BY group_id
      `,
      [serialId],
      (row) => getNumber(row, "group_id"),
    );
  }
}

function mapReadingEdgeRow(row: SqlRow): ReadingEdgeRecord {
  const strength = getOptionalString(row, "strength");

  return {
    fromId: getNumber(row, "from_id"),
    toId: getNumber(row, "to_id"),
    weight: getNumber(row, "weight"),
    ...(strength === undefined ? {} : { strength }),
  };
}

function mapMentionRow(row: SqlRow): MentionRecord {
  const sentenceIndex = getOptionalNumber(row, "sentence_index");
  const confidence = getOptionalNumber(row, "confidence");
  const note = getOptionalString(row, "note");

  return {
    chapterId: getNumber(row, "chapter_id"),
    ...(confidence === undefined ? {} : { confidence }),
    fragmentId: getNumber(row, "fragment_id"),
    id: getString(row, "id"),
    ...(note === undefined ? {} : { note }),
    qid: getString(row, "qid"),
    rangeEnd: getNumber(row, "range_end"),
    rangeStart: getNumber(row, "range_start"),
    ...(sentenceIndex === undefined ? {} : { sentenceIndex }),
    surface: getString(row, "surface"),
  };
}

function mapMentionLinkRow(row: SqlRow): MentionLinkRecord {
  const confidence = getOptionalNumber(row, "confidence");
  const evidenceEnd = getOptionalNumber(row, "evidence_end");
  const evidenceStart = getOptionalNumber(row, "evidence_start");
  const note = getOptionalString(row, "note");

  return {
    ...(confidence === undefined ? {} : { confidence }),
    ...(evidenceEnd === undefined ? {} : { evidenceEnd }),
    ...(evidenceStart === undefined ? {} : { evidenceStart }),
    id: getString(row, "id"),
    ...(note === undefined ? {} : { note }),
    predicate: getString(row, "predicate"),
    sourceMentionId: getString(row, "source_mention_id"),
    targetMentionId: getString(row, "target_mention_id"),
  };
}

function getOptionalNumber(row: SqlRow, key: string): number | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function parseChunkImportance(
  value: string | undefined,
): ChunkImportance | undefined {
  return value !== undefined && isChunkImportance(value) ? value : undefined;
}

function parseChunkRetention(
  value: string | undefined,
): ChunkRetention | undefined {
  return value !== undefined && isChunkRetention(value) ? value : undefined;
}

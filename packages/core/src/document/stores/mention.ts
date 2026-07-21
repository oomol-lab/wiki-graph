import type { Database } from "../database.js";
import type { MentionRecord } from "../types.js";
import { escapeLikePattern, mapMentionRow } from "./helpers.js";
import type { ReadonlyMentionStore } from "./types.js";

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
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.chapterId,
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

  public async listAll(): Promise<MentionRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        ORDER BY chapter_id, sentence_index, range_start, range_end, id
      `,
      undefined,
      mapMentionRow,
    );
  }

  public async listByQid(qid: string): Promise<MentionRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE qid = ?
        ORDER BY chapter_id, sentence_index, range_start, range_end, id
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
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE surface IN (${normalizedSurfaces.map(() => "?").join(", ")})
        ORDER BY chapter_id, sentence_index, range_start, range_end, id
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
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE ${filters}
        ORDER BY chapter_id, sentence_index, range_start, range_end, id
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
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE chapter_id = ?
        ORDER BY sentence_index, range_start, range_end, id
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

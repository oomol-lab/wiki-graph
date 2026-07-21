import { getNumber, getString } from "../database.js";
import type { Database } from "../database.js";
import type { MentionLinkRecord, SentenceId } from "../types.js";
import {
  chunkArray,
  mapMentionLinkRow,
  MAX_SQL_BIND_PARAMS,
} from "./helpers.js";
import type { ReadonlyMentionLinkStore } from "./types.js";

export class MentionLinkStore implements ReadonlyMentionLinkStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: MentionLinkRecord): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#saveRecord(record);
    });
  }

  async #saveRecord(record: MentionLinkRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO mention_links (
          id,
          source_mention_id,
          target_mention_id,
          predicate,
          confidence,
          note
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.sourceMentionId,
        record.targetMentionId,
        record.predicate,
        record.confidence ?? null,
        record.note ?? null,
      ],
    );
    await this.#database.run(
      `
        DELETE FROM mention_link_evidence_sentences
        WHERE link_id = ?
      `,
      [record.id],
    );

    for (const [chapterId, sentenceIndex] of record.evidenceSentenceIds) {
      await this.#database.run(
        `
          INSERT INTO mention_link_evidence_sentences (
            link_id,
            chapter_id,
            sentence_index
          )
          VALUES (?, ?, ?)
        `,
        [record.id, chapterId, sentenceIndex],
      );
    }
  }

  public async saveMany(records: readonly MentionLinkRecord[]): Promise<void> {
    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.#saveRecord(record);
      }
    });
  }

  public async getById(linkId: string): Promise<MentionLinkRecord | undefined> {
    const row = await this.#database.queryOne(
      `
        SELECT
          id,
          source_mention_id,
          target_mention_id,
          predicate,
          confidence,
          note
        FROM mention_links
        WHERE id = ?
      `,
      [linkId],
      mapMentionLinkRow,
    );

    return row === undefined ? undefined : await this.#hydrateEvidence(row);
  }

  public async listByTriple(input: {
    readonly objectQid: string;
    readonly predicate: string;
    readonly subjectQid: string;
  }): Promise<MentionLinkRecord[]> {
    const rows = await this.#database.queryAll(
      `
        SELECT
          mention_links.id AS id,
          mention_links.source_mention_id AS source_mention_id,
          mention_links.target_mention_id AS target_mention_id,
          mention_links.predicate AS predicate,
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
          source_mentions.sentence_index,
          mention_links.id
      `,
      [input.subjectQid, input.predicate, input.objectQid],
      mapMentionLinkRow,
    );

    return await this.#hydrateEvidenceMany(rows);
  }

  public async listByChapter(chapterId: number): Promise<MentionLinkRecord[]> {
    const rows = await this.#database.queryAll(
      `
        SELECT
          mention_links.id AS id,
          mention_links.source_mention_id AS source_mention_id,
          mention_links.target_mention_id AS target_mention_id,
          mention_links.predicate AS predicate,
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

    return await this.#hydrateEvidenceMany(rows);
  }

  public async deleteByChapter(chapterId: number): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#database.run(
        `
          DELETE FROM mention_link_evidence_sentences
          WHERE link_id IN (
            SELECT mention_links.id
            FROM mention_links
            INNER JOIN mentions AS source_mentions
              ON source_mentions.id = mention_links.source_mention_id
            INNER JOIN mentions AS target_mentions
              ON target_mentions.id = mention_links.target_mention_id
            WHERE source_mentions.chapter_id = ?
              OR target_mentions.chapter_id = ?
          )
        `,
        [chapterId, chapterId],
      );
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
    });
  }

  async #hydrateEvidenceMany(
    records: readonly MentionLinkRecord[],
  ): Promise<MentionLinkRecord[]> {
    if (records.length === 0) {
      return [];
    }

    const sentenceIdsByLinkId = new Map<string, SentenceId[]>();
    const linkIds = [...new Set(records.map((record) => record.id))];

    for (const linkIdBatch of chunkArray(linkIds, MAX_SQL_BIND_PARAMS)) {
      const placeholders = linkIdBatch.map(() => "?").join(", ");
      const rows = await this.#database.queryAll(
        `
          SELECT link_id, chapter_id, sentence_index
          FROM mention_link_evidence_sentences
          WHERE link_id IN (${placeholders})
          ORDER BY link_id, chapter_id, sentence_index
        `,
        linkIdBatch,
        (row) => ({
          linkId: getString(row, "link_id"),
          sentenceId: [
            getNumber(row, "chapter_id"),
            getNumber(row, "sentence_index"),
          ] as SentenceId,
        }),
      );

      for (const row of rows) {
        const sentenceIds = sentenceIdsByLinkId.get(row.linkId) ?? [];

        sentenceIds.push(row.sentenceId);
        sentenceIdsByLinkId.set(row.linkId, sentenceIds);
      }
    }

    return records.map((record) => ({
      ...record,
      evidenceSentenceIds: sentenceIdsByLinkId.get(record.id) ?? [],
    }));
  }

  async #hydrateEvidence(
    record: MentionLinkRecord,
  ): Promise<MentionLinkRecord> {
    const evidenceSentenceIds = await this.#database.queryAll(
      `
        SELECT chapter_id, sentence_index
        FROM mention_link_evidence_sentences
        WHERE link_id = ?
        ORDER BY chapter_id, sentence_index
      `,
      [record.id],
      (row): SentenceId => [
        getNumber(row, "chapter_id"),
        getNumber(row, "sentence_index"),
      ],
    );

    return {
      ...record,
      evidenceSentenceIds,
    };
  }
}

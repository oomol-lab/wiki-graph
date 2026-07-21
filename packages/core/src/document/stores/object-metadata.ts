import { getString } from "../database.js";
import type { Database } from "../database.js";
import type { ObjectMetadataTarget } from "../types.js";
import { parseMetadataValue } from "./helpers.js";
import type { ReadonlyObjectMetadataStore } from "./types.js";

export class ObjectMetadataStore implements ReadonlyObjectMetadataStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async getMap(
    objectPath: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const rows = await this.#database.queryAll(
      `
        SELECT key, value_json
        FROM object_metadata
        WHERE object_path = ?
        ORDER BY key
      `,
      [objectPath],
      (row) => ({
        key: getString(row, "key"),
        value: parseMetadataValue(getString(row, "value_json")),
      }),
    );
    const result: Record<string, unknown> = {};

    for (const row of rows) {
      result[row.key] = row.value;
    }

    return result;
  }

  public async replaceMap(
    target: ObjectMetadataTarget,
    map: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.#database.transaction(async () => {
      await this.clear(target.objectPath);
      for (const [key, value] of Object.entries(map)) {
        await this.put(target, key, value);
      }
    });
  }

  public async put(
    target: ObjectMetadataTarget,
    key: string,
    value: unknown,
  ): Promise<void> {
    await this.#database.run(
      `
        INSERT INTO object_metadata (
          object_kind,
          object_path,
          key,
          value_json,
          updated_at,
          chapter_id,
          chunk_id,
          entity_qid,
          triple_subject_qid,
          triple_predicate,
          triple_object_qid
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(object_path, key) DO UPDATE SET
          object_kind = excluded.object_kind,
          value_json = excluded.value_json,
          updated_at = excluded.updated_at,
          chapter_id = excluded.chapter_id,
          chunk_id = excluded.chunk_id,
          entity_qid = excluded.entity_qid,
          triple_subject_qid = excluded.triple_subject_qid,
          triple_predicate = excluded.triple_predicate,
          triple_object_qid = excluded.triple_object_qid
      `,
      [
        target.kind,
        target.objectPath,
        key,
        JSON.stringify(value),
        new Date().toISOString(),
        target.chapterId ?? null,
        target.chunkId ?? null,
        target.entityQid ?? null,
        target.tripleSubjectQid ?? null,
        target.triplePredicate ?? null,
        target.tripleObjectQid ?? null,
      ],
    );
  }

  public async deleteKey(objectPath: string, key: string): Promise<void> {
    await this.#database.run(
      `
        DELETE FROM object_metadata
        WHERE object_path = ?
          AND key = ?
      `,
      [objectPath, key],
    );
  }

  public async clear(objectPath: string): Promise<void> {
    await this.#database.run(
      `
        DELETE FROM object_metadata
        WHERE object_path = ?
      `,
      [objectPath],
    );
  }

  public async deleteChapterSubtree(chapterId: number): Promise<void> {
    await this.#database.run(
      `
        DELETE FROM object_metadata
        WHERE chapter_id = ?
      `,
      [chapterId],
    );
  }

  public async deleteDeletedChunks(): Promise<void> {
    await this.#database.run(`
      DELETE FROM object_metadata
      WHERE chunk_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM chunks
          WHERE chunks.id = object_metadata.chunk_id
        )
    `);
  }

  public async deleteDeletedEntitiesAndTriples(): Promise<void> {
    await this.#database.run(`
      DELETE FROM object_metadata
      WHERE entity_qid IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM mentions
          WHERE mentions.qid = object_metadata.entity_qid
        )
    `);
    await this.#database.run(`
      DELETE FROM object_metadata
      WHERE triple_subject_qid IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM mention_links
          JOIN mentions AS source_mentions
            ON source_mentions.id = mention_links.source_mention_id
          JOIN mentions AS target_mentions
            ON target_mentions.id = mention_links.target_mention_id
          WHERE source_mentions.qid = object_metadata.triple_subject_qid
            AND mention_links.predicate = object_metadata.triple_predicate
            AND target_mentions.qid = object_metadata.triple_object_qid
        )
    `);
  }
}

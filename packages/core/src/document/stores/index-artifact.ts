import { getNumber, getString } from "../database.js";
import type { Database, SqlRow } from "../database.js";
import {
  INDEX_ARTIFACT_KINDS,
  type IndexArtifactCoverageRecord,
  type IndexArtifactEmbeddingSegment,
  type IndexArtifactKind,
  type IndexArtifactLexicalRow,
  type IndexArtifactRecord,
  type ReplaceEmbeddingIndexArtifactInput,
  type ReplaceFtsIndexArtifactInput,
} from "../types.js";
import type { ReadonlyIndexArtifactStore } from "./types.js";

export class IndexArtifactStore implements ReadonlyIndexArtifactStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async get(
    serialId: number,
    kind: IndexArtifactKind,
  ): Promise<IndexArtifactRecord | undefined> {
    return await this.#database.queryOne(
      `
        SELECT serial_id, kind, source_revision, created_at, metadata_json
        FROM index_artifacts
        WHERE serial_id = ?
          AND kind = ?
      `,
      [serialId, kind],
      mapArtifactRow,
    );
  }

  public async list(kind?: IndexArtifactKind): Promise<IndexArtifactRecord[]> {
    if (kind === undefined) {
      return await this.#database.queryAll(
        `
          SELECT serial_id, kind, source_revision, created_at, metadata_json
          FROM index_artifacts
          ORDER BY serial_id, kind
        `,
        undefined,
        mapArtifactRow,
      );
    }

    return await this.#database.queryAll(
      `
        SELECT serial_id, kind, source_revision, created_at, metadata_json
        FROM index_artifacts
        WHERE kind = ?
        ORDER BY serial_id
      `,
      [kind],
      mapArtifactRow,
    );
  }

  public async listCoverage(
    kind: IndexArtifactKind,
  ): Promise<IndexArtifactCoverageRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          serials.id AS serial_id,
          COALESCE(serial_states.revision, 0) AS serial_revision,
          index_artifacts.source_revision AS source_revision
        FROM serials
        LEFT JOIN serial_states
          ON serial_states.serial_id = serials.id
        LEFT JOIN index_artifacts
          ON index_artifacts.serial_id = serials.id
         AND index_artifacts.kind = ?
        ORDER BY serials.document_order, serials.id
      `,
      [kind],
      (row) => {
        const serialRevision = getNumber(row, "serial_revision");
        const sourceRevision = getOptionalNumber(row, "source_revision");

        return {
          current: sourceRevision === serialRevision,
          kind,
          serialId: getNumber(row, "serial_id"),
          serialRevision,
          ...(sourceRevision === undefined ? {} : { sourceRevision }),
        };
      },
    );
  }

  public async listLexicalRows(
    serialId: number,
    kind: "fts" = "fts",
  ): Promise<IndexArtifactLexicalRow[]> {
    return await this.#database.queryAll(
      `
        SELECT
          row_id,
          object_kind,
          object_id,
          sentence_index,
          text,
          tokens_json,
          metadata_json
        FROM index_artifact_lexical_rows
        WHERE serial_id = ?
          AND kind = ?
        ORDER BY row_id
      `,
      [serialId, kind],
      mapLexicalRow,
    );
  }

  public async listEmbeddingSegments(
    serialId: number,
    kind: "embedding-source" | "embedding-summary",
  ): Promise<IndexArtifactEmbeddingSegment[]> {
    return await this.#database.queryAll(
      `
        SELECT
          segment_index,
          start_sentence_index,
          end_sentence_index,
          words_count,
          text,
          vector_json
        FROM index_artifact_embedding_segments
        WHERE serial_id = ?
          AND kind = ?
        ORDER BY segment_index
      `,
      [serialId, kind],
      mapEmbeddingSegmentRow,
    );
  }

  public async replaceFts(input: ReplaceFtsIndexArtifactInput): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#replaceArtifactHeader({
        kind: "fts",
        metadata: input.metadata ?? {},
        serialId: input.serialId,
        sourceRevision: input.sourceRevision,
      });
      await this.#database.run(
        `
          DELETE FROM index_artifact_lexical_rows
          WHERE serial_id = ?
            AND kind = 'fts'
        `,
        [input.serialId],
      );

      for await (const row of input.lexicalRows) {
        await this.#database.run(
          `
            INSERT INTO index_artifact_lexical_rows (
              serial_id,
              kind,
              row_id,
              object_kind,
              object_id,
              sentence_index,
              text,
              tokens_json,
              metadata_json
            )
            VALUES (?, 'fts', ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            input.serialId,
            row.rowId,
            row.objectKind,
            row.objectId,
            row.sentenceIndex ?? null,
            row.text,
            JSON.stringify(row.tokens),
            JSON.stringify(row.metadata),
          ],
        );
      }
    });
  }

  public async replaceEmbedding(
    input: ReplaceEmbeddingIndexArtifactInput,
  ): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#replaceArtifactHeader({
        kind: input.kind,
        metadata: input.metadata ?? {},
        serialId: input.serialId,
        sourceRevision: input.sourceRevision,
      });
      await this.#database.run(
        `
          DELETE FROM index_artifact_embedding_segments
          WHERE serial_id = ?
            AND kind = ?
        `,
        [input.serialId, input.kind],
      );

      for await (const segment of input.segments) {
        await this.#database.run(
          `
            INSERT INTO index_artifact_embedding_segments (
              serial_id,
              kind,
              segment_index,
              start_sentence_index,
              end_sentence_index,
              words_count,
              text,
              vector_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            input.serialId,
            input.kind,
            segment.segmentIndex,
            segment.startSentenceIndex,
            segment.endSentenceIndex,
            segment.wordsCount,
            segment.text,
            JSON.stringify(segment.vector),
          ],
        );
      }
    });
  }

  public async delete(
    serialId: number,
    kind: IndexArtifactKind,
  ): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#database.run(
        `
          DELETE FROM index_artifact_lexical_rows
          WHERE serial_id = ?
            AND kind = ?
        `,
        [serialId, kind],
      );
      await this.#database.run(
        `
          DELETE FROM index_artifact_embedding_segments
          WHERE serial_id = ?
            AND kind = ?
        `,
        [serialId, kind],
      );
      await this.#database.run(
        `
          DELETE FROM index_artifacts
          WHERE serial_id = ?
            AND kind = ?
        `,
        [serialId, kind],
      );
    });
  }

  public async deleteBySerial(serialId: number): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#database.run(
        `
          DELETE FROM index_artifact_lexical_rows
          WHERE serial_id = ?
        `,
        [serialId],
      );
      await this.#database.run(
        `
          DELETE FROM index_artifact_embedding_segments
          WHERE serial_id = ?
        `,
        [serialId],
      );
      await this.#database.run(
        `
          DELETE FROM index_artifacts
          WHERE serial_id = ?
        `,
        [serialId],
      );
    });
  }

  async #replaceArtifactHeader(input: {
    readonly kind: IndexArtifactKind;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly serialId: number;
    readonly sourceRevision: number;
  }): Promise<void> {
    await this.#database.run(
      `
        INSERT INTO index_artifacts (
          serial_id,
          kind,
          source_revision,
          created_at,
          metadata_json
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(serial_id, kind) DO UPDATE SET
          source_revision = excluded.source_revision,
          created_at = excluded.created_at,
          metadata_json = excluded.metadata_json
      `,
      [
        input.serialId,
        input.kind,
        input.sourceRevision,
        new Date().toISOString(),
        JSON.stringify(input.metadata),
      ],
    );
  }
}

function mapArtifactRow(row: SqlRow): IndexArtifactRecord {
  return {
    createdAt: getString(row, "created_at"),
    kind: parseIndexArtifactKind(getString(row, "kind")),
    metadata: parseJsonObject(getString(row, "metadata_json")),
    serialId: getNumber(row, "serial_id"),
    sourceRevision: getNumber(row, "source_revision"),
  };
}

function mapLexicalRow(row: SqlRow): IndexArtifactLexicalRow {
  const sentenceIndex = getOptionalNumber(row, "sentence_index");

  return {
    metadata: parseJsonObject(getString(row, "metadata_json")),
    objectId: getString(row, "object_id"),
    objectKind: getString(row, "object_kind"),
    rowId: getString(row, "row_id"),
    ...(sentenceIndex === undefined ? {} : { sentenceIndex }),
    text: getString(row, "text"),
    tokens: parseStringArray(getString(row, "tokens_json")),
  };
}

function mapEmbeddingSegmentRow(row: SqlRow): IndexArtifactEmbeddingSegment {
  return {
    endSentenceIndex: getNumber(row, "end_sentence_index"),
    segmentIndex: getNumber(row, "segment_index"),
    startSentenceIndex: getNumber(row, "start_sentence_index"),
    text: getString(row, "text"),
    vector: parseNumberArray(getString(row, "vector_json")),
    wordsCount: getNumber(row, "words_count"),
  };
}

function parseIndexArtifactKind(value: string): IndexArtifactKind {
  if ((INDEX_ARTIFACT_KINDS as readonly string[]).includes(value)) {
    return value as IndexArtifactKind;
  }

  throw new Error(`Unknown index artifact kind: ${value}`);
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

function parseJsonObject(value: string): Readonly<Record<string, unknown>> {
  const parsed = JSON.parse(value) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Expected artifact metadata to be a JSON object");
  }

  return parsed as Readonly<Record<string, unknown>>;
}

function parseStringArray(value: string): readonly string[] {
  const parsed = JSON.parse(value) as unknown;

  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new TypeError("Expected artifact tokens to be a string array");
  }

  return parsed as string[];
}

function parseNumberArray(value: string): readonly number[] {
  const parsed = JSON.parse(value) as unknown;

  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "number")
  ) {
    throw new TypeError("Expected artifact vector to be a number array");
  }

  return parsed as number[];
}

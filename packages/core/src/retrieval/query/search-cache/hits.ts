import { getNumber, getString } from "../../../document/database.js";
import type { SqlBindValue } from "../../../document/database.js";
import type { Database } from "../../../document/index.js";

import type { ArchiveFindHit } from "../view.js";

import { openSearchSessionDatabase } from "./database.js";
import { parseNumberArray } from "./parsing.js";
import { aggregateCachedScores, mergeTopScores } from "./scores.js";
import { SEARCH_EVIDENCE_KIND } from "./types.js";
import type {
  SearchChunkHitInput,
  SearchEvidenceHitEventInput,
  SearchObjectCursorKey,
  SearchEntityHitInput,
  SearchTripleHitInput,
} from "./types.js";

const SINGLE_ARCHIVE_SCOPE_ID = 0;

export async function insertSearchEvidenceHitEvent(
  database: Database,
  sessionId: string,
  event: SearchEvidenceHitEventInput,
): Promise<void> {
  await database.run(
    `
      INSERT OR REPLACE INTO search_evidence_hit_events (
        session_id,
        archive_id,
        evidence_kind,
        evidence_id,
        chapter_id,
        sentence_index,
        score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      sessionId,
      event.archiveId ?? SINGLE_ARCHIVE_SCOPE_ID,
      event.evidenceKind,
      event.evidenceId,
      event.chapterId,
      event.sentenceIndex,
      event.score,
    ],
  );
}

export async function upsertSearchEntityHit(
  database: Database,
  sessionId: string,
  hit: SearchEntityHitInput,
): Promise<void> {
  const current = await database.queryOne(
    `
      SELECT property_top_scores_json, evidence_top_scores_json
      FROM search_entity_hits
      WHERE session_id = ? AND archive_id = ? AND qid = ?
    `,
    [sessionId, hit.archiveId ?? SINGLE_ARCHIVE_SCOPE_ID, hit.qid],
    (row) => ({
      evidenceTopScores: parseNumberArray(
        getString(row, "evidence_top_scores_json"),
      ),
      propertyTopScores: parseNumberArray(
        getString(row, "property_top_scores_json"),
      ),
    }),
  );
  const propertyTopScores = mergeTopScores(
    current?.propertyTopScores ?? [],
    hit.propertyTopScores ?? [],
  );
  const evidenceTopScores = mergeTopScores(
    current?.evidenceTopScores ?? [],
    hit.evidenceTopScores ?? [],
  );
  const propertyScore = aggregateCachedScores(propertyTopScores);
  const evidenceScore = aggregateCachedScores(evidenceTopScores);
  const resultScore = propertyScore + evidenceScore;

  await database.run(
    `
      INSERT INTO search_entity_hits (
        session_id,
        archive_id,
        qid,
        property_top_scores_json,
        evidence_top_scores_json,
        property_score,
        evidence_score,
        result_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, archive_id, qid) DO UPDATE SET
        property_top_scores_json = excluded.property_top_scores_json,
        evidence_top_scores_json = excluded.evidence_top_scores_json,
        property_score = excluded.property_score,
        evidence_score = excluded.evidence_score,
        result_score = excluded.result_score
    `,
    [
      sessionId,
      hit.archiveId ?? SINGLE_ARCHIVE_SCOPE_ID,
      hit.qid,
      JSON.stringify(propertyTopScores),
      JSON.stringify(evidenceTopScores),
      propertyScore,
      evidenceScore,
      resultScore,
    ],
  );
}

export async function upsertSearchTripleHit(
  database: Database,
  sessionId: string,
  hit: SearchTripleHitInput,
): Promise<void> {
  const predicateId = await getOrCreatePredicateId(database, hit.predicate);
  const current = await database.queryOne(
    `
      SELECT evidence_top_scores_json
      FROM search_triple_hits
      WHERE session_id = ?
        AND archive_id = ?
        AND subject_qid = ?
        AND predicate_id = ?
        AND object_qid = ?
    `,
    [
      sessionId,
      hit.archiveId ?? SINGLE_ARCHIVE_SCOPE_ID,
      hit.subjectQid,
      predicateId,
      hit.objectQid,
    ],
    (row) => ({
      evidenceTopScores: parseNumberArray(
        getString(row, "evidence_top_scores_json"),
      ),
    }),
  );
  const evidenceTopScores = mergeTopScores(
    current?.evidenceTopScores ?? [],
    hit.evidenceTopScores,
  );
  const resultScore = aggregateCachedScores(evidenceTopScores);

  await database.run(
    `
      INSERT INTO search_triple_hits (
        session_id,
        archive_id,
        subject_qid,
        predicate_id,
        object_qid,
        evidence_top_scores_json,
        result_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, archive_id, subject_qid, predicate_id, object_qid)
      DO UPDATE SET
        evidence_top_scores_json = excluded.evidence_top_scores_json,
        result_score = excluded.result_score
    `,
    [
      sessionId,
      hit.archiveId ?? SINGLE_ARCHIVE_SCOPE_ID,
      hit.subjectQid,
      predicateId,
      hit.objectQid,
      JSON.stringify(evidenceTopScores),
      resultScore,
    ],
  );
}

export async function upsertSearchChunkHit(
  database: Database,
  sessionId: string,
  hit: SearchChunkHitInput,
): Promise<void> {
  const current = await database.queryOne(
    `
      SELECT property_top_scores_json, evidence_top_scores_json
      FROM search_chunk_hits
      WHERE session_id = ? AND archive_id = ? AND chunk_id = ?
    `,
    [sessionId, hit.archiveId ?? SINGLE_ARCHIVE_SCOPE_ID, hit.chunkId],
    (row) => ({
      evidenceTopScores: parseNumberArray(
        getString(row, "evidence_top_scores_json"),
      ),
      propertyTopScores: parseNumberArray(
        getString(row, "property_top_scores_json"),
      ),
    }),
  );
  const propertyTopScores = mergeTopScores(
    current?.propertyTopScores ?? [],
    hit.propertyTopScores ?? [],
  );
  const evidenceTopScores = mergeTopScores(
    current?.evidenceTopScores ?? [],
    hit.evidenceTopScores ?? [],
  );
  const propertyScore = aggregateCachedScores(propertyTopScores);
  const evidenceScore = aggregateCachedScores(evidenceTopScores);
  const resultScore = propertyScore + evidenceScore;

  await database.run(
    `
      INSERT INTO search_chunk_hits (
        session_id,
        archive_id,
        chunk_id,
        property_top_scores_json,
        evidence_top_scores_json,
        property_score,
        evidence_score,
        result_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, archive_id, chunk_id) DO UPDATE SET
        property_top_scores_json = excluded.property_top_scores_json,
        evidence_top_scores_json = excluded.evidence_top_scores_json,
        property_score = excluded.property_score,
        evidence_score = excluded.evidence_score,
        result_score = excluded.result_score
    `,
    [
      sessionId,
      hit.archiveId ?? SINGLE_ARCHIVE_SCOPE_ID,
      hit.chunkId,
      JSON.stringify(propertyTopScores),
      JSON.stringify(evidenceTopScores),
      propertyScore,
      evidenceScore,
      resultScore,
    ],
  );
}

export async function readEntitySearchEvidenceMentions(
  sessionId: string,
  mentionIds: readonly string[],
  limit: number,
): Promise<readonly { readonly mentionId: string; readonly score: number }[]> {
  if (mentionIds.length === 0) {
    return [];
  }

  const database = await openSearchSessionDatabase();

  try {
    const placeholders = mentionIds.map(() => "?").join(", ");

    return await database.queryAll(
      `
        SELECT
          event.evidence_id AS mention_id,
          event.score AS score
        FROM search_evidence_hit_events AS event
        WHERE event.session_id = ?
          AND event.evidence_kind = ?
          AND event.evidence_id IN (${placeholders})
        ORDER BY event.score DESC, event.archive_id, event.chapter_id,
          event.sentence_index, event.evidence_id
        LIMIT ?
      `,
      [sessionId, SEARCH_EVIDENCE_KIND.mention, ...mentionIds, limit],
      (row) => ({
        mentionId: getString(row, "mention_id"),
        score: getNumber(row, "score"),
      }),
    );
  } finally {
    await database.close();
  }
}

export function mapEntitySearchObjectRow(
  row: Record<string, SqlBindValue>,
): ArchiveFindHit {
  const archiveId = getNumber(row, "archive_id");
  const qid = getString(row, "qid");

  return {
    evidence: {
      nextCursor: null,
      shown: 0,
      sources: [],
      total: 0,
    },
    field: "title",
    id: `wikg://entity/${qid}`,
    ...(archiveId === SINGLE_ARCHIVE_SCOPE_ID ? {} : { archiveId }),
    score: getNumber(row, "result_score"),
    snippet: qid,
    title: qid,
    type: "entity",
  };
}

export async function readSearchSessionEntityBucketRows(
  database: Database,
  sessionId: string,
  after: SearchObjectCursorKey | undefined,
  limit: number,
): Promise<readonly ArchiveFindHit[]> {
  return await database.queryAll(
    `
      SELECT
        archive_id,
        qid,
        result_score
      FROM search_entity_hits
      WHERE session_id = ?
        ${
          after === undefined
            ? ""
            : `
              AND (
                result_score < ?
                OR (
                  result_score = ?
                  AND (
                    archive_id > ?
                    OR (
                      archive_id = ?
                      AND (
                        ? < ?
                        OR (? = ? AND qid > ?)
                      )
                    )
                  )
                )
              )
            `
        }
      ORDER BY result_score DESC, archive_id, qid
      LIMIT ?
    `,
    [
      sessionId,
      ...(after === undefined
        ? []
        : [
            after.score,
            after.score,
            after.archiveId,
            after.archiveId,
            getObjectBucketKindOrder(after.kind),
            SEARCH_OBJECT_BUCKET_KIND.entity,
            getObjectBucketKindOrder(after.kind),
            SEARCH_OBJECT_BUCKET_KIND.entity,
            after.id,
          ]),
      limit,
    ],
    mapEntitySearchObjectRow,
  );
}

export async function readSearchSessionTripleBucketRows(
  database: Database,
  sessionId: string,
  after: SearchObjectCursorKey | undefined,
  limit: number,
): Promise<readonly ArchiveFindHit[]> {
  return await database.queryAll(
    `
      SELECT
        search_triple_hits.archive_id AS archive_id,
        search_triple_hits.subject_qid AS subject_qid,
        predicate_dictionary.value AS predicate,
        search_triple_hits.object_qid AS object_qid,
        search_triple_hits.result_score AS result_score
      FROM search_triple_hits
      JOIN predicate_dictionary
        ON predicate_dictionary.id = search_triple_hits.predicate_id
      WHERE search_triple_hits.session_id = ?
        ${
          after === undefined
            ? ""
            : `
              AND (
                search_triple_hits.result_score < ?
                OR (
                  search_triple_hits.result_score = ?
                  AND (
                    search_triple_hits.archive_id > ?
                    OR (
                      search_triple_hits.archive_id = ?
                      AND (
                        ? < ?
                        OR (
                          ? = ?
                          AND (
                            search_triple_hits.subject_qid || char(31) ||
                            predicate_dictionary.value || char(31) ||
                            search_triple_hits.object_qid
                          ) > ?
                        )
                      )
                    )
                  )
                )
              )
            `
        }
      ORDER BY search_triple_hits.result_score DESC,
        search_triple_hits.archive_id,
        search_triple_hits.subject_qid,
        predicate_dictionary.value,
        search_triple_hits.object_qid
      LIMIT ?
    `,
    [
      sessionId,
      ...(after === undefined
        ? []
        : [
            after.score,
            after.score,
            after.archiveId,
            after.archiveId,
            getObjectBucketKindOrder(after.kind),
            SEARCH_OBJECT_BUCKET_KIND.triple,
            getObjectBucketKindOrder(after.kind),
            SEARCH_OBJECT_BUCKET_KIND.triple,
            after.id,
          ]),
      limit,
    ],
    (row) => {
      const archiveId = getNumber(row, "archive_id");
      const subjectQid = getString(row, "subject_qid");
      const predicate = getString(row, "predicate");
      const objectQid = getString(row, "object_qid");
      const title = `${subjectQid} ${predicate} ${objectQid}`;

      return {
        field: "content",
        id: `wikg://triple/${subjectQid}/${encodeURIComponent(predicate)}/${objectQid}`,
        ...(archiveId === SINGLE_ARCHIVE_SCOPE_ID ? {} : { archiveId }),
        score: getNumber(row, "result_score"),
        snippet: title,
        title,
        triple: {
          objectLabel: objectQid,
          predicate,
          subjectLabel: subjectQid,
        },
        type: "triple",
      };
    },
  );
}

export function compareObjectBucketHits(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
): number {
  return (
    (right.score ?? 0) - (left.score ?? 0) ||
    (left.archiveId ?? SINGLE_ARCHIVE_SCOPE_ID) -
      (right.archiveId ?? SINGLE_ARCHIVE_SCOPE_ID) ||
    getObjectBucketKindOrder(getObjectBucketHitKind(left)) -
      getObjectBucketKindOrder(getObjectBucketHitKind(right)) ||
    getObjectBucketHitKey(left).localeCompare(getObjectBucketHitKey(right))
  );
}

async function getOrCreatePredicateId(
  database: Database,
  predicate: string,
): Promise<number> {
  await database.run(
    `
      INSERT OR IGNORE INTO predicate_dictionary(value)
      VALUES (?)
    `,
    [predicate],
  );
  const id = await database.queryOne(
    `
      SELECT id
      FROM predicate_dictionary
      WHERE value = ?
    `,
    [predicate],
    (row) => getNumber(row, "id"),
  );

  if (id === undefined) {
    throw new Error("Failed to create predicate dictionary entry.");
  }

  return id;
}

const SEARCH_OBJECT_BUCKET_KIND = {
  entity: 1,
  triple: 2,
} as const;

function getObjectBucketHitKind(
  hit: ArchiveFindHit,
): SearchObjectCursorKey["kind"] {
  return hit.type === "triple" ? "triple" : "entity";
}

function getObjectBucketHitKey(hit: ArchiveFindHit): string {
  if (hit.type !== "triple") {
    return hit.id.slice("wikg://entity/".length);
  }

  return [
    hit.triple?.subjectLabel ?? "",
    hit.triple?.predicate ?? "",
    hit.triple?.objectLabel ?? "",
  ].join("\u001f");
}

function getObjectBucketKindOrder(kind: SearchObjectCursorKey["kind"]): number {
  return SEARCH_OBJECT_BUCKET_KIND[kind];
}

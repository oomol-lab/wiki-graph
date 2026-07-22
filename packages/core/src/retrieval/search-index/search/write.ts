import { getNumber, type Database } from "../../../document/database.js";
import { serializeTokens } from "./helpers.js";
import type { SearchTokenPlan } from "./tokenizer.js";
import type {
  SearchObjectPropertyRecordInput,
  TextSentenceRecordInput,
} from "./types.js";

export async function insertTextSentenceRecord(
  database: Database,
  record: TextSentenceRecordInput,
): Promise<number> {
  const rowId = await database.queryOne(
    `
      SELECT id
      FROM text_sentence_records
      WHERE archive_id = ? AND kind = ? AND chapter_id = ? AND sentence_index = ?
    `,
    [record.archiveId, record.kind, record.chapterId, record.sentenceIndex],
    (row) => getNumber(row, "id"),
  );

  if (rowId !== undefined) {
    return rowId;
  }

  await database.run(
    `
      INSERT INTO text_sentence_records (
        archive_id, kind, chapter_id, sentence_index, words_count, byte_offset, byte_length
      )
      VALUES (?, ?, ?, ?, ?, 0, 0)
    `,
    [
      record.archiveId,
      record.kind,
      record.chapterId,
      record.sentenceIndex,
      record.wordsCount,
    ],
  );

  return await database.getLastInsertRowId();
}

export async function insertSearchObjectPropertyRecord(
  database: Database,
  record: SearchObjectPropertyRecordInput,
): Promise<number> {
  await database.run(
    `
      INSERT INTO search_object_properties_records (
        archive_id, owner_kind, owner_id, property_kind, chapter_id
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      record.archiveId,
      record.ownerKind,
      record.ownerId,
      record.propertyKind,
      record.chapterId ?? null,
    ],
  );

  return await database.getLastInsertRowId();
}

export async function insertFtsRecord(
  database: Database,
  table: "search_object_properties_fts" | "text_sentence_fts",
  rowId: number,
  plan: SearchTokenPlan,
): Promise<void> {
  await database.run(
    `
      INSERT INTO ${table}(rowid, tier1, tier2, tier3)
      VALUES (?, ?, ?, ?)
    `,
    [
      rowId,
      serializeTokens(plan.tier1),
      serializeTokens(plan.tier2),
      serializeTokens(plan.tier3),
    ],
  );
}

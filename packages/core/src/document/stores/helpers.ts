import { getNumber, getOptionalString, getString } from "../database.js";
import type { SqlRow } from "../database.js";
import {
  isChunkImportance,
  isChunkRetention,
  type ChunkImportance,
  type ChunkRetention,
  type MentionLinkRecord,
  type MentionRecord,
  type ReadingEdgeRecord,
} from "../types.js";

export const MAX_SQL_BIND_PARAMS = 900;

export function compareNumber(left: number, right: number): number {
  return left - right;
}

export function isSqliteConstraintError(
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

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export function mapReadingEdgeRow(row: SqlRow): ReadingEdgeRecord {
  const strength = getOptionalString(row, "strength");

  return {
    fromId: getNumber(row, "from_id"),
    toId: getNumber(row, "to_id"),
    weight: getNumber(row, "weight"),
    ...(strength === undefined ? {} : { strength }),
  };
}

export function mapMentionRow(row: SqlRow): MentionRecord {
  const sentenceIndex = getOptionalNumber(row, "sentence_index");
  const confidence = getOptionalNumber(row, "confidence");
  const note = getOptionalString(row, "note");

  return {
    chapterId: getNumber(row, "chapter_id"),
    ...(confidence === undefined ? {} : { confidence }),
    id: getString(row, "id"),
    ...(note === undefined ? {} : { note }),
    qid: getString(row, "qid"),
    rangeEnd: getNumber(row, "range_end"),
    rangeStart: getNumber(row, "range_start"),
    ...(sentenceIndex === undefined ? {} : { sentenceIndex }),
    surface: getString(row, "surface"),
  };
}

export function deduplicateById<T extends { readonly id: number }>(
  records: readonly T[],
): T[] {
  const seen = new Set<number>();
  const result: T[] = [];

  for (const record of records) {
    if (seen.has(record.id)) {
      continue;
    }

    seen.add(record.id);
    result.push(record);
  }

  return result;
}

export function mapMentionLinkRow(row: SqlRow): MentionLinkRecord {
  const confidence = getOptionalNumber(row, "confidence");
  const note = getOptionalString(row, "note");

  return {
    ...(confidence === undefined ? {} : { confidence }),
    evidenceSentenceIds: [],
    id: getString(row, "id"),
    ...(note === undefined ? {} : { note }),
    predicate: getString(row, "predicate"),
    sourceMentionId: getString(row, "source_mention_id"),
    targetMentionId: getString(row, "target_mention_id"),
  };
}

export function parseMetadataValue(valueJson: string): unknown {
  try {
    return JSON.parse(valueJson);
  } catch (error) {
    throw new Error(
      `Invalid object metadata JSON: ${formatUnknownError(error)}`,
    );
  }
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

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

export function parseChunkImportance(
  value: string | undefined,
): ChunkImportance | undefined {
  return value !== undefined && isChunkImportance(value) ? value : undefined;
}

export function parseChunkRetention(
  value: string | undefined,
): ChunkRetention | undefined {
  return value !== undefined && isChunkRetention(value) ? value : undefined;
}

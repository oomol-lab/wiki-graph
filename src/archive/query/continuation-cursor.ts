import { randomBytes } from "crypto";
import { join } from "path";

import { resolveWikiGraphCacheDirectoryPath } from "../../common/wiki-graph-dir.js";
import { getOptionalString, getString } from "../../document/database.js";
import { openSharedStateDatabase } from "../../document/index.js";
import type { Database } from "../../document/index.js";

export type ContinuationCursor =
  | {
      readonly archiveKey: string;
      readonly archivePath: string;
      readonly backlinks?: boolean;
      readonly chapters: readonly number[] | null;
      readonly cursor: string;
      readonly evidenceLimit?: number;
      readonly format: "json" | "jsonl" | "text";
      readonly ids: readonly string[] | null;
      readonly kind: "collection";
      readonly order: "doc-asc" | "doc-desc";
      readonly sourceContext?: number;
      readonly triplePattern?: {
        readonly objectQid?: string;
        readonly predicate?: string;
        readonly subjectQid?: string;
      };
      readonly types: readonly string[] | null;
    }
  | {
      readonly archiveKey: string;
      readonly archivePath: string;
      readonly backlinks?: boolean;
      readonly cursor: string;
      readonly evidenceLimit?: number;
      readonly format: "json" | "jsonl" | "text";
      readonly kind: "search";
      readonly query?: string;
      readonly sourceContext?: number;
      readonly triplePattern?: {
        readonly objectQid?: string;
        readonly predicate?: string;
        readonly subjectQid?: string;
      };
      readonly types: readonly string[] | null;
    }
  | {
      readonly archiveKey: string;
      readonly archivePath: string;
      readonly cursor: string;
      readonly format: "json" | "jsonl" | "text";
      readonly kind: "evidence";
      readonly query?: string;
      readonly sourceContext?: number;
      readonly targetUri: string;
    }
  | {
      readonly archiveKey: string;
      readonly archivePath: string;
      readonly cursor: string;
      readonly evidenceLimit?: number;
      readonly format: "json" | "jsonl" | "text";
      readonly kind: "related";
      readonly query?: string;
      readonly role?: "any" | "object" | "self" | "subject";
      readonly sourceContext?: number;
      readonly targetUri: string;
    };

const CONTINUATION_CURSOR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS continuation_cursors (
  cursor_id TEXT PRIMARY KEY,
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  format TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_continuation_cursors_expires
ON continuation_cursors(expires_at);
`;

const CURSOR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createContinuationCursor(
  input: ContinuationCursor,
): Promise<string> {
  const database = await openContinuationCursorDatabase();

  try {
    await cleanExpiredContinuationCursors(database);

    const now = Date.now();
    const cursorId = await createUniqueCursorId(database);

    await database.run(
      `
        INSERT INTO continuation_cursors (
          cursor_id, archive_key, archive_path, kind, payload_json, format,
          limit_value, created_at, expires_at, accessed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cursorId,
        input.archiveKey,
        input.archivePath,
        input.kind,
        JSON.stringify(createCursorPayload(input)),
        input.format,
        1,
        now,
        now + CURSOR_TTL_MS,
        now,
      ],
    );

    return cursorId;
  } finally {
    await database.close();
  }
}

export async function readContinuationCursor(
  cursorId: string,
): Promise<ContinuationCursor> {
  const database = await openContinuationCursorDatabase();

  try {
    await cleanExpiredContinuationCursors(database);

    const record = await database.queryOne(
      `
        SELECT archive_key, archive_path, kind, payload_json, format
        FROM continuation_cursors
        WHERE cursor_id = ?
      `,
      [cursorId],
      (row) => ({
        archiveKey: getString(row, "archive_key"),
        archivePath: getString(row, "archive_path"),
        format: parseCursorFormat(getString(row, "format")),
        kind: getString(row, "kind"),
        payloadJSON: getString(row, "payload_json"),
      }),
    );

    if (record === undefined) {
      throw new Error(
        `Continuation cursor ${cursorId} was not found or has expired.`,
      );
    }

    await database.run(
      "UPDATE continuation_cursors SET accessed_at = ? WHERE cursor_id = ?",
      [Date.now(), cursorId],
    );

    return parseContinuationCursorRecord(record);
  } finally {
    await database.close();
  }
}

function createCursorPayload(input: ContinuationCursor): object {
  switch (input.kind) {
    case "collection":
      return {
        ...(input.backlinks === undefined
          ? {}
          : { backlinks: input.backlinks }),
        chapters: input.chapters,
        cursor: input.cursor,
        ...(input.evidenceLimit === undefined
          ? {}
          : { evidenceLimit: input.evidenceLimit }),
        ids: input.ids,
        order: input.order,
        ...(input.sourceContext === undefined
          ? {}
          : { sourceContext: input.sourceContext }),
        ...(input.triplePattern === undefined
          ? {}
          : { triplePattern: input.triplePattern }),
        types: input.types,
      };
    case "search":
      return {
        ...(input.backlinks === undefined
          ? {}
          : { backlinks: input.backlinks }),
        cursor: input.cursor,
        ...(input.evidenceLimit === undefined
          ? {}
          : { evidenceLimit: input.evidenceLimit }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.sourceContext === undefined
          ? {}
          : { sourceContext: input.sourceContext }),
        ...(input.triplePattern === undefined
          ? {}
          : { triplePattern: input.triplePattern }),
        types: input.types,
      };
    case "evidence":
      return {
        cursor: input.cursor,
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.sourceContext === undefined
          ? {}
          : { sourceContext: input.sourceContext }),
        targetUri: input.targetUri,
      };
    case "related":
      return {
        cursor: input.cursor,
        ...(input.evidenceLimit === undefined
          ? {}
          : { evidenceLimit: input.evidenceLimit }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.sourceContext === undefined
          ? {}
          : { sourceContext: input.sourceContext }),
        targetUri: input.targetUri,
      };
  }
}

function parseContinuationCursorRecord(record: {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly format: "json" | "jsonl" | "text";
  readonly kind: string;
  readonly payloadJSON: string;
}): ContinuationCursor {
  const payload = parsePayload(record.payloadJSON);

  if (record.kind === "collection") {
    return {
      archiveKey: record.archiveKey,
      archivePath: record.archivePath,
      ...getPayloadOptionalBoolean(payload, "backlinks"),
      chapters: getPayloadNumberArrayOrNull(payload, "chapters"),
      cursor: getPayloadString(payload, "cursor"),
      ...getPayloadOptionalPositiveInteger(payload, "evidenceLimit"),
      format: record.format,
      ids: getPayloadStringArrayOrNull(payload, "ids"),
      kind: "collection",
      order: getPayloadOrder(payload),
      ...getPayloadOptionalInteger(payload, "sourceContext", "sourceContext"),
      ...getPayloadOptionalTriplePattern(payload),
      types: getPayloadStringArrayOrNull(payload, "types"),
    };
  }

  if (record.kind === "search") {
    return {
      archiveKey: record.archiveKey,
      archivePath: record.archivePath,
      ...getPayloadOptionalBoolean(payload, "backlinks"),
      cursor: getPayloadString(payload, "cursor"),
      ...getPayloadOptionalPositiveInteger(payload, "evidenceLimit"),
      format: record.format,
      kind: "search",
      ...getPayloadOptionalString(payload, "query"),
      ...getPayloadOptionalInteger(payload, "sourceContext", "sourceContext"),
      ...getPayloadOptionalTriplePattern(payload),
      types: getPayloadStringArrayOrNull(payload, "types"),
    };
  }

  if (record.kind === "evidence") {
    return {
      archiveKey: record.archiveKey,
      archivePath: record.archivePath,
      cursor: getPayloadString(payload, "cursor"),
      format: record.format,
      kind: "evidence",
      ...getPayloadOptionalString(payload, "query"),
      ...getPayloadOptionalInteger(payload, "sourceContext", "sourceContext"),
      targetUri: getPayloadString(payload, "targetUri"),
    };
  }

  if (record.kind === "related") {
    return {
      archiveKey: record.archiveKey,
      archivePath: record.archivePath,
      cursor: getPayloadString(payload, "cursor"),
      ...getPayloadOptionalPositiveInteger(payload, "evidenceLimit"),
      format: record.format,
      kind: "related",
      ...getPayloadOptionalString(payload, "query"),
      ...getPayloadOptionalRelatedRole(payload),
      ...getPayloadOptionalInteger(payload, "sourceContext", "sourceContext"),
      targetUri: getPayloadString(payload, "targetUri"),
    };
  }

  throw new Error(`Invalid continuation cursor kind: ${record.kind}.`);
}

function parsePayload(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadString(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = payload[key];

  if (typeof value === "string") {
    return value;
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadStringArrayOrNull(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | null {
  const value = payload[key];

  if (value === null) {
    return null;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadOptionalString(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): { readonly query?: string } {
  const value = payload[key];

  if (value === undefined) {
    return {};
  }
  if (typeof value === "string") {
    return { query: value };
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadNumberArrayOrNull(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): readonly number[] | null {
  const value = payload[key];

  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    const numbers: number[] = [];

    for (const item of value) {
      if (typeof item !== "number" || !Number.isInteger(item)) {
        throw new Error("Invalid continuation cursor payload.");
      }
      numbers.push(item);
    }

    return numbers;
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadOrder(
  payload: Readonly<Record<string, unknown>>,
): "doc-asc" | "doc-desc" {
  const value = payload.order;

  if (value === "doc-asc" || value === "doc-desc") {
    return value;
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadOptionalPositiveInteger(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): { readonly evidenceLimit?: number } {
  const value = payload[key];

  if (value === undefined) {
    return {};
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return { evidenceLimit: value };
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadOptionalInteger<K extends string>(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  outputKey: K,
): { readonly [P in K]?: number } {
  const value = payload[key];

  if (value === undefined) {
    return {};
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return { [outputKey]: value } as { readonly [P in K]?: number };
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadOptionalBoolean(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): { readonly backlinks?: boolean } {
  const value = payload[key];

  if (value === undefined) {
    return {};
  }
  if (typeof value === "boolean") {
    return { backlinks: value };
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadOptionalRelatedRole(
  payload: Readonly<Record<string, unknown>>,
): { readonly role?: "any" | "object" | "self" | "subject" } {
  const value = payload.role;

  if (value === undefined) {
    return {};
  }
  if (
    value === "any" ||
    value === "object" ||
    value === "self" ||
    value === "subject"
  ) {
    return { role: value };
  }

  throw new Error("Invalid continuation cursor payload.");
}

function getPayloadOptionalTriplePattern(
  payload: Readonly<Record<string, unknown>>,
): {
  readonly triplePattern?: {
    readonly objectQid?: string;
    readonly predicate?: string;
    readonly subjectQid?: string;
  };
} {
  const value = payload.triplePattern;

  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid continuation cursor payload.");
  }

  const pattern = value as Record<string, unknown>;
  const subjectQid = getOptionalPayloadStringProperty(pattern, "subjectQid");
  const predicate = getOptionalPayloadStringProperty(pattern, "predicate");
  const objectQid = getOptionalPayloadStringProperty(pattern, "objectQid");

  return {
    triplePattern: {
      ...(objectQid === undefined ? {} : { objectQid }),
      ...(predicate === undefined ? {} : { predicate }),
      ...(subjectQid === undefined ? {} : { subjectQid }),
    },
  };
}

function getOptionalPayloadStringProperty(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = payload[key];

  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }

  throw new Error("Invalid continuation cursor payload.");
}

async function createUniqueCursorId(database: Database): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const cursorId = `c_${randomBytes(6).toString("base64url")}`;
    const existing = await database.queryOne(
      "SELECT cursor_id FROM continuation_cursors WHERE cursor_id = ?",
      [cursorId],
      (row) => getOptionalString(row, "cursor_id"),
    );

    if (existing === undefined) {
      return cursorId;
    }
  }

  throw new Error("Failed to create a unique continuation cursor.");
}

async function cleanExpiredContinuationCursors(
  database: Database,
): Promise<void> {
  await database.run("DELETE FROM continuation_cursors WHERE expires_at < ?", [
    Date.now(),
  ]);
}

async function openContinuationCursorDatabase(): Promise<Database> {
  return await openSharedStateDatabase(
    join(getContinuationStateDirectoryPath(), "continuation-cursors.sqlite"),
    CONTINUATION_CURSOR_SCHEMA_SQL,
  );
}

function getContinuationStateDirectoryPath(): string {
  return resolveWikiGraphCacheDirectoryPath();
}

function parseCursorFormat(value: string): "json" | "jsonl" | "text" {
  if (value === "json" || value === "jsonl" || value === "text") {
    return value;
  }

  throw new Error(`Invalid continuation cursor format: ${value}.`);
}

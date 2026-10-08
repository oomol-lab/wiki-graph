import type { ContinuationCursor, QueryIndexScope } from "./types.js";

export function createCursorPayload(input: ContinuationCursor): object {
  const version = { v: 2 } as const;
  switch (input.kind) {
    case "source-locators":
      return {
        ...version,
        cursor: input.cursor,
        indexScope: input.indexScope,
        targetUri: input.targetUri,
      };
    case "collection":
      return {
        ...version,
        ...(input.backlinks === undefined
          ? {}
          : { backlinks: input.backlinks }),
        chapters: input.chapters,
        cursor: input.cursor,
        ...(input.evidenceLimit === undefined
          ? {}
          : { evidenceLimit: input.evidenceLimit }),
        ids: input.ids,
        ...(input.libraryQuery === undefined
          ? {}
          : { libraryQuery: input.libraryQuery }),
        order: input.order,
        ...(input.sourceContext === undefined
          ? {}
          : { sourceContext: input.sourceContext }),
        ...(input.triplePattern === undefined
          ? {}
          : { triplePattern: input.triplePattern }),
        indexScope: input.indexScope,
        types: input.types,
      };
    case "search":
      return {
        ...version,
        ...(input.backlinks === undefined
          ? {}
          : { backlinks: input.backlinks }),
        chapters: input.chapters,
        cursor: input.cursor,
        ...(input.evidenceLimit === undefined
          ? {}
          : { evidenceLimit: input.evidenceLimit }),
        ...(input.libraryQuery === undefined
          ? {}
          : { libraryQuery: input.libraryQuery }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.queryMode === undefined
          ? {}
          : { queryMode: input.queryMode }),
        ...(input.skipUnindexed === undefined
          ? {}
          : { skipUnindexed: input.skipUnindexed }),
        ...(input.sourceContext === undefined
          ? {}
          : { sourceContext: input.sourceContext }),
        ...(input.triplePattern === undefined
          ? {}
          : { triplePattern: input.triplePattern }),
        indexScope: input.indexScope,
        types: input.types,
      };
    case "evidence":
      return {
        ...version,
        chapters: input.chapters,
        cursor: input.cursor,
        order: input.order,
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.queryMode === undefined
          ? {}
          : { queryMode: input.queryMode }),
        ...(input.skipUnindexed === undefined
          ? {}
          : { skipUnindexed: input.skipUnindexed }),
        ...(input.sourceContext === undefined
          ? {}
          : { sourceContext: input.sourceContext }),
        indexScope: input.indexScope,
        targetUri: input.targetUri,
      };
    case "related":
      return {
        ...version,
        chapters: input.chapters,
        cursor: input.cursor,
        ...(input.evidenceLimit === undefined
          ? {}
          : { evidenceLimit: input.evidenceLimit }),
        order: input.order,
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.queryMode === undefined
          ? {}
          : { queryMode: input.queryMode }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.skipUnindexed === undefined
          ? {}
          : { skipUnindexed: input.skipUnindexed }),
        ...(input.sourceContext === undefined
          ? {}
          : { sourceContext: input.sourceContext }),
        indexScope: input.indexScope,
        targetUri: input.targetUri,
      };
  }
}

export function parseContinuationCursorRecord(record: {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly format: "json" | "jsonl" | "text";
  readonly kind: string;
  readonly payloadJSON: string;
}): ContinuationCursor {
  const payload = parsePayload(record.payloadJSON);
  const indexScope = readCursorIndexScope(payload, record);

  if (record.kind === "source-locators") {
    return {
      archiveKey: record.archiveKey,
      archivePath: record.archivePath,
      cursor: getPayloadString(payload, "cursor"),
      format: record.format,
      indexScope,
      kind: "source-locators",
      targetUri: getPayloadString(payload, "targetUri"),
    };
  }

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
      indexScope,
      kind: "collection",
      ...getPayloadOptionalLibraryQuery(payload),
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
      chapters: getPayloadNumberArrayOrNull(payload, "chapters"),
      cursor: getPayloadString(payload, "cursor"),
      ...getPayloadOptionalPositiveInteger(payload, "evidenceLimit"),
      format: record.format,
      indexScope,
      kind: "search",
      ...getPayloadOptionalLibraryQuery(payload),
      ...getPayloadOptionalString(payload, "query"),
      ...getPayloadOptionalQueryMode(payload),
      ...getPayloadOptionalBoolean(payload, "skipUnindexed"),
      ...getPayloadOptionalInteger(payload, "sourceContext", "sourceContext"),
      ...getPayloadOptionalTriplePattern(payload),
      types: getPayloadStringArrayOrNull(payload, "types"),
    };
  }

  if (record.kind === "evidence") {
    return {
      archiveKey: record.archiveKey,
      archivePath: record.archivePath,
      chapters: getPayloadNumberArrayOrNull(payload, "chapters"),
      cursor: getPayloadString(payload, "cursor"),
      format: record.format,
      indexScope,
      kind: "evidence",
      order: getPayloadOrder(payload),
      ...getPayloadOptionalString(payload, "query"),
      ...getPayloadOptionalQueryMode(payload),
      ...getPayloadOptionalBoolean(payload, "skipUnindexed"),
      ...getPayloadOptionalInteger(payload, "sourceContext", "sourceContext"),
      targetUri: getPayloadString(payload, "targetUri"),
    };
  }

  if (record.kind === "related") {
    return {
      archiveKey: record.archiveKey,
      archivePath: record.archivePath,
      chapters: getPayloadNumberArrayOrNull(payload, "chapters"),
      cursor: getPayloadString(payload, "cursor"),
      ...getPayloadOptionalPositiveInteger(payload, "evidenceLimit"),
      format: record.format,
      indexScope,
      kind: "related",
      order: getPayloadOrder(payload),
      ...getPayloadOptionalString(payload, "query"),
      ...getPayloadOptionalQueryMode(payload),
      ...getPayloadOptionalRelatedRole(payload),
      ...getPayloadOptionalBoolean(payload, "skipUnindexed"),
      ...getPayloadOptionalInteger(payload, "sourceContext", "sourceContext"),
      targetUri: getPayloadString(payload, "targetUri"),
    };
  }

  throw new Error(`Invalid continuation cursor kind: ${record.kind}.`);
}

function readCursorIndexScope(
  payload: Readonly<Record<string, unknown>>,
  record: { readonly archiveKey: string; readonly archivePath: string },
): QueryIndexScope {
  const value = payload.indexScope;

  if (value === undefined) {
    return {
      archiveKey: record.archiveKey,
      archivePath: record.archivePath,
      kind: "archive-index",
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid continuation cursor payload.");
  }

  const indexScope = value as Record<string, unknown>;
  if (indexScope.kind === "archive-index") {
    const archiveKey = getPayloadString(indexScope, "archiveKey");
    const archivePath = getPayloadString(indexScope, "archivePath");
    if (
      archiveKey !== record.archiveKey ||
      archivePath !== record.archivePath
    ) {
      throw new Error("Invalid continuation cursor payload.");
    }
    return {
      archiveKey,
      archivePath,
      kind: "archive-index",
    };
  }
  if (indexScope.kind === "library-index") {
    const libraryId = indexScope.libraryId;
    if (typeof libraryId === "number" && Number.isInteger(libraryId)) {
      return { kind: "library-index", libraryId };
    }
  }

  throw new Error("Invalid continuation cursor payload.");
}

function parsePayload(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    "v" in parsed &&
    parsed.v === 2
  ) {
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

function getPayloadOptionalQueryMode(
  payload: Readonly<Record<string, unknown>>,
): {
  readonly queryMode?: import("../../search-index/index.js").SearchIndexQueryMode;
} {
  const value = payload.queryMode;
  if (value === undefined) return {};
  if (value === "hybrid" || value === "fts" || value === "embedding") {
    return { queryMode: value };
  }
  throw new Error("Invalid continuation cursor query mode.");
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

  if (value === undefined || value === null) {
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

function getPayloadOptionalBoolean<Key extends string>(
  payload: Readonly<Record<string, unknown>>,
  key: Key,
): { readonly [Property in Key]?: boolean } {
  const value = payload[key];

  if (value === undefined) {
    return {};
  }
  if (typeof value === "boolean") {
    return { [key]: value } as { readonly [Property in Key]?: boolean };
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

function getPayloadOptionalLibraryQuery(
  payload: Readonly<Record<string, unknown>>,
): { readonly libraryQuery?: "archive-members" | "objects" } {
  const value = payload.libraryQuery;
  if (value === undefined) return {};
  if (value === "archive-members" || value === "objects") {
    return { libraryQuery: value };
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

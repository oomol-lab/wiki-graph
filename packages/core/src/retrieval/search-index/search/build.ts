import type { Database } from "../../../document/database.js";
import type { Document } from "../../../document/index.js";
import { createSearchTokenPlan } from "./tokenizer.js";
import { createSearchIndexFingerprint } from "./fingerprint.js";
import {
  insertFtsRecord,
  insertTextEmbeddingSegment,
  insertSearchObjectPropertyRecord,
} from "./write.js";
import type {
  SearchIndexBuildOptions,
  SearchIndexEmbeddingProvider,
  SearchIndexInput,
  SearchIndexProgressReporter,
  SearchIndexSelection,
  SearchIndexStoredEmbeddingState,
  TextSentenceRecordInput,
} from "./types.js";
import {
  DENSE_SEGMENT_MAX_WORDS,
  DENSE_SEGMENT_MIN_WORDS,
  DENSE_SEGMENT_OVERLAP_WORDS,
  DENSE_SEGMENT_TARGET_WORDS,
  SEARCH_INDEX_VERSION,
} from "./types.js";

export type ArchiveIndexProjection = SearchIndexInput;
export type SearchIndexWriteBatch = SearchIndexInput;
export interface SearchIndexWriteCounters {
  readonly denseDone: number;
  readonly denseDimensions?: number;
  readonly denseRecords: TextSentenceRecordInput[];
  readonly objectDone: number;
  readonly textDone: number;
}

const DENSE_RECORD_FLUSH_THRESHOLD = 2000;

export async function writeArchiveIndexProjection(
  document: Document,
  projection: ArchiveIndexProjection,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions = {},
): Promise<void> {
  await replaceSearchIndex(
    document,
    (async function* (): AsyncIterable<SearchIndexWriteBatch> {
      await Promise.resolve();
      yield projection;
    })(),
    createSearchIndexFingerprint(projection),
    progress,
    options,
  );
}

export async function ensureSearchIndex(
  document: Document,
  input: SearchIndexInput,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions = {},
): Promise<void> {
  await replaceSearchIndex(
    document,
    (async function* (): AsyncIterable<SearchIndexWriteBatch> {
      await Promise.resolve();
      yield input;
    })(),
    createSearchIndexFingerprint(input),
    progress,
    options,
  );
}

export async function replaceSearchIndex(
  document: Document,
  batches: AsyncIterable<SearchIndexWriteBatch>,
  fingerprint: string,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions = {},
): Promise<void> {
  const chaptersRevision = await document.serials.getChaptersRevision();
  const resolved = resolveSearchIndexBuildOptions(options);

  await document.writeSearchIndexDatabase(async (database) => {
    await prepareSearchIndexReplacement(database, progress);

    let counters: SearchIndexWriteCounters = {
      denseDone: 0,
      denseRecords: [],
      objectDone: 0,
      textDone: 0,
    };
    for await (const batch of batches) {
      counters = await writeSearchIndexBatch(
        database,
        batch,
        counters,
        progress,
        resolved,
      );
    }
    counters = await writeSearchIndexDenseSegments(
      database,
      counters,
      progress,
      resolved,
    );

    await finalizeSearchIndexReplacement(
      database,
      fingerprint,
      chaptersRevision,
      progress,
      resolved.indexes,
      resolved,
    );
  });
}

export async function prepareSearchIndexReplacement(
  database: Database,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  await database.transaction(async () => {
    await progress?.({ phase: "clearing" });
    await database.run("DELETE FROM text_sentence_fts");
    await database.run("DELETE FROM text_embedding_segments");
    await database.run("DELETE FROM search_object_properties_fts");
    await database.run("DELETE FROM text_sentence_records");
    await database.run("DELETE FROM search_object_properties_records");
    await database.run("DELETE FROM index_dirty_chapters");
    await database.run("DELETE FROM search_index_state");
    await database.run("DROP TABLE IF EXISTS archive_query_chapters");
    await database.run(
      `
        INSERT INTO index_dirty_chapters(archive_id, chapter_id, updated_at)
        VALUES (0, 0, ?)
      `,
      [Date.now()],
    );
  });
}

export async function writeSearchIndexBatch(
  database: Database,
  batch: SearchIndexWriteBatch,
  counters: SearchIndexWriteCounters,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions = {},
): Promise<SearchIndexWriteCounters> {
  const resolved = resolveSearchIndexBuildOptions(options);
  const denseRecords = counters.denseRecords;
  const { denseDimensions, denseDone } = counters;
  let { objectDone, textDone } = counters;

  await database.transaction(async () => {
    for (const record of batch.textSentences) {
      const rowId = await insertReplacementTextSentenceRecord(database, record);

      if (resolved.indexes !== "dense") {
        await insertFtsRecord(
          database,
          "text_sentence_fts",
          rowId,
          createSearchTokenPlan(record.text),
        );
      }
      if (resolved.indexes !== "fts") {
        denseRecords.push(record);
      }
      textDone += 1;
      await progress?.({
        done: textDone,
        phase: "indexing-text",
        unit: "sentence",
      });
    }

    if (resolved.indexes !== "dense") {
      for (const record of batch.objectProperties) {
        const plan = createSearchTokenPlan(record.text);
        const rowId = await insertSearchObjectPropertyRecord(database, record);

        await insertFtsRecord(
          database,
          "search_object_properties_fts",
          rowId,
          plan,
        );
        objectDone += 1;
        await progress?.({
          done: objectDone,
          phase: "indexing-objects",
          unit: "object",
        });
      }
    }
  });

  const nextDenseDone = await writePendingDenseRecords(database, denseRecords, {
    ...(denseDimensions === undefined ? {} : { denseDimensions }),
    doneOffset: denseDone,
    ...(resolved.indexes === "fts"
      ? {}
      : { embeddingProvider: resolved.embeddingProvider }),
    force: false,
    ...(progress === undefined ? {} : { progress }),
  });

  return {
    ...nextDenseDone,
    denseRecords,
    objectDone,
    textDone,
  };
}

export async function writeSearchIndexDenseSegments(
  database: Database,
  counters: SearchIndexWriteCounters,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions = {},
): Promise<SearchIndexWriteCounters> {
  const resolved = resolveSearchIndexBuildOptions(options);

  if (resolved.indexes === "fts" || counters.denseRecords.length === 0) {
    return counters;
  }

  const denseDone = await writePendingDenseRecords(
    database,
    counters.denseRecords,
    {
      ...(counters.denseDimensions === undefined
        ? {}
        : { denseDimensions: counters.denseDimensions }),
      doneOffset: counters.denseDone,
      embeddingProvider: resolved.embeddingProvider,
      force: true,
      ...(progress === undefined ? {} : { progress }),
    },
  );

  return { ...counters, ...denseDone };
}

async function writePendingDenseRecords(
  database: Database,
  denseRecords: TextSentenceEmbeddingInput[],
  input: {
    readonly denseDimensions?: number;
    readonly doneOffset: number;
    readonly embeddingProvider?: SearchIndexEmbeddingProvider;
    readonly force: boolean;
    readonly progress?: SearchIndexProgressReporter;
  },
): Promise<{
  readonly denseDimensions?: number;
  readonly denseDone: number;
}> {
  const doneOffset = input.doneOffset;

  if (
    input.embeddingProvider === undefined ||
    denseRecords.length === 0 ||
    (!input.force && denseRecords.length < DENSE_RECORD_FLUSH_THRESHOLD)
  ) {
    return {
      ...(input.denseDimensions === undefined
        ? {}
        : { denseDimensions: input.denseDimensions }),
      denseDone: doneOffset,
    };
  }
  const writeCount = input.force
    ? denseRecords.length
    : findCompletedDenseRecordFlushCount(denseRecords);

  if (writeCount === 0) {
    return {
      ...(input.denseDimensions === undefined
        ? {}
        : { denseDimensions: input.denseDimensions }),
      denseDone: doneOffset,
    };
  }

  const result = await writeTextEmbeddingSegments(
    database,
    denseRecords.slice(0, writeCount),
    {
      doneOffset,
      embeddingProvider: input.embeddingProvider,
      ...(input.denseDimensions === undefined
        ? {}
        : { expectedDimensions: input.denseDimensions }),
      ...(input.progress === undefined ? {} : { progress: input.progress }),
    },
  );

  denseRecords.splice(0, writeCount);
  return {
    ...(result.dimensions === undefined
      ? {}
      : { denseDimensions: result.dimensions }),
    denseDone: result.done,
  };
}

function findCompletedDenseRecordFlushCount(
  records: readonly TextSentenceEmbeddingInput[],
): number {
  const last = records.at(-1);

  if (last === undefined) {
    return 0;
  }

  const lastGroupKey = createTextEmbeddingGroupKey(last);

  for (let index = records.length - 2; index >= 0; index -= 1) {
    if (createTextEmbeddingGroupKey(records[index]!) !== lastGroupKey) {
      return index + 1;
    }
  }

  return 0;
}

async function insertReplacementTextSentenceRecord(
  database: Database,
  record: SearchIndexWriteBatch["textSentences"][number],
): Promise<number> {
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

export async function finalizeSearchIndexReplacement(
  database: Database,
  fingerprint: string,
  chaptersRevision: number,
  progress?: SearchIndexProgressReporter,
  indexes?: SearchIndexSelection,
  options: SearchIndexBuildOptions = {},
): Promise<void> {
  const resolved = resolveSearchIndexBuildOptions(
    indexes === undefined ? options : { ...options, indexes },
  );

  await database.transaction(async () => {
    await progress?.({ phase: "finalizing" });
    await database.run("DELETE FROM index_dirty_chapters");
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('version', ?)
      `,
      [SEARCH_INDEX_VERSION],
    );
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('fingerprint', ?)
      `,
      [fingerprint],
    );
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('chaptersRevision', ?)
      `,
      [String(chaptersRevision)],
    );
    await writeSearchIndexBuildState(database, resolved.indexes, resolved);
  });
}

export async function finalizeStoredSearchIndexReplacement(
  database: Database,
  input: {
    readonly chaptersRevision: number;
    readonly embedding?: SearchIndexStoredEmbeddingState;
    readonly fingerprint: string;
    readonly hasFts: boolean;
    readonly progress?: SearchIndexProgressReporter;
  },
): Promise<void> {
  await database.transaction(async () => {
    await input.progress?.({ phase: "finalizing" });
    await database.run("DELETE FROM index_dirty_chapters");
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('version', ?)
      `,
      [SEARCH_INDEX_VERSION],
    );
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('fingerprint', ?)
      `,
      [input.fingerprint],
    );
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('chaptersRevision', ?)
      `,
      [String(input.chaptersRevision)],
    );
    await writeStoredSearchIndexBuildState(database, input);
  });
}

type ResolvedSearchIndexBuildOptions =
  | {
      readonly indexes: "fts";
    }
  | {
      readonly embeddingProvider: SearchIndexEmbeddingProvider;
      readonly indexes: "dense" | "fts,dense";
    };

function resolveSearchIndexBuildOptions(
  options: SearchIndexBuildOptions,
): ResolvedSearchIndexBuildOptions {
  switch (options.indexes ?? "auto") {
    case "dense": {
      if (options.embeddingProvider === undefined) {
        throw new Error(
          "Embeddings configuration is required to build a Dense search index.",
        );
      }
      return {
        embeddingProvider: options.embeddingProvider,
        indexes: "dense",
      };
    }
    case "fts":
      return { indexes: "fts" };
    case "fts,dense": {
      if (options.embeddingProvider === undefined) {
        throw new Error(
          "Embeddings configuration is required to build an FTS + Dense search index.",
        );
      }
      return {
        embeddingProvider: options.embeddingProvider,
        indexes: "fts,dense",
      };
    }
    case "auto":
      return options.embeddingProvider === undefined
        ? { indexes: "fts" }
        : {
            embeddingProvider: options.embeddingProvider,
            indexes: "fts,dense",
          };
  }
}

type TextSentenceEmbeddingInput = SearchIndexInput["textSentences"][number];

interface TextEmbeddingSegmentInput {
  readonly archiveId: number;
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly kind: TextSentenceEmbeddingInput["kind"];
  readonly startSentenceIndex: number;
  readonly text: string;
  readonly wordsCount: number;
}

async function writeTextEmbeddingSegments(
  database: Database,
  records: readonly TextSentenceEmbeddingInput[],
  input: {
    readonly doneOffset: number;
    readonly embeddingProvider: SearchIndexEmbeddingProvider;
    readonly expectedDimensions?: number;
    readonly progress?: SearchIndexProgressReporter;
  },
): Promise<{ readonly dimensions?: number; readonly done: number }> {
  const segments = createTextEmbeddingSegments(records);

  if (segments.length === 0) {
    return {
      ...(input.expectedDimensions === undefined
        ? {}
        : { dimensions: input.expectedDimensions }),
      done: input.doneOffset,
    };
  }

  const result = await input.embeddingProvider.embedTexts(
    segments.map((segment) => segment.text),
  );

  if (result.embeddings.length !== segments.length) {
    throw new Error(
      `Embedding provider returned ${result.embeddings.length} vectors for ${segments.length} texts.`,
    );
  }

  const expectedDimensions =
    input.expectedDimensions ??
    input.embeddingProvider.dimensions ??
    result.embeddings[0]?.length;

  if (expectedDimensions === undefined || expectedDimensions <= 0) {
    throw new Error("Embedding provider returned no usable vector dimensions.");
  }

  let done = input.doneOffset;
  for (const [index, segment] of segments.entries()) {
    const vector = result.embeddings[index]!;

    if (vector.length !== expectedDimensions) {
      throw new Error(
        `Embedding provider returned ${vector.length} dimensions; expected ${expectedDimensions}.`,
      );
    }

    await insertTextEmbeddingSegment(database, {
      archiveId: segment.archiveId,
      chapterId: segment.chapterId,
      dimensions: expectedDimensions,
      endSentenceIndex: segment.endSentenceIndex,
      kind: segment.kind,
      model: input.embeddingProvider.model,
      startSentenceIndex: segment.startSentenceIndex,
      vector,
      wordsCount: segment.wordsCount,
    });
    done += 1;
    await input.progress?.({
      done,
      phase: "indexing-dense",
      unit: "vector",
    });
  }

  return { dimensions: expectedDimensions, done };
}

function createTextEmbeddingSegments(
  records: readonly TextSentenceEmbeddingInput[],
): readonly TextEmbeddingSegmentInput[] {
  const groups = new Map<string, TextSentenceEmbeddingInput[]>();

  for (const record of records) {
    if (record.text.trim() === "") {
      continue;
    }
    const key = createTextEmbeddingGroupKey(record);
    const group = groups.get(key) ?? [];

    group.push(record);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap((group) =>
    createTextEmbeddingSegmentsForGroup(group),
  );
}

function createTextEmbeddingGroupKey(
  record: TextSentenceEmbeddingInput,
): string {
  return [record.archiveId, record.kind, record.chapterId].join(":");
}

function createTextEmbeddingSegmentsForGroup(
  records: readonly TextSentenceEmbeddingInput[],
): readonly TextEmbeddingSegmentInput[] {
  assertDenseSegmentConstants();
  const sorted = [...records].sort(
    (left, right) => left.sentenceIndex - right.sentenceIndex,
  );
  const segments: TextEmbeddingSegmentInput[] = [];
  let start = 0;

  while (start < sorted.length) {
    let end = start;
    let wordsCount = 0;

    while (end < sorted.length) {
      const nextWords = requireNonNegativeWordsCount(sorted[end]!.wordsCount);

      if (
        end > start &&
        wordsCount >= DENSE_SEGMENT_MIN_WORDS &&
        wordsCount + nextWords > DENSE_SEGMENT_MAX_WORDS
      ) {
        break;
      }
      wordsCount += nextWords;
      end += 1;
      if (wordsCount >= DENSE_SEGMENT_TARGET_WORDS) {
        break;
      }
    }

    const segmentRecords = sorted.slice(start, end);
    const segment = createTextEmbeddingSegment(segmentRecords, wordsCount);

    if (segment.wordsCount < DENSE_SEGMENT_MIN_WORDS && segments.length > 0) {
      const previous = segments.pop()!;

      segments.push(
        createTextEmbeddingSegment(
          sorted.filter(
            (record) =>
              record.sentenceIndex >= previous.startSentenceIndex &&
              record.sentenceIndex <= segment.endSentenceIndex,
          ),
        ),
      );
      break;
    }

    segments.push(segment);

    if (end >= sorted.length) {
      break;
    }
    const nextStart = findSegmentOverlapStart(sorted, start, end);

    start = nextStart <= start ? end : nextStart;
  }

  return segments;
}

function assertDenseSegmentConstants(): void {
  if (
    DENSE_SEGMENT_MIN_WORDS < 0 ||
    DENSE_SEGMENT_OVERLAP_WORDS < 0 ||
    DENSE_SEGMENT_TARGET_WORDS < DENSE_SEGMENT_MIN_WORDS ||
    DENSE_SEGMENT_MAX_WORDS < DENSE_SEGMENT_TARGET_WORDS
  ) {
    throw new Error("Invalid Dense segment word-count configuration.");
  }
}

function requireNonNegativeWordsCount(wordsCount: number): number {
  if (!Number.isFinite(wordsCount) || wordsCount < 0) {
    throw new Error("Sentence word count must be non-negative.");
  }

  return wordsCount;
}

function createTextEmbeddingSegment(
  records: readonly TextSentenceEmbeddingInput[],
  wordsCount = records.reduce((sum, record) => sum + record.wordsCount, 0),
): TextEmbeddingSegmentInput {
  const first = records[0];
  const last = records.at(-1);

  if (first === undefined || last === undefined) {
    throw new Error("Cannot create an empty text embedding segment.");
  }

  return {
    archiveId: first.archiveId,
    chapterId: first.chapterId,
    endSentenceIndex: last.sentenceIndex,
    kind: first.kind,
    startSentenceIndex: first.sentenceIndex,
    text: records.map((record) => record.text).join("\n"),
    wordsCount,
  };
}

function findSegmentOverlapStart(
  records: readonly TextSentenceEmbeddingInput[],
  start: number,
  end: number,
): number {
  let wordsCount = 0;

  for (let index = end - 1; index > start; index -= 1) {
    wordsCount += Math.max(0, records[index]!.wordsCount);
    if (wordsCount >= DENSE_SEGMENT_OVERLAP_WORDS) {
      return index;
    }
  }

  return end;
}

async function writeSearchIndexBuildState(
  database: Database,
  indexes: SearchIndexSelection,
  options: ResolvedSearchIndexBuildOptions,
): Promise<void> {
  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES ('indexes', ?)
    `,
    [indexes],
  );
  if (options.indexes === "fts") {
    return;
  }
  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES ('embeddingModel', ?)
    `,
    [options.embeddingProvider.model],
  );
  if (options.embeddingProvider.identity !== undefined) {
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('embeddingIdentity', ?)
      `,
      [options.embeddingProvider.identity],
    );
  }
  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES ('embeddingDimensions', ?)
    `,
    [
      String(
        options.embeddingProvider.dimensions ??
          (await readStoredEmbeddingDimensions(database)) ??
          "",
      ),
    ],
  );
}

async function writeStoredSearchIndexBuildState(
  database: Database,
  input: {
    readonly embedding?: SearchIndexStoredEmbeddingState;
    readonly hasFts: boolean;
  },
): Promise<void> {
  const indexes =
    input.embedding === undefined
      ? input.hasFts
        ? "fts"
        : "missing"
      : input.hasFts
        ? "fts,dense"
        : "dense";

  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES ('indexes', ?)
    `,
    [indexes],
  );

  if (input.embedding === undefined) {
    return;
  }

  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES ('embeddingModel', ?)
    `,
    [input.embedding.model],
  );
  if (input.embedding.identity !== undefined) {
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('embeddingIdentity', ?)
      `,
      [input.embedding.identity],
    );
  }
  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES ('embeddingDimensions', ?)
    `,
    [String(input.embedding.dimensions)],
  );
}

async function readStoredEmbeddingDimensions(
  database: Database,
): Promise<number | undefined> {
  const row = await database.queryOne(
    `
      SELECT MIN(dimensions) AS min_dimensions, MAX(dimensions) AS max_dimensions
      FROM text_embedding_segments
    `,
    undefined,
    (value) => ({
      max: Number(value.max_dimensions),
      min: Number(value.min_dimensions),
    }),
  );

  if (
    row === undefined ||
    !Number.isInteger(row.min) ||
    !Number.isInteger(row.max) ||
    row.min <= 0 ||
    row.min !== row.max
  ) {
    return undefined;
  }

  return row.min;
}

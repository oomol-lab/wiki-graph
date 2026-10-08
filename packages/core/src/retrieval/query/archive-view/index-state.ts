import type {
  Document,
  IndexArtifactRecord,
  IndexArtifactLexicalRow,
  ReadonlyDocument,
} from "../../../document/index.js";
import { listChapters } from "../../../document/chapter/index.js";
import {
  createSearchIndexFingerprint,
  finalizeStoredSearchIndexReplacement,
  insertFtsRecord,
  insertSearchObjectPropertyRecord,
  insertTextEmbeddingSegment,
  insertTextSentenceRecord,
  readSearchIndexStatus,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  SINGLE_ARCHIVE_INDEX_ID,
  TEXT_SENTENCE_KIND,
  prepareSearchIndexReplacement,
  type SearchIndexInput,
  type SearchIndexBuildOptions,
  type SearchIndexStoredEmbeddingState,
  type SearchIndexProgressReporter,
  type SearchIndexQueryMode,
  type SearchIndexWriteBatch,
} from "../../search-index/search/index.js";
import { createSearchTokenPlan } from "../../search-index/search/tokenizer.js";

const SEARCH_INDEX_REBUILD_ATTEMPTS = 2;
const ARCHIVE_INDEX_BATCH_RECORDS = 512;

export interface ArchiveSearchIndexScopeOptions {
  readonly chapters?: readonly number[];
}

export interface ArchiveQueryCoverageOptions extends ArchiveSearchIndexScopeOptions {
  readonly embeddingProvider?: import("../../search-index/index.js").SearchIndexEmbeddingProvider;
  readonly requireEmbeddingProvider?: boolean;
  readonly queryMode?: SearchIndexQueryMode;
}

export class ArchiveQueryNotReadyError extends Error {
  public override readonly name = "ArchiveQueryNotReadyError";
}

export async function rebuildArchiveSearchIndex(
  document: Document,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions & ArchiveSearchIndexScopeOptions = {},
): Promise<void> {
  for (let attempt = 0; attempt < SEARCH_INDEX_REBUILD_ATTEMPTS; attempt += 1) {
    await assertArchiveIndexArtifactsReady(document, options);
    const input = await buildArchiveIndexProjection(
      document,
      progress,
      options,
    );
    const fingerprint = createSearchIndexFingerprint(input);

    if ((await readSearchIndexStatus(document, input)) === "dirty") {
      const beforeDeleteInput = await buildArchiveIndexProjection(
        document,
        undefined,
        options,
      );

      if (createSearchIndexFingerprint(beforeDeleteInput) !== fingerprint) {
        continue;
      }

      await document.deleteSearchIndexDatabase();
    }

    await writeArchiveIndexProjectionFromArtifacts(document, progress, options);

    const verifiedInput = await buildArchiveIndexProjection(
      document,
      undefined,
      options,
    );
    if (
      createSearchIndexFingerprint(verifiedInput) === fingerprint &&
      (await readSearchIndexStatus(document, verifiedInput)) === "current"
    ) {
      return;
    }

    await document.deleteSearchIndexDatabase();
  }

  throw new Error("Archive changed while rebuilding search index; retry.");
}

export async function isArchiveSearchIndexCurrent(
  document: ReadonlyDocument,
  options: ArchiveSearchIndexScopeOptions = {},
): Promise<boolean> {
  return (await readArchiveSearchIndexStatus(document, options)) === "current";
}

export async function readArchiveSearchIndexStatus(
  document: ReadonlyDocument,
  options: ArchiveSearchIndexScopeOptions = {},
): Promise<"current" | "dirty" | "missing"> {
  try {
    await assertArchiveIndexArtifactsReady(document, options);
  } catch {
    return "dirty";
  }

  return await readSearchIndexStatus(
    document,
    await buildArchiveIndexProjection(document, undefined, options),
  );
}

export async function clearDirtyArchiveSearchIndex(
  document: Document,
): Promise<void> {
  if ((await readArchiveSearchIndexStatus(document)) === "dirty") {
    await document.deleteSearchIndexDatabase();
  }
}

export async function createArchiveSearchIndexFingerprint(
  document: ReadonlyDocument,
): Promise<string> {
  return createSearchIndexFingerprint(
    await buildArchiveIndexProjection(document),
  );
}

export async function buildArchiveIndexProjection(
  document: ReadonlyDocument,
  progress?: SearchIndexProgressReporter,
  options: ArchiveSearchIndexScopeOptions = {},
): Promise<SearchIndexInput> {
  const objectProperties: SearchIndexInput["objectProperties"][number][] = [];
  const textSentences: SearchIndexInput["textSentences"][number][] = [];

  for await (const batch of streamArchiveIndexProjection(
    document,
    SINGLE_ARCHIVE_INDEX_ID,
    progress,
    options,
  )) {
    objectProperties.push(...batch.objectProperties);
    textSentences.push(...batch.textSentences);
  }

  return { objectProperties, textSentences };
}

export async function assertArchiveIndexArtifactsReady(
  document: ReadonlyDocument,
  options: ArchiveQueryCoverageOptions = {},
): Promise<void> {
  const chapterIds = await resolveArchiveQueryChapterIds(document, options);
  const [ftsCoverage, sourceEmbeddingCoverage] = await Promise.all([
    document.indexArtifacts.listCoverage("fts"),
    document.indexArtifacts.listCoverage("embedding-source"),
  ]);
  const sourceEmbeddingBySerial = new Map(
    sourceEmbeddingCoverage.map((record) => [record.serialId, record]),
  );
  const queryMode = options.queryMode ?? "hybrid";
  const embeddingAvailable =
    options.requireEmbeddingProvider !== true ||
    (await isEmbeddingProviderCompatible(
      document,
      options.embeddingProvider,
      options,
    ));
  const blocked = ftsCoverage.filter((record) => {
    if (!chapterIds.has(record.serialId)) return false;
    const hasFts = record.current;
    const hasEmbedding =
      embeddingAvailable &&
      sourceEmbeddingBySerial.get(record.serialId)?.current === true;
    return queryMode === "fts"
      ? !hasFts
      : queryMode === "embedding"
        ? !hasEmbedding
        : !hasFts && !hasEmbedding;
  });

  if (blocked.length === 0) {
    return;
  }

  const blockedIds = new Set(blocked.map((record) => record.serialId));
  const chapters = (await listChapters(document)).filter((chapter) =>
    blockedIds.has(chapter.chapterId),
  );
  const chapterReferences = chapters
    .map((chapter) =>
      chapter.title === null
        ? chapter.uri
        : `${JSON.stringify(chapter.title)} (${chapter.uri})`,
    )
    .join(", ");
  const requirement =
    queryMode === "fts"
      ? "a current FTS artifact"
      : queryMode === "embedding"
        ? "a current source embedding artifact and an available embeddings provider"
        : embeddingAvailable
          ? "a current FTS artifact or source embedding artifact"
          : "a current FTS artifact while the embeddings provider is unavailable";
  throw new ArchiveQueryNotReadyError(
    `Wiki Graph query is not ready. Chapters ${chapterReferences} need ${requirement} before query.`,
  );
}

export async function listArchiveQueryableChapterIds(
  document: ReadonlyDocument,
  options: ArchiveQueryCoverageOptions = {},
): Promise<readonly number[]> {
  const chapterIds = await resolveArchiveQueryChapterIds(document, options);
  const [ftsCoverage, sourceEmbeddingCoverage] = await Promise.all([
    document.indexArtifacts.listCoverage("fts"),
    document.indexArtifacts.listCoverage("embedding-source"),
  ]);
  const sourceEmbeddingBySerial = new Map(
    sourceEmbeddingCoverage.map((record) => [record.serialId, record]),
  );

  const queryMode = options.queryMode ?? "hybrid";
  const embeddingAvailable =
    options.requireEmbeddingProvider !== true ||
    (await isEmbeddingProviderCompatible(
      document,
      options.embeddingProvider,
      options,
    ));
  return ftsCoverage
    .filter((record) => {
      if (!chapterIds.has(record.serialId)) return false;
      const hasFts = record.current;
      const hasEmbedding =
        embeddingAvailable &&
        sourceEmbeddingBySerial.get(record.serialId)?.current === true;
      return queryMode === "fts"
        ? hasFts
        : queryMode === "embedding"
          ? hasEmbedding
          : hasFts || hasEmbedding;
    })
    .map((record) => record.serialId);
}

async function resolveArchiveQueryChapterIds(
  document: ReadonlyDocument,
  options: ArchiveSearchIndexScopeOptions,
): Promise<ReadonlySet<number>> {
  return options.chapters === undefined
    ? new Set(
        (await listChapters(document)).map((chapter) => chapter.chapterId),
      )
    : new Set(options.chapters);
}

async function isEmbeddingProviderCompatible(
  document: ReadonlyDocument,
  provider:
    | import("../../search-index/index.js").SearchIndexEmbeddingProvider
    | undefined,
  options: ArchiveSearchIndexScopeOptions,
): Promise<boolean> {
  if (provider === undefined) return false;
  let state: SearchIndexStoredEmbeddingState | undefined;
  try {
    state = await readArchiveEmbeddingState(document, options);
  } catch {
    return false;
  }
  if (state === undefined || state.model !== provider.model) return false;
  if (
    state.identity !== undefined &&
    provider.identity !== undefined &&
    state.identity !== provider.identity
  ) {
    return false;
  }
  return (
    provider.dimensions === undefined ||
    provider.dimensions === state.dimensions
  );
}

export async function writeArchiveIndexProjectionFromArtifacts(
  document: Document,
  progress?: SearchIndexProgressReporter,
  options: ArchiveSearchIndexScopeOptions = {},
): Promise<void> {
  const chaptersRevision = await document.serials.getChaptersRevision();
  const chapterIds = await resolveArchiveQueryChapterIds(document, options);
  const fingerprint = createSearchIndexFingerprint(
    await buildArchiveIndexProjection(document, undefined, options),
  );
  const embeddingState = await readArchiveEmbeddingState(document, options);
  const ftsCoverage = await document.indexArtifacts.listCoverage("fts");
  const hasFts = ftsCoverage.some(
    (artifact) => chapterIds.has(artifact.serialId) && artifact.current,
  );

  await document.writeSearchIndexDatabase(async (database) => {
    await prepareSearchIndexReplacement(database, progress);

    let textDone = 0;
    let vectorDone = 0;

    for (const chapter of await listChapters(document)) {
      if (!chapterIds.has(chapter.chapterId)) {
        continue;
      }
      for (const record of await streamIndexArtifactProjectionRecords(
        document,
        SINGLE_ARCHIVE_INDEX_ID,
        chapter.chapterId,
      )) {
        if (record.kind === "text") {
          const rowId = await insertTextSentenceRecord(database, record.value);

          if (record.value.text !== "") {
            await insertFtsRecord(
              database,
              "text_sentence_fts",
              rowId,
              createSearchTokenPlan(record.value.text),
            );
          }
          textDone += 1;
          await progress?.({
            done: textDone,
            phase: "indexing-text",
            unit: "sentence",
          });
          continue;
        }

        const rowId = await insertSearchObjectPropertyRecord(
          database,
          record.value,
        );

        await insertFtsRecord(
          database,
          "search_object_properties_fts",
          rowId,
          createSearchTokenPlan(record.value.text),
        );
      }
    }

    for (const artifactKind of [
      "embedding-source",
      "embedding-summary",
    ] as const) {
      for (const artifact of await document.indexArtifacts.list(artifactKind)) {
        if (!chapterIds.has(artifact.serialId)) {
          continue;
        }
        if (!(await isCurrentIndexArtifact(document, artifact))) {
          continue;
        }
        const segments = await document.indexArtifacts.listEmbeddingSegments(
          artifact.serialId,
          artifactKind,
        );
        const dimensions = readEmbeddingDimensions(artifact.metadata);
        const model = readEmbeddingModel(artifact.metadata);
        const label =
          artifactKind === "embedding-source" ? "Source" : "Summary";
        const textKind =
          artifactKind === "embedding-source"
            ? TEXT_SENTENCE_KIND.source
            : TEXT_SENTENCE_KIND.summary;

        if (
          segments.length > 0 &&
          (dimensions === undefined || model === undefined)
        ) {
          throw new Error(
            `${label} embedding artifact for chapter ${artifact.serialId} is missing embedding metadata.`,
          );
        }

        for (const segment of segments) {
          const vectorDimensions = dimensions ?? segment.vector.length;

          if (segment.vector.length !== vectorDimensions) {
            throw new Error(
              `${label} embedding artifact for chapter ${artifact.serialId} has ${segment.vector.length} dimensions; expected ${vectorDimensions}.`,
            );
          }
          for (
            let sentenceIndex = segment.startSentenceIndex;
            sentenceIndex <= segment.endSentenceIndex;
            sentenceIndex += 1
          ) {
            await insertTextSentenceRecord(database, {
              archiveId: SINGLE_ARCHIVE_INDEX_ID,
              chapterId: artifact.serialId,
              kind: textKind,
              sentenceIndex,
              text: "",
              wordsCount: 0,
            });
          }
          await insertTextEmbeddingSegment(database, {
            archiveId: SINGLE_ARCHIVE_INDEX_ID,
            chapterId: artifact.serialId,
            dimensions: vectorDimensions,
            endSentenceIndex: segment.endSentenceIndex,
            kind: textKind,
            model: model ?? "",
            startSentenceIndex: segment.startSentenceIndex,
            vector: segment.vector,
            wordsCount: segment.wordsCount,
          });
          vectorDone += 1;
          await progress?.({
            done: vectorDone,
            phase: "indexing-dense",
            unit: "vector",
          });
        }
      }
    }

    await finalizeStoredSearchIndexReplacement(database, {
      chaptersRevision,
      ...(embeddingState === undefined ? {} : { embedding: embeddingState }),
      fingerprint,
      hasFts,
      ...(progress === undefined ? {} : { progress }),
    });
  });
}

export async function* streamArchiveIndexProjection(
  document: ReadonlyDocument,
  archiveId: number,
  progress?: SearchIndexProgressReporter,
  options: ArchiveSearchIndexScopeOptions = {},
): AsyncIterable<SearchIndexWriteBatch> {
  const chapters = await listChapters(document);
  const chapterIds = await resolveArchiveQueryChapterIds(document, options);
  let chapterDone = 0;
  let batch = createEmptySearchIndexBatch();

  for (const chapter of chapters) {
    if (!chapterIds.has(chapter.chapterId)) {
      continue;
    }
    for (const record of await streamIndexArtifactProjectionRecords(
      document,
      archiveId,
      chapter.chapterId,
    )) {
      batch =
        record.kind === "text"
          ? appendTextSentence(batch, record.value)
          : appendObjectProperty(batch, record.value);
      if (countSearchIndexBatchRecords(batch) >= ARCHIVE_INDEX_BATCH_RECORDS) {
        yield batch;
        batch = createEmptySearchIndexBatch();
      }
    }

    chapterDone += 1;
    await progress?.({
      done: chapterDone,
      phase: "collecting",
      total: chapterIds.size,
      unit: "chapter",
    });
  }

  if (countSearchIndexBatchRecords(batch) > 0) {
    yield batch;
  }
}

async function streamIndexArtifactProjectionRecords(
  document: ReadonlyDocument,
  archiveId: number,
  serialId: number,
): Promise<
  readonly (
    | {
        readonly kind: "object";
        readonly value: SearchIndexWriteBatch["objectProperties"][number];
      }
    | {
        readonly kind: "text";
        readonly value: SearchIndexWriteBatch["textSentences"][number];
      }
  )[]
> {
  const records: (
    | {
        readonly kind: "object";
        readonly value: SearchIndexWriteBatch["objectProperties"][number];
      }
    | {
        readonly kind: "text";
        readonly value: SearchIndexWriteBatch["textSentences"][number];
      }
  )[] = [];
  const ftsArtifact = await document.indexArtifacts.get(serialId, "fts");

  if (
    ftsArtifact !== undefined &&
    (await isCurrentIndexArtifact(document, ftsArtifact))
  ) {
    for (const row of await document.indexArtifacts.listLexicalRows(
      serialId,
      "fts",
    )) {
      const textRecord = mapLexicalRowToTextSentence(archiveId, serialId, row);

      if (textRecord !== undefined) {
        records.push({ kind: "text", value: textRecord });
        continue;
      }

      const objectRecord = mapLexicalRowToObjectProperty(
        archiveId,
        serialId,
        row,
      );
      if (objectRecord !== undefined) {
        records.push({ kind: "object", value: objectRecord });
      }
    }
  }

  for (const artifactKind of [
    "embedding-source",
    "embedding-summary",
  ] as const) {
    const artifact = await document.indexArtifacts.get(serialId, artifactKind);
    if (artifact === undefined) {
      continue;
    }
    if (!(await isCurrentIndexArtifact(document, artifact))) {
      continue;
    }
    const textKind =
      artifactKind === "embedding-source"
        ? TEXT_SENTENCE_KIND.source
        : TEXT_SENTENCE_KIND.summary;
    for (const segment of await document.indexArtifacts.listEmbeddingSegments(
      serialId,
      artifactKind,
    )) {
      for (
        let sentenceIndex = segment.startSentenceIndex;
        sentenceIndex <= segment.endSentenceIndex;
        sentenceIndex += 1
      ) {
        records.push({
          kind: "text",
          value: {
            archiveId,
            chapterId: serialId,
            kind: textKind,
            sentenceIndex,
            text: "",
            wordsCount: 0,
          },
        });
      }
    }
  }

  return records;
}

function mapLexicalRowToTextSentence(
  archiveId: number,
  serialId: number,
  row: IndexArtifactLexicalRow,
): SearchIndexWriteBatch["textSentences"][number] | undefined {
  if (
    row.objectKind !== "source-sentence" &&
    row.objectKind !== "summary-sentence"
  ) {
    return undefined;
  }
  if (row.sentenceIndex === undefined) {
    return undefined;
  }

  return {
    archiveId,
    chapterId: serialId,
    kind:
      row.objectKind === "source-sentence"
        ? TEXT_SENTENCE_KIND.source
        : TEXT_SENTENCE_KIND.summary,
    sentenceIndex: row.sentenceIndex,
    text: row.text,
    wordsCount: readWordsCount(row.metadata),
  };
}

function mapLexicalRowToObjectProperty(
  archiveId: number,
  serialId: number,
  row: IndexArtifactLexicalRow,
): SearchIndexWriteBatch["objectProperties"][number] | undefined {
  switch (row.objectKind) {
    case "chapter-title":
      return {
        archiveId,
        chapterId: serialId,
        ownerId: row.objectId,
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.title,
        text: row.text,
      };
    case "chunk-label":
      return {
        archiveId,
        chapterId: serialId,
        ownerId: row.objectId,
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.label,
        text: row.text,
      };
    case "chunk-content":
      return {
        archiveId,
        chapterId: serialId,
        ownerId: row.objectId,
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.content,
        text: row.text,
      };
    case "mention-surface":
      return {
        archiveId,
        chapterId: serialId,
        ownerId: row.objectId,
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.surface,
        text: row.text,
      };
    default:
      return undefined;
  }
}

function createEmptySearchIndexBatch(): SearchIndexWriteBatch {
  return { objectProperties: [], textSentences: [] };
}

function appendTextSentence(
  batch: SearchIndexWriteBatch,
  record: SearchIndexWriteBatch["textSentences"][number],
): SearchIndexWriteBatch {
  (
    batch.textSentences as SearchIndexWriteBatch["textSentences"][number][]
  ).push(record);
  return batch;
}

function appendObjectProperty(
  batch: SearchIndexWriteBatch,
  record: SearchIndexWriteBatch["objectProperties"][number],
): SearchIndexWriteBatch {
  (
    batch.objectProperties as SearchIndexWriteBatch["objectProperties"][number][]
  ).push(record);
  return batch;
}

function countSearchIndexBatchRecords(batch: SearchIndexWriteBatch): number {
  return batch.objectProperties.length + batch.textSentences.length;
}

export async function readArchiveEmbeddingState(
  document: ReadonlyDocument,
  options: ArchiveSearchIndexScopeOptions = {},
): Promise<SearchIndexStoredEmbeddingState | undefined> {
  let state: SearchIndexStoredEmbeddingState | undefined;
  const chapterIds = await resolveArchiveQueryChapterIds(document, options);

  for (const artifactKind of [
    "embedding-source",
    "embedding-summary",
  ] as const) {
    for (const artifact of await document.indexArtifacts.list(artifactKind)) {
      if (!chapterIds.has(artifact.serialId)) {
        continue;
      }
      if (!(await isCurrentIndexArtifact(document, artifact))) {
        continue;
      }
      const dimensions = readEmbeddingDimensions(artifact.metadata);
      const model = readEmbeddingModel(artifact.metadata);
      const label = artifactKind === "embedding-source" ? "Source" : "Summary";

      if (dimensions === undefined || model === undefined) {
        throw new Error(
          `${label} embedding artifact for chapter ${artifact.serialId} is missing embedding metadata.`,
        );
      }

      const identity = readEmbeddingIdentity(artifact.metadata);
      const next: SearchIndexStoredEmbeddingState = {
        dimensions,
        ...(identity === undefined ? {} : { identity }),
        model,
      };

      if (
        state !== undefined &&
        (state.dimensions !== next.dimensions ||
          state.model !== next.model ||
          state.identity !== next.identity)
      ) {
        throw new Error(
          "Embedding artifacts use different embedding configurations; rebuild them with one embeddings configuration.",
        );
      }
      state = next;
    }
  }

  return state;
}

async function isCurrentIndexArtifact(
  document: ReadonlyDocument,
  artifact: IndexArtifactRecord,
): Promise<boolean> {
  return (
    artifact.sourceRevision ===
    (await document.serials.getRevision(artifact.serialId))
  );
}

function readWordsCount(metadata: Readonly<Record<string, unknown>>): number {
  const value = metadata.wordsCount;

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readEmbeddingDimensions(
  metadata: Readonly<Record<string, unknown>>,
): number | undefined {
  const value = metadata.dimensions;

  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

export function readEmbeddingIdentity(
  metadata: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = metadata.identity;

  return typeof value === "string" && value !== "" ? value : undefined;
}

export function readEmbeddingModel(
  metadata: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = metadata.model;

  return typeof value === "string" && value !== "" ? value : undefined;
}

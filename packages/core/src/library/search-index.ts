import { createPortableHash as createHash } from "../utils/crypto.js";
import {
  ensureRelativeDirectory,
  ensureRelativeFile,
  getWikiGraphStorage,
  isDirectory,
  readHostEntrySize,
  type Directory,
  type File,
} from "../runtime/platform/index.js";

import { Database, getNumber, getString } from "../document/database.js";
import { SEARCH_INDEX_SCHEMA_SQL } from "../document/schema.js";
import { openWikiGraphStateDatabase } from "../document/index.js";
import { WikiGraphArchiveFile } from "../storage/wikg/index.js";
import {
  assertArchiveIndexArtifactsReady,
  listArchiveQueryableChapterIds,
  readArchiveEmbeddingState,
  readEmbeddingDimensions,
  readEmbeddingModel,
  streamArchiveIndexProjection,
} from "../retrieval/query/archive-view/index-state.js";
import type {
  ArchiveFindMatch,
  ArchiveFindObjectType,
} from "../retrieval/query/archive-view/types.js";
import {
  markDirtySearchIndexChapters,
  finalizeStoredSearchIndexReplacement,
  insertFtsRecord,
  insertSearchObjectPropertyRecord,
  insertTextEmbeddingSegment,
  insertTextSentenceRecord,
  prepareSearchIndexReplacement,
  readSearchIndexFingerprintFromDatabase,
  readSearchIndexCapabilityStatus,
  readSearchIndexStatus,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  type SearchIndexObjectHit,
  type SearchIndexCapabilityStatus,
  type SearchIndexEmbeddingProvider,
  type SearchIndexProgressReporter,
  type SearchIndexStoredEmbeddingState,
  type SearchIndexTextHit,
  type SearchObjectPropertyKind,
  type SearchObjectPropertyOwnerKind,
  type TextSentenceKind,
  TEXT_SENTENCE_KIND,
} from "../retrieval/search-index/index.js";
import { createSearchTokenPlan } from "../retrieval/search-index/search/tokenizer.js";
import type { GcContext, GcJobResult } from "../runtime/gc/index.js";
import {
  listWikiGraphLibraryArchives,
  type WikiGraphLibraryArchiveRecord,
} from "./membership.js";
import {
  resolveWikiGraphLibrary,
  type ParsedWikiGraphLibraryUri,
  type WikiGraphLibraryRecord,
} from "./registry.js";
import { isWikiGraphLibraryLocked, withWikiGraphLibraryLock } from "./lock.js";

export type WikiGraphLibraryIndexStatus = "current" | "dirty" | "missing";

export interface WikiGraphLibraryIndexSource {
  readonly archiveId: number;
  readonly archiveUri: string;
  readonly exists: boolean;
  readonly lastSeenMutationToken?: string;
  readonly relativePath: string;
  readonly status: string;
}

export interface WikiGraphLibraryIndexState {
  readonly capabilities?: SearchIndexCapabilityStatus;
  readonly fingerprint?: string;
  readonly sourceFingerprint: string;
  readonly sources: readonly WikiGraphLibraryIndexSource[];
  readonly status: WikiGraphLibraryIndexStatus;
}

export interface WikiGraphLibraryIndexQueryResult {
  readonly objectHits: readonly WikiGraphLibraryIndexObjectHit[];
  readonly terms: readonly string[];
  readonly textHits: readonly WikiGraphLibraryIndexTextHit[];
}

export interface WikiGraphLibraryIndexListOptions {
  readonly includeText?: boolean;
}

export interface WikiGraphLibraryIndexQueryOptions {
  readonly chapters?: readonly number[];
  readonly embeddingProvider?: SearchIndexEmbeddingProvider;
  readonly match?: ArchiveFindMatch;
  readonly objectHitLimit?: number;
  readonly textAfter?: {
    readonly archiveId: number;
    readonly chapterId: number;
    readonly kind: TextSentenceKind;
    readonly rank: number;
    readonly sentenceIndex: number;
  };
  readonly textHitLimit?: number;
  readonly types?: readonly ArchiveFindObjectType[] | null;
}

export type WikiGraphLibraryIndexObjectHit = SearchIndexObjectHit & {
  readonly archiveUri: string;
  readonly libraryArchiveUri: string;
};

export type WikiGraphLibraryIndexTextHit = SearchIndexTextHit & {
  readonly archiveUri: string;
  readonly libraryArchiveUri: string;
};

export async function readWikiGraphLibraryIndexState(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryIndexState> {
  const library = await resolveWikiGraphLibrary(target);
  const sources = await listLibraryIndexSources(target);
  const sourceFingerprint = createLibraryIndexSourceFingerprint(sources);

  const document = new LibraryIndexDocument(library);
  const searchStatus = await readSearchIndexStatus(document as never);

  if (searchStatus === "missing") {
    return { sourceFingerprint, sources, status: "missing" };
  }

  const databaseState = await document.readSearchIndexDatabase(
    async (database) => ({
      fingerprint: await readSearchIndexFingerprintFromDatabase(database),
      sourceFingerprint: await readStateValue(database, "sourceFingerprint"),
    }),
  );
  const capabilities = await readSearchIndexCapabilityStatus(document);

  return {
    capabilities,
    ...(databaseState.fingerprint === undefined
      ? {}
      : { fingerprint: databaseState.fingerprint }),
    sourceFingerprint,
    sources,
    status:
      searchStatus === "current" &&
      databaseState.sourceFingerprint === sourceFingerprint
        ? "current"
        : "dirty",
  };
}

export async function rebuildWikiGraphLibraryIndex(
  target: ParsedWikiGraphLibraryUri,
  progress?: SearchIndexProgressReporter,
  _options?: unknown,
): Promise<WikiGraphLibraryIndexState> {
  const library = await resolveWikiGraphLibrary(target);

  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    const archives = await listWikiGraphLibraryArchives(target);
    const sources = archives.map(formatLibraryIndexSource);
    const present = archives.filter(
      (archive) => archive.exists && archive.status === "present",
    );
    const document = new LibraryIndexDocument(library);
    const sourceFingerprint = createLibraryIndexSourceFingerprint(sources);
    const indexFingerprint =
      createLibraryIndexSearchFingerprint(sourceFingerprint);

    await replaceLibrarySearchIndex(
      document,
      present,
      indexFingerprint,
      progress,
    );
    await document.writeSearchIndexDatabase(async (database) => {
      await setStateValue(database, "sourceFingerprint", sourceFingerprint);
      await setStateValue(database, "libraryFingerprint", indexFingerprint);
    });

    return await readWikiGraphLibraryIndexState(target);
  });
}

export async function cleanWikiGraphLibraryIndex(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryIndexState> {
  const library = await resolveWikiGraphLibrary(target);

  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    const index = await library.staging.getDirectory("index");
    if (index !== undefined) await index.remove("index.db");
    return await readWikiGraphLibraryIndexState(target);
  });
}

export async function markWikiGraphLibraryIndexDirty(
  targetOrLibrary: ParsedWikiGraphLibraryUri | WikiGraphLibraryRecord,
): Promise<void> {
  const library =
    "folder" in targetOrLibrary
      ? targetOrLibrary
      : await resolveWikiGraphLibrary(targetOrLibrary);

  const document = new LibraryIndexDocument(library);

  try {
    await document.writeSearchIndexDatabase(async () => {
      await markDirtySearchIndexChapters(document as never, [0], {
        archiveId: 0,
        updatedAt: Date.now(),
      });
    });
  } catch (error) {
    if (isMissingSqliteOpenError(error)) {
      return;
    }
    throw error;
  }
}

export async function assertWikiGraphLibraryIndexReady(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryIndexState> {
  const state = await readWikiGraphLibraryIndexState(target);

  if (state.status !== "current") {
    throw new Error(
      `Wiki Graph library index is ${state.status}. Run \`<lib-uri>/index sync\` before querying.`,
    );
  }

  return state;
}

export async function assertWikiGraphLibraryQueryArtifactsReady(
  target: ParsedWikiGraphLibraryUri,
): Promise<void> {
  const archives = await listWikiGraphLibraryArchives(target);

  for (const archive of archives) {
    if (!archive.exists || archive.status !== "present") {
      continue;
    }
    await new WikiGraphArchiveFile(requireArchiveFile(archive)).readDocument(
      async (archiveDocument) => {
        try {
          await assertArchiveIndexArtifactsReady(archiveDocument);
        } catch (error) {
          throw new Error(
            `Wiki Graph library query is not ready. Archive ${archive.uri} has unindexed chapters. Build missing chapter index artifacts, or rerun with --skip-unindexed to search indexed chapters only.`,
            { cause: error },
          );
        }
      },
    );
  }
}

export async function assertWikiGraphLibraryHasQueryableArtifacts(
  target: ParsedWikiGraphLibraryUri,
): Promise<void> {
  const archives = await listWikiGraphLibraryArchives(target);

  for (const archive of archives) {
    if (!archive.exists || archive.status !== "present") {
      continue;
    }
    const queryableChapters = await new WikiGraphArchiveFile(
      requireArchiveFile(archive),
    ).readDocument(
      async (archiveDocument) =>
        await listArchiveQueryableChapterIds(archiveDocument),
    );
    if (queryableChapters.length > 0) {
      return;
    }
  }

  throw new Error(
    "Wiki Graph library query is not ready. No chapters in this library have a current FTS artifact or source embedding artifact.",
  );
}

export async function queryWikiGraphLibrarySearchIndex(
  target: ParsedWikiGraphLibraryUri,
  query: string,
  options: WikiGraphLibraryIndexQueryOptions = {},
): Promise<WikiGraphLibraryIndexQueryResult | undefined> {
  const library = await resolveWikiGraphLibrary(target);

  return await withWikiGraphLibraryLock(library.id, "read", async () => {
    const state = await assertWikiGraphLibraryIndexReady(target);
    const sourceByArchiveId = new Map(
      state.sources.map((source) => [source.archiveId, source]),
    );
    const { querySearchIndex } =
      await import("../retrieval/search-index/index.js");
    const result = await querySearchIndex(
      new LibraryIndexDocument(library) as never,
      query,
      options,
    );

    if (result === undefined) {
      return undefined;
    }

    return {
      objectHits: result.objectHits.map((hit) => ({
        ...hit,
        ...formatLibraryHitSource(sourceByArchiveId, hit.archiveId),
      })),
      terms: result.terms,
      textHits: result.textHits.map((hit) => ({
        ...hit,
        ...formatLibraryHitSource(sourceByArchiveId, hit.archiveId),
      })),
    };
  });
}

export async function listWikiGraphLibrarySearchIndex(
  target: ParsedWikiGraphLibraryUri,
  options: WikiGraphLibraryIndexListOptions = {},
): Promise<WikiGraphLibraryIndexQueryResult> {
  const library = await resolveWikiGraphLibrary(target);

  return await withWikiGraphLibraryLock(library.id, "read", async () => {
    const state = await assertWikiGraphLibraryIndexReady(target);
    const sourceByArchiveId = new Map(
      state.sources.map((source) => [source.archiveId, source]),
    );

    return await new LibraryIndexDocument(library).readSearchIndexDatabase(
      async (database) => {
        const objectHits = await database.queryAll(
          `
            SELECT DISTINCT
              archive_id,
              owner_kind,
              owner_id,
              property_kind,
              chapter_id
            FROM search_object_properties_records
            WHERE owner_kind != ? OR property_kind = ?
            ORDER BY archive_id, COALESCE(chapter_id, 0), owner_kind, owner_id, property_kind
          `,
          [
            SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
            SEARCH_OBJECT_PROPERTY_KIND.label,
          ],
          (row): WikiGraphLibraryIndexObjectHit => {
            const archiveId = getNumber(row, "archive_id");
            return {
              ...formatLibraryHitSource(sourceByArchiveId, archiveId),
              archiveId,
              ownerId: String(row.owner_id),
              ownerKind: getNumber(
                row,
                "owner_kind",
              ) as SearchObjectPropertyOwnerKind,
              propertyKind: getNumber(
                row,
                "property_kind",
              ) as SearchObjectPropertyKind,
              score: 0,
              ...(row.chapter_id === null
                ? {}
                : { chapterId: getNumber(row, "chapter_id") }),
            };
          },
        );

        const textHits =
          options.includeText === true
            ? await database.queryAll(
                `
                  SELECT archive_id, kind, chapter_id, sentence_index, words_count
                  FROM text_sentence_records
                  ORDER BY archive_id, chapter_id, sentence_index, kind
                `,
                undefined,
                (row): WikiGraphLibraryIndexTextHit => {
                  const archiveId = getNumber(row, "archive_id");
                  return {
                    ...formatLibraryHitSource(sourceByArchiveId, archiveId),
                    archiveId,
                    chapterId: getNumber(row, "chapter_id"),
                    kind: getNumber(row, "kind") as TextSentenceKind,
                    rank: 0,
                    score: 0,
                    sentenceIndex: getNumber(row, "sentence_index"),
                    wordsCount: getNumber(row, "words_count"),
                  };
                },
              )
            : [];

        return { objectHits, terms: [], textHits };
      },
    );
  });
}

export async function listWikiGraphLibraryIndexArchiveIdsForObject(
  target: ParsedWikiGraphLibraryUri,
  objectUri: string,
): Promise<readonly number[]> {
  const library = await resolveWikiGraphLibrary(target);

  return await withWikiGraphLibraryLock(library.id, "read", async () => {
    await assertWikiGraphLibraryIndexReady(target);

    const exact = parseIndexedObjectUri(objectUri);
    if (exact === undefined) {
      return [];
    }

    return await new LibraryIndexDocument(library).readSearchIndexDatabase(
      async (database) =>
        await database.queryAll(
          `
            SELECT DISTINCT archive_id
            FROM search_object_properties_records
            WHERE owner_kind = ? AND owner_id = ?
            ORDER BY archive_id
          `,
          [exact.ownerKind, exact.ownerId],
          (row) => getNumber(row, "archive_id"),
        ),
    );
  });
}

function parseIndexedObjectUri(objectUri: string):
  | {
      readonly ownerId: string;
      readonly ownerKind: (typeof SEARCH_OBJECT_PROPERTY_OWNER_KIND)[keyof typeof SEARCH_OBJECT_PROPERTY_OWNER_KIND];
    }
  | undefined {
  const path = objectUri.replace(/^wikg:\/\/|\/+$/gu, "");
  const match = /^(?:chapter\/[1-9][0-9]*\/)?(chunk|entity)\/([^/]+)$/u.exec(
    path,
  );
  if (match?.[1] === undefined || match[2] === undefined) {
    return undefined;
  }

  return {
    ownerId: decodeURIComponent(match[2]),
    ownerKind:
      match[1] === "chunk"
        ? SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk
        : SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity,
  };
}

export async function runLibraryIndexGc(
  context: GcContext,
): Promise<GcJobResult> {
  const staging = await getWikiGraphStorage().library.getDirectory("staging");
  const root = await staging?.getDirectory("library");
  if (root === undefined) {
    return { freedBytes: 0, removed: 0, scanned: 0 };
  }
  const knownLibraryIds = await listKnownLibraryIds();
  if (knownLibraryIds === undefined) {
    return { freedBytes: 0, removed: 0, scanned: 0 };
  }
  const validLibraryIds = new Set(knownLibraryIds.map((id) => String(id)));
  const entries = await root.list();
  let scanned = 0;
  let removed = 0;
  let freedBytes = 0;

  for (const entry of entries) {
    if (!isDirectory(entry)) {
      continue;
    }
    scanned += 1;
    if (validLibraryIds.has(entry.name)) {
      continue;
    }
    const libraryId = Number(entry.name);
    if (
      Number.isInteger(libraryId) &&
      (await isWikiGraphLibraryLocked(libraryId))
    ) {
      continue;
    }
    const bytes = await readHostEntrySize(entry);

    if (!context.dryRun) {
      await root.remove(entry.name, { recursive: true });
    }
    removed += 1;
    freedBytes += bytes;
  }

  return { freedBytes, removed, scanned };
}

async function replaceLibrarySearchIndex(
  document: LibraryIndexDocument,
  archives: readonly WikiGraphLibraryArchiveRecord[],
  fingerprint: string,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  await document.writeSearchIndexDatabase(async (database) => {
    await prepareSearchIndexReplacement(database, progress);

    let embeddingState: SearchIndexStoredEmbeddingState | undefined;
    let hasFts = false;
    let textDone = 0;
    let objectDone = 0;
    let vectorDone = 0;

    for (const archive of archives) {
      await new WikiGraphArchiveFile(requireArchiveFile(archive)).readDocument(
        async (archiveDocument) => {
          for await (const batch of streamArchiveIndexProjection(
            archiveDocument,
            archive.id,
          )) {
            for (const record of batch.textSentences) {
              const rowId = await insertTextSentenceRecord(database, record);

              if (record.text !== "") {
                hasFts = true;
                await insertFtsRecord(
                  database,
                  "text_sentence_fts",
                  rowId,
                  createSearchTokenPlan(record.text),
                );
              }
              textDone += 1;
              await progress?.({
                done: textDone,
                phase: "indexing-text",
                unit: "sentence",
              });
            }

            for (const record of batch.objectProperties) {
              const rowId = await insertSearchObjectPropertyRecord(
                database,
                record,
              );

              await insertFtsRecord(
                database,
                "search_object_properties_fts",
                rowId,
                createSearchTokenPlan(record.text),
              );
              objectDone += 1;
              await progress?.({
                done: objectDone,
                phase: "indexing-objects",
                unit: "object",
              });
            }
          }

          const archiveEmbeddingState =
            await readArchiveEmbeddingState(archiveDocument);
          if (archiveEmbeddingState !== undefined) {
            embeddingState = mergeEmbeddingState(
              embeddingState,
              archiveEmbeddingState,
            );
          }
          for (const artifactKind of [
            "embedding-source",
            "embedding-summary",
          ] as const) {
            for (const artifact of await archiveDocument.indexArtifacts.list(
              artifactKind,
            )) {
              const model = readEmbeddingModel(artifact.metadata);
              const dimensions = readEmbeddingDimensions(artifact.metadata);
              const label =
                artifactKind === "embedding-source" ? "Source" : "Summary";
              const textKind =
                artifactKind === "embedding-source"
                  ? TEXT_SENTENCE_KIND.source
                  : TEXT_SENTENCE_KIND.summary;

              if (model === undefined || dimensions === undefined) {
                throw new Error(
                  `${label} embedding artifact for chapter ${artifact.serialId} is missing embedding metadata.`,
                );
              }
              for (const segment of await archiveDocument.indexArtifacts.listEmbeddingSegments(
                artifact.serialId,
                artifactKind,
              )) {
                await insertTextEmbeddingSegment(database, {
                  archiveId: archive.id,
                  chapterId: artifact.serialId,
                  dimensions,
                  endSentenceIndex: segment.endSentenceIndex,
                  kind: textKind,
                  model,
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
        },
      );
    }

    await finalizeStoredSearchIndexReplacement(database, {
      chaptersRevision: 0,
      ...(embeddingState === undefined ? {} : { embedding: embeddingState }),
      fingerprint,
      hasFts,
      ...(progress === undefined ? {} : { progress }),
    });
  });
}

function createLibraryIndexSearchFingerprint(
  sourceFingerprint: string,
): string {
  return createHash("sha256")
    .update("library-index")
    .update("\0")
    .update(sourceFingerprint)
    .digest("hex");
}

function mergeEmbeddingState(
  current: SearchIndexStoredEmbeddingState | undefined,
  next: SearchIndexStoredEmbeddingState,
): SearchIndexStoredEmbeddingState {
  if (current === undefined) {
    return next;
  }
  if (
    current.dimensions !== next.dimensions ||
    current.model !== next.model ||
    current.identity !== next.identity
  ) {
    throw new Error(
      "Embedding artifacts use different embedding configurations; rebuild them with one embeddings configuration.",
    );
  }

  return current;
}

function formatLibraryHitSource(
  sourceByArchiveId: ReadonlyMap<number, WikiGraphLibraryIndexSource>,
  archiveId: number,
): {
  readonly archiveUri: string;
  readonly libraryArchiveUri: string;
} {
  const source = sourceByArchiveId.get(archiveId);

  if (source === undefined) {
    return {
      archiveUri: `library-archive:${archiveId}`,
      libraryArchiveUri: `library-archive:${archiveId}`,
    };
  }

  return {
    archiveUri: source.archiveUri,
    libraryArchiveUri: source.archiveUri,
  };
}

async function listLibraryIndexSources(
  target: ParsedWikiGraphLibraryUri,
): Promise<readonly WikiGraphLibraryIndexSource[]> {
  return (await listWikiGraphLibraryArchives(target)).map(
    formatLibraryIndexSource,
  );
}

function formatLibraryIndexSource(
  archive: WikiGraphLibraryArchiveRecord,
): WikiGraphLibraryIndexSource {
  return {
    archiveId: archive.id,
    archiveUri: archive.uri,
    exists: archive.exists,
    ...(archive.lastSeenMutationToken === undefined
      ? {}
      : { lastSeenMutationToken: archive.lastSeenMutationToken }),
    relativePath: archive.relativePath,
    status: archive.status,
  };
}

function createLibraryIndexSourceFingerprint(
  sources: readonly WikiGraphLibraryIndexSource[],
): string {
  const hash = createHash("sha256");

  for (const source of [...sources].sort(
    (left, right) => left.archiveId - right.archiveId,
  )) {
    hash.update(String(source.archiveId));
    hash.update("\0");
    hash.update(source.relativePath);
    hash.update("\0");
    hash.update(source.status);
    hash.update("\0");
    hash.update(source.lastSeenMutationToken ?? "");
    hash.update("\0");
    hash.update(source.exists ? "1" : "0");
    hash.update("\0");
  }

  return hash.digest("hex");
}

async function listKnownLibraryIds(): Promise<readonly number[] | undefined> {
  const database = await openWikiGraphStateDatabase("core.sqlite", "");

  try {
    return await database.queryAll(
      "SELECT id FROM libraries",
      undefined,
      (row) => getNumber(row, "id"),
    );
  } catch {
    return undefined;
  } finally {
    await database.close();
  }
}

async function readStateValue(
  database: Database,
  key: string,
): Promise<string | undefined> {
  return await database.queryOne(
    "SELECT value FROM search_index_state WHERE key = ?",
    [key],
    (row) => getString(row, "value"),
  );
}

async function setStateValue(
  database: Database,
  key: string,
  value: string,
): Promise<void> {
  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    [key, value],
  );
}

async function createLibraryIndexDirectory(
  library: WikiGraphLibraryRecord,
): Promise<Directory> {
  return await ensureRelativeDirectory(library.staging, "index");
}

async function createLibraryIndexDatabaseFile(
  library: WikiGraphLibraryRecord,
): Promise<File> {
  return await ensureRelativeFile(
    await createLibraryIndexDirectory(library),
    "index.db",
  );
}

function isMissingSqliteOpenError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "SQLITE_CANTOPEN"
  );
}

function requireArchiveFile(
  archive: WikiGraphLibraryArchiveRecord,
): NonNullable<WikiGraphLibraryArchiveRecord["file"]> {
  if (archive.file === undefined) {
    throw new Error(`Wiki Graph library archive is missing: ${archive.uri}`);
  }
  return archive.file;
}

class LibraryIndexDocument {
  readonly #library: WikiGraphLibraryRecord;

  public readonly serials = {
    getChaptersRevision: () => Promise.resolve(0),
  };

  public constructor(library: WikiGraphLibraryRecord) {
    this.#library = library;
  }

  public async readSearchIndexDatabase<T>(
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T> {
    return await this.#openSearchIndexDatabase(operation, true);
  }

  public async writeSearchIndexDatabase<T>(
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T> {
    return await this.#openSearchIndexDatabase(operation, false);
  }

  async #openSearchIndexDatabase<T>(
    operation: (database: Database) => Promise<T> | T,
    readonly: boolean,
  ): Promise<T> {
    const file = await createLibraryIndexDatabaseFile(this.#library);
    const database = readonly
      ? await Database.open(file, "", { mode: "readonly" })
      : await Database.open(file, SEARCH_INDEX_SCHEMA_SQL, {
          create: true,
          mode: "readwrite",
        });

    try {
      return await operation(database);
    } finally {
      await database.close();
    }
  }
}

import { createHash } from "crypto";
import { mkdir, readdir, rm, stat, writeFile } from "fs/promises";
import { join } from "path";

import { Database, getNumber, getString } from "../document/database.js";
import { ensureWikiGraphHomeSchemaCurrent } from "../document/home-schema-upgrade.js";
import { SEARCH_INDEX_SCHEMA_SQL } from "../document/schema.js";
import { openSharedStateDatabase } from "../document/index.js";
import { WikiGraphArchiveFile } from "../storage/wikg/index.js";
import { streamArchiveIndexProjection } from "../retrieval/query/archive-view/index-state.js";
import {
  markDirtySearchIndexChapters,
  finalizeSearchIndexReplacement,
  prepareSearchIndexReplacement,
  readSearchIndexFingerprintFromDatabase,
  readSearchIndexStatus,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  type SearchIndexObjectHit,
  type SearchIndexProgressReporter,
  type SearchIndexTextHit,
  type SearchIndexWriteCounters,
  type SearchObjectPropertyKind,
  type SearchObjectPropertyOwnerKind,
  type TextSentenceKind,
  writeSearchIndexBatch,
} from "../retrieval/search-index/index.js";
import { readPathSize } from "../runtime/gc/files.js";
import type { GcContext, GcJobResult } from "../runtime/gc/index.js";
import {
  resolveWikiGraphCoreDatabasePath,
  resolveWikiGraphStagingDirectoryPath,
} from "../runtime/common/wiki-graph/dir.js";
import { isNodeError } from "../utils/node-error.js";
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

export type WikiGraphLibraryIndexStatus =
  | "current"
  | "dirty"
  | "disabled"
  | "missing";

export interface WikiGraphLibraryIndexSource {
  readonly archiveId: number;
  readonly archiveUri: string;
  readonly exists: boolean;
  readonly lastSeenMutationToken?: string;
  readonly relativePath: string;
  readonly status: string;
}

export interface WikiGraphLibraryIndexState {
  readonly enabled: boolean;
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
  readonly objectHitLimit?: number;
  readonly textHitLimit?: number;
}

export type WikiGraphLibraryIndexObjectHit = SearchIndexObjectHit & {
  readonly archiveUri: string;
  readonly libraryArchiveUri: string;
};

export type WikiGraphLibraryIndexTextHit = SearchIndexTextHit & {
  readonly archiveUri: string;
  readonly libraryArchiveUri: string;
};

const LIBRARY_INDEX_DISABLED_FILE = "index.disabled";

export async function readWikiGraphLibraryIndexState(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryIndexState> {
  const library = await resolveWikiGraphLibrary(target);
  const sources = await listLibraryIndexSources(target);
  const sourceFingerprint = createLibraryIndexSourceFingerprint(sources);
  const enabled = !(await pathExists(createDisabledPath(library)));

  if (!enabled) {
    return { enabled, sourceFingerprint, sources, status: "disabled" };
  }

  const document = new LibraryIndexDocument(library);
  const searchStatus = await readSearchIndexStatus(document as never);

  if (searchStatus === "missing") {
    return { enabled, sourceFingerprint, sources, status: "missing" };
  }

  const databaseState = await document.readSearchIndexDatabase(
    async (database) => ({
      fingerprint: await readSearchIndexFingerprintFromDatabase(database),
      sourceFingerprint: await readStateValue(database, "sourceFingerprint"),
    }),
  );

  return {
    enabled,
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
): Promise<WikiGraphLibraryIndexState> {
  const library = await resolveWikiGraphLibrary(target);

  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    await rm(createDisabledPath(library), { force: true });
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

export async function disableWikiGraphLibraryIndex(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryIndexState> {
  const library = await resolveWikiGraphLibrary(target);

  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    await mkdir(createLibraryIndexDirectory(library), { recursive: true });
    await rm(createLibraryIndexDatabasePath(library), { force: true });
    await writeFile(createDisabledPath(library), "disabled\n", "utf8");
    return await readWikiGraphLibraryIndexState(target);
  });
}

export async function markWikiGraphLibraryIndexDirty(
  targetOrLibrary: ParsedWikiGraphLibraryUri | WikiGraphLibraryRecord,
): Promise<void> {
  const library =
    "folderPath" in targetOrLibrary
      ? targetOrLibrary
      : await resolveWikiGraphLibrary(targetOrLibrary);

  if (await pathExists(createDisabledPath(library))) {
    return;
  }

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
      `Wiki Graph library index is ${state.status}. Run \`<lib-uri>/index enable\` before querying.`,
    );
  }

  return state;
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
  const rootPath = join(resolveWikiGraphStagingDirectoryPath(), "library");
  const knownLibraryIds = await listKnownLibraryIds();
  if (knownLibraryIds === undefined) {
    return { freedBytes: 0, removed: 0, scanned: 0 };
  }
  const validLibraryIds = new Set(knownLibraryIds.map((id) => String(id)));
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    },
  );
  let scanned = 0;
  let removed = 0;
  let freedBytes = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
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
    const path = join(rootPath, entry.name);
    const bytes = await readPathSize(path);

    if (!context.dryRun) {
      await rm(path, { force: true, recursive: true });
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

    let counters: SearchIndexWriteCounters = { objectDone: 0, textDone: 0 };
    for (const archive of archives) {
      await new WikiGraphArchiveFile(archive.path).readDocument(
        async (archiveDocument) => {
          for await (const batch of streamArchiveIndexProjection(
            archiveDocument,
            archive.id,
          )) {
            counters = await writeSearchIndexBatch(
              database,
              batch,
              counters,
              progress,
            );
          }
        },
      );
    }

    await finalizeSearchIndexReplacement(database, fingerprint, 0, progress);
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
  const database = await openSharedStateDatabase(
    resolveWikiGraphCoreDatabasePath(),
    "",
  );

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

function createLibraryIndexDirectory(library: WikiGraphLibraryRecord): string {
  return join(library.stagingPath, "index");
}

function createLibraryIndexDatabasePath(
  library: WikiGraphLibraryRecord,
): string {
  return join(createLibraryIndexDirectory(library), "fts.db");
}

function createDisabledPath(library: WikiGraphLibraryRecord): string {
  return join(
    createLibraryIndexDirectory(library),
    LIBRARY_INDEX_DISABLED_FILE,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isMissingSqliteOpenError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "SQLITE_CANTOPEN"
  );
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
    await ensureWikiGraphHomeSchemaCurrent();
    await mkdir(createLibraryIndexDirectory(this.#library), {
      recursive: true,
    });
    const database = await Database.open(
      createLibraryIndexDatabasePath(this.#library),
      readonly ? "" : SEARCH_INDEX_SCHEMA_SQL,
      { readonly },
    );

    try {
      return await operation(database);
    } finally {
      await database.close();
    }
  }
}

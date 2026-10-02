import { randomUUID } from "crypto";
import { link, mkdtemp, rename, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { Readable } from "stream";

import {
  addChapter,
  applyChapterTree,
  assertNoActiveBuildJobConflicts,
  assertNoActiveBuildJobs,
  deleteArchiveSearchSessions,
  DirectoryDocument,
  finalizeWikiGraphLibraryArchiveWrite,
  findArchiveObjects,
  formatLocatedWikiGraphUri,
  isArchiveSearchIndexCurrent,
  isSourceLocatorScopeUri,
  listArchiveCollection,
  listArchiveEvidence,
  listArchiveQueryableChapterIds,
  listArchiveSourceLocators,
  listChapters,
  listRelatedArchiveObjects,
  moveChapter,
  packArchiveContext,
  parseLocatedWikiGraphUri,
  parseWikiGraphLibraryUri,
  readArchivePage,
  readSearchIndexCapabilityStatus,
  readWikiGraphLibraryIndexState,
  rebuildArchiveSearchIndex,
  rebuildWikiGraphLibraryIndex,
  removeChapter,
  resetChapter,
  resolveChapterPathReadonly,
  resolveWikiGraphLibraryArchiveFile,
  setChapterSource,
  setChapterSummary,
  setChapterTitle,
  getChapterTree,
  WikiGraph,
  WikiGraphArchiveFile,
  TOC_FILE_VERSION,
  writeWikgArchive,
  type ArchiveCollectionOptions,
  type ArchiveCollectionResult,
  type ArchiveEvidence,
  type ArchiveFindOptions,
  type ArchiveFindResult,
  type ArchivePack,
  type ArchivePage,
  type ArchiveRelatedResult,
  type ArchiveSourceLocatorResult,
  type BookMeta,
  type ChapterEntry,
  type ChapterDetails,
  type ChapterStage,
  type ChapterTree,
  type ChapterTreeApplyResult,
  type File,
  type IndexArtifactKind,
  ObjectMetadataKind,
  type ObjectMetadataTarget,
  type ParsedWikiGraphLibraryUri,
  type QueryIndexScope,
  type ReadonlyDocument,
  type SearchIndexEmbeddingProvider,
  type WikiGraphProgressCallback,
} from "wiki-graph-core";

import type { WikiGraphJobRuntime } from "../jobs.js";
import { WikiGraphConversionManager } from "../conversions.js";
import {
  getNodeResourcePath,
  NodeDirectory,
  NodeFile,
} from "../node-platform.js";
import { resolveWikiGraphRuntimePath } from "../runtime-path.js";
import {
  createConfiguredEmbeddingProvider,
  withConfiguredWikimediaResolver,
} from "../query-runtime.js";
import {
  createWikiGraphArchiveInspectReport,
  type WikiGraphArchiveInspectReport,
} from "./inspect.js";

export interface WikiGraphOperationOptions {
  readonly signal?: AbortSignal;
}

type SearchIndexCapabilityStatus = Awaited<
  ReturnType<typeof readSearchIndexCapabilityStatus>
>;
type SearchIndexProgressEvent = Parameters<
  NonNullable<Parameters<typeof rebuildArchiveSearchIndex>[1]>
>[0];
export type WikiGraphChapterResetStage = Exclude<ChapterStage, "summarized">;
export type WikiGraphChapterSourceOptions = NonNullable<
  Parameters<typeof setChapterSource>[3]
>;
export type WikiGraphChapterTreeInput = Parameters<typeof applyChapterTree>[1];

export interface WikiGraphArchiveLocation {
  readonly archiveFile: File;
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly indexScope: QueryIndexScope;
  readonly libraryArchiveTarget?: ParsedWikiGraphLibraryUri;
  readonly libraryDirtyTarget?: ParsedWikiGraphLibraryUri;
  readonly locatedUri: string;
  readonly publicArchiveUri?: string;
}

export interface WikiGraphArchiveCreateOptions extends WikiGraphOperationOptions {
  readonly importPath?: string;
  readonly onProgress?: WikiGraphProgressCallback;
  readonly path: string;
  readonly replace?: boolean;
}

export interface WikiGraphArchiveCreateResult {
  readonly locatedUri: string;
  readonly path: string;
}

export class WikiGraphArchiveExistsError extends Error {
  public readonly code = "WIKI_GRAPH_ARCHIVE_EXISTS";
  public readonly path: string;

  public constructor(path: string) {
    super(`Archive already exists: ${path}`);
    this.name = "WikiGraphArchiveExistsError";
    this.path = path;
  }
}

export interface WikiGraphArchiveWriteOptions extends WikiGraphOperationOptions {
  readonly onIndexSyncError?: (error: unknown) => void;
  readonly refreshLibraryIndex?: boolean;
  readonly searchIndexWritebackPolicy?: "archive" | "cache";
}

export interface WikiGraphArchiveIndexStatus {
  readonly capabilities: SearchIndexCapabilityStatus;
  readonly current: boolean;
}

export interface WikiGraphArchiveCover {
  readonly data: Uint8Array;
  readonly mediaType: string;
  readonly path: string;
}

export interface WikiGraphArchiveIndexSyncOptions extends WikiGraphOperationOptions {
  readonly onProgress?: (
    event: SearchIndexProgressEvent,
  ) => void | Promise<void>;
  readonly skipUnindexed?: boolean;
}

export interface WikiGraphChapterArtifactStatus {
  readonly artifact?: {
    readonly createdAt: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly sourceRevision: number;
  };
  readonly chapterId: number;
  readonly current: boolean;
  readonly kind: IndexArtifactKind;
  readonly missing: boolean;
  readonly revision: number;
}

export interface WikiGraphChapterMoveOptions {
  readonly afterPath?: string;
  readonly beforePath?: string;
  readonly first?: boolean;
  readonly last?: boolean;
  readonly parentPath?: string;
  readonly root?: boolean;
}

export interface WikiGraphArchiveScopeOptions {
  readonly chapters?: readonly number[];
  readonly depth?: number;
}

export interface WikiGraphArchiveSearchOptions
  extends
    Omit<ArchiveFindOptions, "archiveKey" | "chapters">,
    WikiGraphArchiveScopeOptions,
    WikiGraphOperationOptions {}

export interface WikiGraphArchiveListOptions
  extends
    Omit<ArchiveCollectionOptions, "chapters">,
    WikiGraphArchiveScopeOptions,
    WikiGraphOperationOptions {}

export interface WikiGraphArchivePageOptions extends WikiGraphOperationOptions {
  readonly backlinks?: boolean;
  readonly evidenceLimit?: number;
  readonly order?: "doc-asc" | "doc-desc";
  readonly sourceContext?: number;
}

export interface WikiGraphArchiveRelatedOptions extends WikiGraphOperationOptions {
  readonly cursor?: string;
  readonly evidenceLimit?: number;
  readonly limit?: number;
  readonly order?: "doc-asc" | "doc-desc";
  readonly query?: string;
  readonly role?: "any" | "object" | "self" | "subject";
  readonly skipUnindexed?: boolean;
  readonly sourceContext?: number;
}

export interface WikiGraphArchiveEvidenceOptions extends WikiGraphOperationOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly order?: "doc-asc" | "doc-desc";
  readonly query?: string;
  readonly skipUnindexed?: boolean;
  readonly sourceContext?: number;
}

export interface WikiGraphArchiveScope {
  readonly chapterIds: readonly number[];
  readonly entries: readonly ChapterEntry[];
}

export class WikiGraphArchiveManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async create(
    options: WikiGraphArchiveCreateOptions,
  ): Promise<WikiGraphArchiveCreateResult> {
    return await this.#runtime.run(async () => {
      const path = resolveWikiGraphRuntimePath(options.path);
      if (options.replace !== true && (await nodePathExists(path))) {
        throw new WikiGraphArchiveExistsError(path);
      }
      const outputPath = join(
        dirname(path),
        `.${basename(path)}.${randomUUID()}.tmp.wikg`,
      );
      try {
        if (options.importPath === undefined) {
          await createEmptyArchiveFile(outputPath);
        } else {
          await new WikiGraphConversionManager(this.#runtime).convert({
            input: { format: "epub", path: options.importPath },
            ...(options.onProgress === undefined
              ? {}
              : { onProgress: options.onProgress }),
            output: { format: "wikg", path: outputPath },
            targetStage: "sourced",
          });
        }
        if (options.replace === true) {
          await rename(outputPath, path);
        } else {
          try {
            // A hard-link is an atomic no-clobber publish because the private
            // temporary file lives beside the target on the same filesystem.
            await link(outputPath, path);
          } catch (error) {
            if (isNodeEEXISTError(error)) {
              throw new WikiGraphArchiveExistsError(path);
            }
            throw error;
          }
        }
        return { locatedUri: formatLocatedWikiGraphUri(path), path };
      } finally {
        await rm(outputPath, { force: true, recursive: true });
      }
    }, options.signal);
  }

  public async open(
    uriOrPath: string,
    options: WikiGraphOperationOptions = {},
  ): Promise<WikiGraphArchiveHandle> {
    const location = await this.#runtime.run(
      async () => await resolveWikiGraphArchiveLocation(uriOrPath),
      options.signal,
    );
    return new WikiGraphArchiveHandle(this.#runtime, location);
  }
}

export class WikiGraphArchiveHandle {
  readonly #runtime: WikiGraphJobRuntime;
  readonly #location: WikiGraphArchiveLocation;

  public constructor(
    runtime: WikiGraphJobRuntime,
    location: WikiGraphArchiveLocation,
  ) {
    this.#runtime = runtime;
    this.#location = location;
  }

  public get archiveKey(): string {
    return this.#location.archiveKey;
  }

  public get indexScope(): QueryIndexScope {
    return this.#location.indexScope;
  }

  public get locatedUri(): string {
    return this.#location.locatedUri;
  }

  public get objectUri(): string {
    return (
      parseLocatedWikiGraphUri(this.#location.locatedUri).objectUri ?? "wikg://"
    );
  }

  public get path(): string {
    return this.#location.archivePath;
  }

  public async inspect(
    options: WikiGraphOperationOptions & { readonly chapterId?: number } = {},
  ): Promise<WikiGraphArchiveInspectReport> {
    return await this.#readDocument(
      async (document) =>
        await createWikiGraphArchiveInspectReport(document, {
          archiveUri: this.#location.publicArchiveUri ?? this.locatedUri,
          ...(options.chapterId === undefined
            ? {}
            : { chapterId: options.chapterId }),
        }),
      options,
    );
  }

  public async search(
    query: string,
    options: WikiGraphArchiveSearchOptions = {},
  ): Promise<ArchiveFindResult> {
    const embeddingProvider = await this.#runtime.run(
      createConfiguredEmbeddingProvider,
      options.signal,
    );
    return await this.#writeDocument(
      async (document) => {
        const chapters = await this.#resolveQueryChapters(document, options);
        await ensureArchiveSearchIndex(document, {
          ...(chapters === undefined ? {} : { chapters }),
          ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
        });
        return await findArchiveObjects(document, query, {
          ...withoutOperationAndScope(options),
          archiveKey: this.archiveKey,
          ...(chapters === undefined ? {} : { chapters }),
          ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
        });
      },
      {
        searchIndexWritebackPolicy: "cache",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  }

  public async list(
    options: WikiGraphArchiveListOptions = {},
  ): Promise<ArchiveCollectionResult | ArchiveSourceLocatorResult> {
    return await this.#readDocument(async (document) => {
      if (isSourceLocatorScopeUri(this.objectUri)) {
        return await listArchiveSourceLocators(document, this.objectUri, {
          ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        });
      }
      const chapters = await this.#resolveScope(document, options);
      return await listArchiveCollection(document, {
        ...withoutOperationAndScope(options),
        ...(chapters === undefined ? {} : { chapters }),
      });
    }, options);
  }

  public async ensureSearchIndex(
    options: WikiGraphArchiveScopeOptions & WikiGraphOperationOptions = {},
  ): Promise<void> {
    const embeddingProvider = await this.#runtime.run(
      createConfiguredEmbeddingProvider,
      options.signal,
    );
    await this.#writeDocument(
      async (document) => {
        const chapters = await this.#resolveScope(document, options);
        await ensureArchiveSearchIndex(document, {
          ...(chapters === undefined ? {} : { chapters }),
          ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
        });
      },
      {
        searchIndexWritebackPolicy: "cache",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  }

  public async getSearchIndexStatus(
    options: WikiGraphOperationOptions = {},
  ): Promise<WikiGraphArchiveIndexStatus> {
    return await this.#readDocument(
      async (document) => ({
        capabilities: await readSearchIndexCapabilityStatus(document),
        current: await isArchiveSearchIndexCurrent(document),
      }),
      options,
    );
  }

  public async syncSearchIndex(
    options: WikiGraphArchiveIndexSyncOptions = {},
  ): Promise<{ readonly rebuilt: boolean }> {
    const rebuilt = await this.#writeDocument(
      async (document) => {
        const scope =
          options.skipUnindexed === true
            ? { chapters: await listArchiveQueryableChapterIds(document) }
            : {};
        if (scope.chapters?.length === 0) {
          throw new Error(
            "Wiki Graph index cache is not ready. No chapters have a current FTS artifact or source embedding artifact.",
          );
        }
        if (await isArchiveSearchIndexCurrent(document, scope)) return false;
        await rebuildArchiveSearchIndex(document, options.onProgress, scope);
        return true;
      },
      {
        searchIndexWritebackPolicy: "cache",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    await this.#runtime.run(
      async () => await deleteArchiveSearchSessions(this.path),
      options.signal,
    );
    return { rebuilt };
  }

  public async cleanSearchIndex(
    options: WikiGraphOperationOptions = {},
  ): Promise<WikiGraphArchiveIndexStatus> {
    const status = await this.#writeDocument(
      async (document) => {
        await document.deleteSearchIndexDatabase();
        return {
          capabilities: {
            dense: { current: false },
            indexes: "missing" as const,
          },
          current: false,
        };
      },
      {
        searchIndexWritebackPolicy: "cache",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    await this.#runtime.run(
      async () => await deleteArchiveSearchSessions(this.path),
      options.signal,
    );
    return status;
  }

  public async listChapters(
    options: WikiGraphOperationOptions = {},
  ): Promise<readonly ChapterEntry[]> {
    return await this.#readDocument(
      async (document) => await listChapters(document),
      options,
    );
  }

  public async getChapter(
    path: string,
    options: WikiGraphOperationOptions = {},
  ): Promise<ChapterEntry> {
    return await this.#readDocument(async (document) => {
      const chapterId = await resolveChapterPathReadonly(document, path);
      return requireChapter(await listChapters(document), chapterId);
    }, options);
  }

  public async addChapter(options: {
    readonly parentPath?: string;
    readonly source?: string;
    readonly title?: string;
  }): Promise<ChapterDetails> {
    return await this.#writeDocument(async (document) => {
      const parentChapterId = await resolveOptionalChapterPath(
        document,
        options.parentPath,
      );
      await assertNoActiveBuildJobConflicts({
        archive: this.#location.archiveFile,
        operation: "Adding chapter",
        scope: { kind: "archive" },
      });
      let details = await addChapter(document, {
        ...(parentChapterId === undefined ? {} : { parentChapterId }),
        ...(options.title === undefined ? {} : { title: options.title }),
      });
      if (options.source !== undefined) {
        details = await setChapterSource(
          document,
          details.chapterId,
          asTextStream(options.source),
        );
      }
      return details;
    });
  }

  public async getChapterArtifact(
    path: string,
    kind: IndexArtifactKind,
  ): Promise<WikiGraphChapterArtifactStatus> {
    return await this.#readDocument(async (document) => {
      const chapterId = await resolveChapterPathReadonly(document, path);
      const [artifact, revision] = await Promise.all([
        document.indexArtifacts.get(chapterId, kind),
        document.serials.getRevision(chapterId),
      ]);
      return {
        ...(artifact === undefined
          ? {}
          : {
              artifact: {
                createdAt: artifact.createdAt,
                metadata: artifact.metadata,
                sourceRevision: artifact.sourceRevision,
              },
            }),
        chapterId,
        current: artifact?.sourceRevision === revision,
        kind,
        missing: artifact === undefined,
        revision,
      };
    });
  }

  public async deleteChapterArtifact(
    path: string,
    kind: IndexArtifactKind,
  ): Promise<{
    readonly chapterId: number;
    readonly deleted: true;
    readonly kind: IndexArtifactKind;
  }> {
    return await this.#writeDocument(async (document) => {
      const chapterId = await resolveChapterPathReadonly(document, path);
      await document.indexArtifacts.delete(chapterId, kind);
      return { chapterId, deleted: true, kind };
    });
  }

  public async moveChapter(
    path: string,
    options: WikiGraphChapterMoveOptions,
  ): Promise<ChapterDetails> {
    return await this.#writeDocument(async (document) => {
      const chapterId = await resolveChapterPathReadonly(document, path);
      const [afterChapterId, beforeChapterId, parentChapterId] =
        await Promise.all([
          resolveOptionalChapterPath(document, options.afterPath),
          resolveOptionalChapterPath(document, options.beforePath),
          resolveOptionalChapterPath(document, options.parentPath),
        ]);
      await assertNoActiveBuildJobConflicts({
        archive: this.#location.archiveFile,
        operation: "Moving chapter",
        scope: { kind: "archive" },
      });
      return await moveChapter(document, chapterId, {
        ...(afterChapterId === undefined ? {} : { afterChapterId }),
        ...(beforeChapterId === undefined ? {} : { beforeChapterId }),
        ...(parentChapterId === undefined ? {} : { parentChapterId }),
        ...(options.first === undefined ? {} : { first: options.first }),
        ...(options.last === undefined ? {} : { last: options.last }),
        ...(options.root === undefined ? {} : { root: options.root }),
      });
    });
  }

  public async removeChapter(path: string, recursive = false): Promise<void> {
    await this.#writeDocument(async (document) => {
      const chapterId = await resolveChapterPathReadonly(document, path);
      await assertNoActiveBuildJobConflicts({
        archive: this.#location.archiveFile,
        operation: "Removing chapter",
        scope: { kind: "archive" },
      });
      await removeChapter(document, chapterId, { recursive });
    });
  }

  public async resetChapter(
    path: string,
    stage: WikiGraphChapterResetStage,
  ): Promise<ChapterDetails> {
    return await this.#writeDocument(async (document) => {
      const chapterId = await resolveChapterPathReadonly(document, path);
      await assertChapterResetAllowed(
        this.#location.archiveFile,
        chapterId,
        stage,
      );
      return await resetChapter(document, chapterId, stage);
    });
  }

  public async setChapterSource(
    path: string,
    source: string,
    options: WikiGraphChapterSourceOptions = {},
  ): Promise<ChapterDetails> {
    return await this.#writeDocument(async (document) => {
      const chapterId = await resolveChapterPathReadonly(document, path);
      await assertNoActiveBuildJobs({
        archive: this.#location.archiveFile,
        chapterIds: [chapterId],
        operation: "Setting chapter source",
      });
      return await setChapterSource(
        document,
        chapterId,
        asTextStream(source),
        options,
      );
    });
  }

  public async setChapterSummary(
    path: string,
    summary: string,
  ): Promise<ChapterDetails> {
    return await this.#writeDocument(async (document) => {
      const chapterId = await resolveChapterPathReadonly(document, path);
      await assertNoActiveBuildJobs({
        archive: this.#location.archiveFile,
        chapterIds: [chapterId],
        operation: "Setting chapter summary",
        requiresTarget: "reading-summary",
      });
      return await setChapterSummary(document, chapterId, summary);
    });
  }

  public async setChapterTitle(
    path: string,
    title: Parameters<typeof setChapterTitle>[2],
  ): Promise<ChapterDetails> {
    return await this.#writeDocument(async (document) => {
      const chapterId = await resolveChapterPathReadonly(document, path);
      await assertNoActiveBuildJobs({
        archive: this.#location.archiveFile,
        chapterIds: [chapterId],
        operation: "Setting chapter title",
      });
      return await setChapterTitle(document, chapterId, title);
    });
  }

  public async getChapterTree(): Promise<ChapterTree> {
    return await this.#readDocument(
      async (document) => await getChapterTree(document),
    );
  }

  public async applyChapterTree(
    tree: WikiGraphChapterTreeInput,
    options: { readonly dryRun?: boolean } = {},
  ): Promise<ChapterTreeApplyResult> {
    return await this.#writeDocument(
      async (document) => {
        if (options.dryRun !== true) {
          await assertNoActiveBuildJobConflicts({
            archive: this.#location.archiveFile,
            operation: "Changing chapter tree",
            scope: { kind: "archive" },
          });
        }
        return await applyChapterTree(document, tree, {
          dryRun: options.dryRun ?? false,
        });
      },
      { refreshLibraryIndex: options.dryRun !== true },
    );
  }

  public async page(
    objectUri = this.objectUri,
    options: WikiGraphArchivePageOptions = {},
  ): Promise<ArchivePage> {
    return await this.#runtime.run(
      async () =>
        await withConfiguredWikimediaResolver(
          objectUri,
          async (wikimediaOptions) =>
            await this.#readDocument(
              async (document) =>
                await readArchivePage(document, objectUri, {
                  ...withoutOperation(options),
                  ...wikimediaOptions,
                }),
              options,
            ),
        ),
      options.signal,
    );
  }

  public async related(
    objectUri = this.objectUri,
    options: WikiGraphArchiveRelatedOptions = {},
  ): Promise<ArchiveRelatedResult> {
    if (options.query === undefined) {
      return await this.#readDocument(async (document) => {
        const chapters = await this.#resolveScope(document, {});
        return await listRelatedArchiveObjects(document, objectUri, {
          ...withoutOperation(options),
          ...(chapters === undefined ? {} : { chapters }),
        });
      }, options);
    }
    const embeddingProvider = await this.#runtime.run(
      createConfiguredEmbeddingProvider,
      options.signal,
    );
    return await this.#writeDocument(
      async (document) => {
        const chapters = await this.#resolveQueryChapters(document, options);
        await ensureArchiveSearchIndex(document, {
          ...(chapters === undefined ? {} : { chapters }),
          ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
        });
        return await listRelatedArchiveObjects(document, objectUri, {
          ...withoutOperation(options),
          ...(chapters === undefined ? {} : { chapters }),
        });
      },
      {
        searchIndexWritebackPolicy: "cache",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  }

  public async evidence(
    objectUri = this.objectUri,
    options: WikiGraphArchiveEvidenceOptions = {},
  ): Promise<ArchiveEvidence> {
    if (options.query === undefined) {
      return await this.#readDocument(async (document) => {
        const chapters = await this.#resolveScope(document, {});
        return await listArchiveEvidence(document, objectUri, {
          ...withoutOperation(options),
          ...(chapters === undefined ? {} : { chapters }),
        });
      }, options);
    }
    const embeddingProvider = await this.#runtime.run(
      createConfiguredEmbeddingProvider,
      options.signal,
    );
    return await this.#writeDocument(
      async (document) => {
        const chapters = await this.#resolveQueryChapters(document, options);
        await ensureArchiveSearchIndex(document, {
          ...(chapters === undefined ? {} : { chapters }),
          ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
        });
        return await listArchiveEvidence(document, objectUri, {
          ...withoutOperation(options),
          ...(chapters === undefined ? {} : { chapters }),
        });
      },
      {
        searchIndexWritebackPolicy: "cache",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  }

  public async pack(
    objectUri = this.objectUri,
    budget = 5_000,
    options: WikiGraphOperationOptions = {},
  ): Promise<ArchivePack> {
    return await this.#readDocument(
      async (document) => await packArchiveContext(document, objectUri, budget),
      options,
    );
  }

  public async getMetadata(
    objectPath: string,
    options: WikiGraphOperationOptions = {},
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#readDocument(
      async (document) => await document.metadata.getMap(objectPath),
      options,
    );
  }

  public async readBookMeta(
    options: WikiGraphOperationOptions = {},
  ): Promise<BookMeta | undefined> {
    return await this.#readDocument(
      async (document) => await document.readBookMeta(),
      options,
    );
  }

  public async replaceBookMeta(
    meta: BookMeta,
    options: WikiGraphArchiveWriteOptions = {},
  ): Promise<BookMeta> {
    return await this.#writeDocument(async (document) => {
      await document.replaceBookMeta(meta);
      return meta;
    }, options);
  }

  public async readCover(
    options: WikiGraphOperationOptions = {},
  ): Promise<WikiGraphArchiveCover | undefined> {
    const app = new WikiGraph({});
    return await this.#runtime.run(
      async () =>
        await app.openSession(
          this.#location.archiveFile,
          async (archive) => await archive.readCover(),
        ),
      options.signal,
    );
  }

  public async replaceMetadata(
    objectPath: string,
    value: Readonly<Record<string, unknown>>,
    options: WikiGraphArchiveWriteOptions = {},
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#writeDocument(async (document) => {
      await document.metadata.replaceMap(
        parseObjectMetadataTarget(objectPath),
        value,
      );
      return await document.metadata.getMap(objectPath);
    }, options);
  }

  public async putMetadata(
    objectPath: string,
    key: string,
    value: unknown,
    options: WikiGraphArchiveWriteOptions = {},
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#writeDocument(async (document) => {
      await document.metadata.put(
        parseObjectMetadataTarget(objectPath),
        key,
        value,
      );
      return await document.metadata.getMap(objectPath);
    }, options);
  }

  public async deleteMetadata(
    objectPath: string,
    key: string,
    options: WikiGraphArchiveWriteOptions = {},
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#writeDocument(async (document) => {
      await document.metadata.deleteKey(objectPath, key);
      return await document.metadata.getMap(objectPath);
    }, options);
  }

  public async clearMetadata(
    objectPath: string,
    options: WikiGraphArchiveWriteOptions = {},
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#writeDocument(async (document) => {
      await document.metadata.clear(objectPath);
      return await document.metadata.getMap(objectPath);
    }, options);
  }

  public async resolveScope(
    options: WikiGraphArchiveScopeOptions & WikiGraphOperationOptions = {},
  ): Promise<WikiGraphArchiveScope | undefined> {
    return await this.#readDocument(
      async (document) =>
        await resolveArchiveScope(document, this.objectUri, options.depth),
      options,
    );
  }

  async #readDocument<T>(
    operation: (document: ReadonlyDocument) => Promise<T> | T,
    options: WikiGraphOperationOptions = {},
  ): Promise<T> {
    return await this.#runtime.run(
      async () =>
        await new WikiGraphArchiveFile(this.#location.archiveFile).readDocument(
          operation,
        ),
      options.signal,
    );
  }

  async #writeDocument<T>(
    operation: (document: DirectoryDocument) => Promise<T> | T,
    options: WikiGraphArchiveWriteOptions = {},
  ): Promise<T> {
    return await this.#runtime.run(async () => {
      const result = await new WikiGraphArchiveFile(
        this.#location.archiveFile,
      ).write(operation, {
        ...(options.searchIndexWritebackPolicy === undefined
          ? {}
          : {
              searchIndexWritebackPolicy: options.searchIndexWritebackPolicy,
            }),
      });
      if (options.refreshLibraryIndex !== false) {
        await this.#refreshLibraryIndex(options.onIndexSyncError);
      }
      return result;
    }, options.signal);
  }

  async #resolveScope(
    document: ReadonlyDocument,
    options: WikiGraphArchiveScopeOptions,
  ): Promise<readonly number[] | undefined> {
    if (options.chapters !== undefined) return options.chapters;
    return (await resolveArchiveScope(document, this.objectUri, options.depth))
      ?.chapterIds;
  }

  async #resolveQueryChapters(
    document: ReadonlyDocument,
    options: WikiGraphArchiveScopeOptions & {
      readonly skipUnindexed?: boolean;
    },
  ): Promise<readonly number[] | undefined> {
    const chapters = await this.#resolveScope(document, options);
    if (options.skipUnindexed !== true) return chapters;
    const queryable = await listArchiveQueryableChapterIds(document, {
      ...(chapters === undefined ? {} : { chapters }),
    });
    if (queryable.length === 0) {
      throw new Error(
        "Wiki Graph query is not ready. No chapters in this scope have a current FTS artifact or source embedding artifact.",
      );
    }
    return queryable;
  }

  async #refreshLibraryIndex(
    onError: ((error: unknown) => void) | undefined,
  ): Promise<void> {
    if (this.#location.libraryDirtyTarget === undefined) return;
    if (this.#location.libraryArchiveTarget !== undefined) {
      await finalizeWikiGraphLibraryArchiveWrite({
        target: this.#location.libraryArchiveTarget,
      });
    }
    try {
      const state = await readWikiGraphLibraryIndexState(
        this.#location.libraryDirtyTarget,
      );
      if (state.status !== "missing") {
        await rebuildWikiGraphLibraryIndex(this.#location.libraryDirtyTarget);
      }
    } catch (error) {
      onError?.(error);
    }
  }
}

export async function resolveWikiGraphArchiveLocation(
  uriOrPath: string,
): Promise<WikiGraphArchiveLocation> {
  if (!uriOrPath.startsWith("wikg://")) {
    return createPathLocation(resolveWikiGraphRuntimePath(uriOrPath));
  }
  const parsed = parseLocatedWikiGraphUri(uriOrPath);
  const portableArchiveLocator = parsed.archivePath ?? uriOrPath;
  const archiveLocator = portableArchiveLocator.startsWith("wikg://lib/")
    ? portableArchiveLocator
    : resolveWikiGraphRuntimePath(portableArchiveLocator);
  const libraryArchiveTarget = archiveLocator.startsWith("wikg://lib/")
    ? parseWikiGraphLibraryUri(archiveLocator)
    : undefined;
  const archiveFile =
    libraryArchiveTarget?.kind === "archive"
      ? await resolveWikiGraphLibraryArchiveFile(archiveLocator)
      : new NodeFile(archiveLocator);
  const archivePath = getNodeResourcePath(archiveFile);
  return {
    archiveFile,
    archiveKey: archivePath,
    archivePath,
    indexScope: { archiveKey: archivePath, archivePath, kind: "archive-index" },
    ...(libraryArchiveTarget?.kind === "archive"
      ? {
          libraryArchiveTarget,
          libraryDirtyTarget: {
            isDefault: libraryArchiveTarget.isDefault,
            kind: "scope" as const,
            ...(libraryArchiveTarget.publicId === undefined
              ? {}
              : { publicId: libraryArchiveTarget.publicId }),
          },
          publicArchiveUri: portableArchiveLocator,
        }
      : {}),
    locatedUri: formatLocatedWikiGraphUri(archivePath, parsed.objectUri),
  };
}

async function ensureArchiveSearchIndex(
  document: DirectoryDocument,
  options: {
    readonly chapters?: readonly number[];
    readonly embeddingProvider?: SearchIndexEmbeddingProvider;
  } = {},
): Promise<void> {
  const scope =
    options.chapters === undefined ? {} : { chapters: options.chapters };
  if (await isArchiveSearchIndexCurrent(document, scope)) return;
  await rebuildArchiveSearchIndex(document, undefined, {
    ...scope,
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
  });
}

async function resolveArchiveScope(
  document: ReadonlyDocument,
  objectUri: string,
  depth: number | undefined,
): Promise<WikiGraphArchiveScope | undefined> {
  const parsed = parseChapterScopePath(objectUri);
  if (
    parsed === undefined ||
    (parsed.kind === "collection" && depth === undefined)
  ) {
    return undefined;
  }
  const chapters = await listChapters(document);
  const entries =
    parsed.kind === "collection"
      ? chapters.filter((chapter) => chapter.depth <= depth!)
      : selectChapterSubtree(
          chapters,
          await resolveChapterPathReadonly(document, parsed.chapterPath),
          depth,
        );
  return { chapterIds: entries.map((entry) => entry.chapterId), entries };
}

function parseChapterScopePath(
  objectUri: string,
):
  | { readonly kind: "collection" }
  | { readonly chapterPath: string; readonly kind: "chapter" }
  | undefined {
  if (objectUri === "wikg://chapter" || objectUri === "wikg://chapter/") {
    return { kind: "collection" };
  }
  const match = /^wikg:\/\/chapter\/([^/].*?)(?:\/)?$/u.exec(objectUri);
  return match?.[1] === undefined
    ? undefined
    : { chapterPath: decodeURIComponent(match[1]), kind: "chapter" };
}

function selectChapterSubtree(
  chapters: readonly ChapterEntry[],
  rootChapterId: number,
  depth: number | undefined,
): readonly ChapterEntry[] {
  const root = chapters.find((chapter) => chapter.chapterId === rootChapterId);
  if (root === undefined) {
    throw new Error(`Chapter ${rootChapterId} does not exist.`);
  }
  const prefix = `${root.path}/`;
  return chapters.filter(
    (chapter) =>
      chapter.chapterId === root.chapterId ||
      (chapter.path.startsWith(prefix) &&
        (depth === undefined || chapter.depth - root.depth <= depth)),
  );
}

function createPathLocation(path: string): WikiGraphArchiveLocation {
  return {
    archiveFile: new NodeFile(path),
    archiveKey: path,
    archivePath: path,
    indexScope: { archiveKey: path, archivePath: path, kind: "archive-index" },
    locatedUri: formatLocatedWikiGraphUri(path),
  };
}

async function createEmptyArchiveFile(path: string): Promise<void> {
  const directoryPath = await mkdtemp(
    join(tmpdir(), "wikigraph-archive-write-"),
  );
  try {
    const directory = new NodeDirectory(directoryPath);
    const document = await DirectoryDocument.open(directory);
    try {
      await document.openSession(async (openedDocument) => {
        await openedDocument.writeToc({ items: [], version: TOC_FILE_VERSION });
      });
    } finally {
      await document.release();
    }
    await writeWikgArchive(directory, new NodeFile(path));
  } finally {
    await rm(directoryPath, { force: true, recursive: true });
  }
}

function isNodeEEXISTError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

async function nodePathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeENOENTError(error)) return false;
    throw error;
  }
}

function isNodeENOENTError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function parseObjectMetadataTarget(objectPath: string): ObjectMetadataTarget {
  if (objectPath === "") {
    return { kind: ObjectMetadataKind.Archive, objectPath };
  }
  const chapter = /^chapter\/([1-9][0-9]*)(?:\/.*)?$/u.exec(objectPath);
  if (chapter?.[1] !== undefined) {
    return {
      chapterId: Number(chapter[1]),
      kind: ObjectMetadataKind.Chapter,
      objectPath,
    };
  }
  const chunk = /^chunk\/([1-9][0-9]*)$/u.exec(objectPath);
  if (chunk?.[1] !== undefined) {
    return {
      chunkId: Number(chunk[1]),
      kind: ObjectMetadataKind.Chunk,
      objectPath,
    };
  }
  const entity = /^entity\/(Q[1-9][0-9]*)$/u.exec(objectPath);
  if (entity?.[1] !== undefined) {
    return {
      entityQid: entity[1],
      kind: ObjectMetadataKind.Entity,
      objectPath,
    };
  }
  const triple = /^triple\/(Q[1-9][0-9]*)\/([^/]+)\/(Q[1-9][0-9]*)$/u.exec(
    objectPath,
  );
  if (triple?.[1] !== undefined) {
    return {
      kind: ObjectMetadataKind.Triple,
      objectPath,
      tripleObjectQid: triple[3]!,
      triplePredicate: decodeURIComponent(triple[2]!),
      tripleSubjectQid: triple[1],
    };
  }
  return { kind: ObjectMetadataKind.Object, objectPath };
}

function withoutOperation<T extends WikiGraphOperationOptions>(
  options: T,
): Omit<T, "signal"> {
  const { signal: _signal, ...rest } = options;
  return rest;
}

function withoutOperationAndScope<
  T extends WikiGraphOperationOptions & WikiGraphArchiveScopeOptions,
>(options: T): Omit<T, "chapters" | "depth" | "signal"> {
  const {
    chapters: _chapters,
    depth: _depth,
    signal: _signal,
    ...rest
  } = options;
  return rest;
}

async function resolveOptionalChapterPath(
  document: ReadonlyDocument,
  path: string | undefined,
): Promise<number | undefined> {
  return path === undefined
    ? undefined
    : await resolveChapterPathReadonly(document, path);
}

function requireChapter(
  chapters: readonly ChapterEntry[],
  chapterId: number,
): ChapterEntry {
  const chapter = chapters.find((entry) => entry.chapterId === chapterId);
  if (chapter === undefined) {
    throw new Error(`Chapter internal id ${chapterId} does not exist.`);
  }
  return chapter;
}

function asTextStream(text: string): AsyncIterable<string> {
  return Readable.from([text]);
}

async function assertChapterResetAllowed(
  archive: File,
  chapterId: number,
  stage: WikiGraphChapterResetStage,
): Promise<void> {
  if (stage === "planned") {
    await assertNoActiveBuildJobs({
      archive,
      chapterIds: [chapterId],
      operation: "Resetting chapter to planned",
    });
    return;
  }
  if (stage === "sourced") {
    await assertNoActiveBuildJobs({
      archive,
      chapterIds: [chapterId],
      operation: "Resetting chapter graph",
      requiresTarget: "reading-graph",
    });
  }
  await assertNoActiveBuildJobs({
    archive,
    chapterIds: [chapterId],
    operation: "Resetting chapter summary",
    requiresTarget: "reading-summary",
  });
}

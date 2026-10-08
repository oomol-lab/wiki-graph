import {
  addWikiGraphLibraryArchive,
  assertWikiGraphLibrarySchemaCurrent,
  cleanWikiGraphLibraryIndex,
  clearWikiGraphLibraryMetadata,
  createWikiGraphLibrary,
  deleteWikiGraphLibraryMetadataKey,
  findWikiGraphLibraryObjects,
  findWikiGraphLibraryArchiveMembers,
  formatWikiGraphLibraryUri,
  getWikiGraphLibraryArchive,
  getWikiGraphLibraryMetadata,
  listRelatedWikiGraphLibraryObjects,
  listWikiGraphLibraries,
  listWikiGraphLibraryArchives,
  listWikiGraphLibraryArchiveMembers,
  listWikiGraphLibraryEvidence,
  listWikiGraphLibraryObjects,
  moveWikiGraphLibraryArchive,
  packWikiGraphLibraryContext,
  parseWikiGraphLibraryUri,
  putWikiGraphLibraryMetadata,
  readWikiGraphLibraryIndexState,
  readWikiGraphLibraryPage,
  rebuildWikiGraphLibraryIndex,
  rebindWikiGraphLibrary,
  removeWikiGraphLibrary,
  removeWikiGraphLibraryArchive,
  replaceWikiGraphLibraryArchive,
  replaceWikiGraphLibraryMetadata,
  resolveWikiGraphLibrary,
  scanWikiGraphLibrary,
  withWikiGraphLibraryLock,
  type ArchiveCollectionOptions,
  type ArchiveCollectionResult,
  type ArchiveEvidence,
  type ArchiveFindOptions,
  type ArchiveFindResult,
  type ArchivePack,
  type ArchivePage,
  type ArchiveRelatedResult,
  type ParsedWikiGraphLibraryUri,
  type SearchIndexEmbeddingProvider,
  type SearchIndexQueryMode,
  type WikiGraphLibraryArchiveRecord,
  type WikiGraphLibraryIndexState,
  type WikiGraphLibraryRecord,
  type WikiGraphLibraryScanResult,
  type FileReader,
} from "wiki-graph-core";
import { mkdir } from "fs/promises";

import type { WikiGraphJobRuntime } from "./jobs.js";
import {
  getNodeResourcePath,
  NodeDirectory,
  NodeFile,
} from "./node-platform.js";
import { resolveWikiGraphRuntimePath } from "./runtime-path.js";
import {
  createConfiguredEmbeddingProvider,
  withConfiguredWikimediaResolver,
} from "./query-runtime.js";
import { assertStandaloneWikiGraphArchivePath } from "./archive/target.js";

export type WikiGraphLibraryTarget = ParsedWikiGraphLibraryUri | string;

async function resolveQueryEmbeddingProvider(
  queryMode: SearchIndexQueryMode | undefined,
): Promise<SearchIndexEmbeddingProvider | undefined> {
  if (queryMode === "fts") return undefined;
  const provider = await createConfiguredEmbeddingProvider();
  if (queryMode === "embedding" && provider === undefined) {
    throw new Error(
      "Embedding query mode requires embeddings configuration at `wikg://local/config/embeddings`.",
    );
  }
  return provider;
}

export type WikiGraphLibrarySearchOptions = Omit<
  ArchiveFindOptions,
  "embeddingProvider"
>;
export type WikiGraphLibraryRelatedOptions = Omit<
  NonNullable<Parameters<typeof listRelatedWikiGraphLibraryObjects>[2]>,
  "embeddingProvider"
>;
export type WikiGraphLibraryEvidenceOptions = Omit<
  NonNullable<Parameters<typeof listWikiGraphLibraryEvidence>[2]>,
  "embeddingProvider"
>;
export type WikiGraphLibraryPageOptions = Omit<
  Parameters<typeof readWikiGraphLibraryPage>[2],
  "wikimediaResolver"
> & { readonly signal?: AbortSignal };

export interface WikiGraphLibraryAddArchiveOptions {
  readonly inputPath: string;
  readonly target: WikiGraphLibraryTarget;
  readonly to?: string;
}

export interface WikiGraphLibraryMoveArchiveOptions {
  readonly target: WikiGraphLibraryTarget;
  readonly to: string;
}

export interface WikiGraphLibraryReplaceArchiveOptions {
  readonly inputPath: string;
  readonly target: WikiGraphLibraryTarget;
}

export interface WikiGraphLibraryArchiveContent {
  readonly mediaType: "application/vnd.wiki-graph.archive";
  readonly size: number;
  readonly stream: AsyncIterable<Uint8Array>;
  readonly uri: string;
}

export interface WikiGraphLibraryArchiveReadOptions {
  readonly signal?: AbortSignal;
}

export interface WikiGraphLibrarySnapshot extends Omit<
  WikiGraphLibraryRecord,
  "folder" | "staging"
> {
  readonly folderPath: string;
}

export type WikiGraphLibraryArchiveSnapshot = Omit<
  WikiGraphLibraryArchiveRecord,
  "file"
>;

export interface WikiGraphLibraryScanSnapshot {
  readonly archives: readonly WikiGraphLibraryArchiveSnapshot[];
  readonly library?: WikiGraphLibrarySnapshot;
}

export class WikiGraphLibraryManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async create(folder: string): Promise<WikiGraphLibrary> {
    const record = await this.#runtime.run(async () => {
      const path = resolveWikiGraphRuntimePath(folder);
      await mkdir(path);
      return await createWikiGraphLibrary({ folder: new NodeDirectory(path) });
    });
    return new WikiGraphLibrary(this.#runtime, record);
  }

  public async get(
    uri = formatWikiGraphLibraryUri(),
  ): Promise<WikiGraphLibrary> {
    const target = requireLibraryTarget(uri);
    const record = await this.#runtime.run(
      async () => await resolveWikiGraphLibrary(target),
    );
    return new WikiGraphLibrary(this.#runtime, record);
  }

  public async addArchive(
    options: WikiGraphLibraryAddArchiveOptions,
  ): Promise<WikiGraphLibraryArchiveSnapshot> {
    return toArchiveSnapshot(
      await this.#runtime.run(
        async () =>
          await addWikiGraphLibraryArchive({
            inputFile: new NodeFile(
              await assertStandaloneWikiGraphArchivePath(options.inputPath),
            ),
            target: requireLibraryTarget(options.target),
            ...(options.to === undefined ? {} : { to: options.to }),
          }),
      ),
    );
  }

  public async assertCurrent(target: WikiGraphLibraryTarget): Promise<void> {
    await this.#runtime.run(
      async () =>
        await assertWikiGraphLibrarySchemaCurrent(requireLibraryTarget(target)),
    );
  }

  public async rebind(
    target: WikiGraphLibraryTarget,
    folder: string,
  ): Promise<WikiGraphLibraryScanSnapshot> {
    return toScanSnapshot(
      await this.#runtime.run(
        async () =>
          await rebindWikiGraphLibrary({
            folder: new NodeDirectory(resolveWikiGraphRuntimePath(folder)),
            target: requireLibraryTarget(target),
          }),
      ),
    );
  }

  public async remove(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibrarySnapshot> {
    return toLibrarySnapshot(
      await this.#runtime.run(
        async () => await removeWikiGraphLibrary(requireLibraryTarget(target)),
      ),
    );
  }

  public async scan(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibraryScanSnapshot> {
    return toScanSnapshot(
      await this.#runtime.run(
        async () => await scanWikiGraphLibrary(requireLibraryTarget(target)),
      ),
    );
  }

  public async getArchive(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibraryArchiveSnapshot> {
    return toArchiveSnapshot(
      await this.#runtime.run(
        async () =>
          await getWikiGraphLibraryArchive(requireLibraryTarget(target)),
      ),
    );
  }

  public async readArchive<T>(
    target: WikiGraphLibraryTarget,
    consume: (content: WikiGraphLibraryArchiveContent) => Promise<T> | T,
    options: WikiGraphLibraryArchiveReadOptions = {},
  ): Promise<T> {
    return await this.#runtime.run(async () => {
      const parsedTarget = requireLibraryArchiveTarget(target);
      const library = await resolveWikiGraphLibrary(parsedTarget);

      return await withWikiGraphLibraryLock(
        library.id,
        "read",
        async () => {
          throwIfAborted(options.signal);
          const archive = await getWikiGraphLibraryArchive(parsedTarget);
          const file = requireReadableLibraryArchiveFile(archive);
          const reader = await file.openReader();
          let active = true;

          try {
            const content: WikiGraphLibraryArchiveContent = {
              mediaType: "application/vnd.wiki-graph.archive",
              size: reader.size,
              stream: createCallbackScopedArchiveStream(
                reader,
                () => active,
                options.signal,
              ),
              uri: archive.uri,
            };
            return await runAbortableCallback(
              async () => await consume(content),
              options.signal,
            );
          } finally {
            active = false;
            await reader.close();
          }
        },
        options.signal === undefined ? {} : { signal: options.signal },
      );
    }, options.signal);
  }

  public async moveArchive(
    options: WikiGraphLibraryMoveArchiveOptions,
  ): Promise<WikiGraphLibraryArchiveSnapshot> {
    return toArchiveSnapshot(
      await this.#runtime.run(
        async () =>
          await moveWikiGraphLibraryArchive({
            target: requireLibraryTarget(options.target),
            to: options.to,
          }),
      ),
    );
  }

  public async removeArchive(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibraryArchiveSnapshot> {
    return toArchiveSnapshot(
      await this.#runtime.run(
        async () =>
          await removeWikiGraphLibraryArchive({
            target: requireLibraryTarget(target),
          }),
      ),
    );
  }

  public async replaceArchive(
    options: WikiGraphLibraryReplaceArchiveOptions,
  ): Promise<WikiGraphLibraryArchiveSnapshot> {
    return toArchiveSnapshot(
      await this.#runtime.run(async () => {
        const target = requireLibraryTarget(options.target);
        const current = await getWikiGraphLibraryArchive(target);
        return await replaceWikiGraphLibraryArchive({
          additionalDerivedStateKeys:
            current.file === undefined
              ? []
              : [getNodeResourcePath(current.file)],
          inputFile: new NodeFile(
            await assertStandaloneWikiGraphArchivePath(options.inputPath),
          ),
          target,
        });
      }),
    );
  }

  public async indexState(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibraryIndexState> {
    return await this.#runtime.run(
      async () =>
        await readWikiGraphLibraryIndexState(requireLibraryTarget(target)),
    );
  }

  public async rebuildIndex(
    target: WikiGraphLibraryTarget,
    onProgress?: Parameters<typeof rebuildWikiGraphLibraryIndex>[1],
  ): Promise<WikiGraphLibraryIndexState> {
    return await this.#runtime.run(
      async () =>
        await rebuildWikiGraphLibraryIndex(
          requireLibraryTarget(target),
          onProgress,
        ),
    );
  }

  public async cleanIndex(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibraryIndexState> {
    return await this.#runtime.run(
      async () =>
        await cleanWikiGraphLibraryIndex(requireLibraryTarget(target)),
    );
  }

  public async getMetadata(
    target: WikiGraphLibraryTarget,
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#runtime.run(
      async () =>
        await getWikiGraphLibraryMetadata(requireLibraryTarget(target)),
    );
  }

  public async replaceMetadata(
    target: WikiGraphLibraryTarget,
    value: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#runtime.run(
      async () =>
        await replaceWikiGraphLibraryMetadata(
          requireLibraryTarget(target),
          value,
        ),
    );
  }

  public async putMetadata(
    target: WikiGraphLibraryTarget,
    key: string,
    value: unknown,
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#runtime.run(
      async () =>
        await putWikiGraphLibraryMetadata(
          requireLibraryTarget(target),
          key,
          value,
        ),
    );
  }

  public async deleteMetadata(
    target: WikiGraphLibraryTarget,
    key: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#runtime.run(
      async () =>
        await deleteWikiGraphLibraryMetadataKey(
          requireLibraryTarget(target),
          key,
        ),
    );
  }

  public async clearMetadata(
    target: WikiGraphLibraryTarget,
  ): Promise<Readonly<Record<string, unknown>>> {
    return await this.#runtime.run(
      async () =>
        await clearWikiGraphLibraryMetadata(requireLibraryTarget(target)),
    );
  }

  public async search(
    target: WikiGraphLibraryTarget,
    query: string,
    options: WikiGraphLibrarySearchOptions = {},
  ): Promise<ArchiveFindResult> {
    return await this.#runtime.run(async () => {
      const embeddingProvider = await resolveQueryEmbeddingProvider(
        options.queryMode,
      );
      return await findWikiGraphLibraryObjects(
        requireLibraryTarget(target),
        query,
        {
          ...options,
          ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
        },
      );
    });
  }

  public async searchArchiveMembers(
    target: WikiGraphLibraryTarget,
    query: string,
    options: WikiGraphLibrarySearchOptions = {},
  ): Promise<ArchiveFindResult> {
    return await this.#runtime.run(async () => {
      const embeddingProvider = await resolveQueryEmbeddingProvider(
        options.queryMode,
      );
      return await findWikiGraphLibraryArchiveMembers(
        requireLibraryTarget(target),
        query,
        {
          ...options,
          ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
        },
      );
    });
  }

  public async objects(
    target: WikiGraphLibraryTarget,
    options: ArchiveCollectionOptions = {},
  ): Promise<ArchiveCollectionResult> {
    return await this.#runtime.run(
      async () =>
        await listWikiGraphLibraryObjects(
          requireLibraryTarget(target),
          options,
        ),
    );
  }

  public async archiveMembers(
    target: WikiGraphLibraryTarget,
    options: ArchiveCollectionOptions = {},
  ): Promise<ArchiveCollectionResult> {
    return await this.#runtime.run(
      async () =>
        await listWikiGraphLibraryArchiveMembers(
          requireLibraryTarget(target),
          options,
        ),
    );
  }

  public async page(
    target: WikiGraphLibraryTarget,
    objectUri: string,
    options: WikiGraphLibraryPageOptions = {},
  ): Promise<ArchivePage> {
    return await this.#runtime.run(
      async () =>
        await withConfiguredWikimediaResolver(
          objectUri,
          async (wikimediaOptions) =>
            await readWikiGraphLibraryPage(
              requireLibraryTarget(target),
              objectUri,
              { ...options, ...wikimediaOptions },
            ),
        ),
      options.signal,
    );
  }

  public async related(
    target: WikiGraphLibraryTarget,
    objectUri: string,
    options: WikiGraphLibraryRelatedOptions = {},
  ): Promise<ArchiveRelatedResult> {
    return await this.#runtime.run(async () => {
      if (options.query === undefined && options.queryMode !== undefined) {
        throw new Error("`queryMode` requires `query`.");
      }
      const embeddingProvider =
        options.query === undefined
          ? undefined
          : await resolveQueryEmbeddingProvider(options.queryMode);
      return await listRelatedWikiGraphLibraryObjects(
        requireLibraryTarget(target),
        objectUri,
        {
          ...options,
          ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
        },
      );
    });
  }

  public async evidence(
    target: WikiGraphLibraryTarget,
    objectUri: string,
    options: WikiGraphLibraryEvidenceOptions = {},
  ): Promise<ArchiveEvidence> {
    return await this.#runtime.run(async () => {
      if (options.query === undefined && options.queryMode !== undefined) {
        throw new Error("`queryMode` requires `query`.");
      }
      const embeddingProvider =
        options.query === undefined
          ? undefined
          : await resolveQueryEmbeddingProvider(options.queryMode);
      return await listWikiGraphLibraryEvidence(
        requireLibraryTarget(target),
        objectUri,
        {
          ...options,
          ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
        },
      );
    });
  }

  public async pack(
    target: WikiGraphLibraryTarget,
    objectUri: string,
    budget = 5_000,
  ): Promise<ArchivePack> {
    return await this.#runtime.run(
      async () =>
        await packWikiGraphLibraryContext(
          requireLibraryTarget(target),
          objectUri,
          budget,
        ),
    );
  }

  public async list(): Promise<readonly WikiGraphLibrary[]> {
    const records = await this.#runtime.run(
      async () => await listWikiGraphLibraries(),
    );
    return records.map((record) => new WikiGraphLibrary(this.#runtime, record));
  }
}

export class WikiGraphLibrary {
  readonly #runtime: WikiGraphJobRuntime;
  readonly #record: WikiGraphLibraryRecord;

  public constructor(
    runtime: WikiGraphJobRuntime,
    record: WikiGraphLibraryRecord,
  ) {
    this.#runtime = runtime;
    this.#record = record;
  }

  public get snapshot(): WikiGraphLibrarySnapshot {
    return toLibrarySnapshot(this.#record);
  }

  public get uri(): string {
    return formatWikiGraphLibraryUri(
      this.#record.isDefault ? undefined : this.#record.publicId,
    );
  }

  public async archives(): Promise<readonly WikiGraphLibraryArchiveSnapshot[]> {
    const target = requireLibraryTarget(this.uri);
    return (
      await this.#runtime.run(
        async () => await listWikiGraphLibraryArchives(target),
      )
    ).map(toArchiveSnapshot);
  }

  public async scan(): Promise<WikiGraphLibraryScanSnapshot> {
    const target = requireLibraryTarget(this.uri);
    return toScanSnapshot(
      await this.#runtime.run(async () => await scanWikiGraphLibrary(target)),
    );
  }

  public async remove(): Promise<WikiGraphLibrarySnapshot> {
    const target = requireLibraryTarget(this.uri);
    return toLibrarySnapshot(
      await this.#runtime.run(async () => await removeWikiGraphLibrary(target)),
    );
  }
}

function toLibrarySnapshot(
  record: WikiGraphLibraryRecord,
): WikiGraphLibrarySnapshot {
  const compatible = record as WikiGraphLibraryRecord & {
    readonly folderPath?: string;
  };
  return {
    id: record.id,
    publicId: record.publicId,
    uri: record.uri,
    folderPath:
      compatible.folderPath ??
      (record.folder === undefined ? "" : getNodeResourcePath(record.folder)),
    isDefault: record.isDefault,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toArchiveSnapshot(
  record: WikiGraphLibraryArchiveRecord,
): WikiGraphLibraryArchiveSnapshot {
  const { file: _file, ...snapshot } = record;
  return snapshot;
}

function toScanSnapshot(
  result: WikiGraphLibraryScanResult,
): WikiGraphLibraryScanSnapshot {
  return {
    ...(result.library === undefined
      ? {}
      : { library: toLibrarySnapshot(result.library) }),
    archives: result.archives.map(toArchiveSnapshot),
  };
}

function requireLibraryTarget(
  value: WikiGraphLibraryTarget,
): ParsedWikiGraphLibraryUri {
  if (typeof value !== "string") return value;
  const target = parseWikiGraphLibraryUri(value);
  if (target === undefined) {
    throw new TypeError(`Invalid Wiki Graph library URI: ${value}`);
  }
  return target;
}

function requireLibraryArchiveTarget(
  value: WikiGraphLibraryTarget,
): ParsedWikiGraphLibraryUri & { readonly kind: "archive" } {
  const target = requireLibraryTarget(value);
  if (
    target.kind !== "archive" ||
    target.archivePublicId === undefined ||
    target.objectUri !== undefined
  ) {
    throw new TypeError("Expected a Wiki Graph library archive URI.");
  }
  return target as ParsedWikiGraphLibraryUri & { readonly kind: "archive" };
}

function requireReadableLibraryArchiveFile(
  archive: WikiGraphLibraryArchiveRecord,
): NonNullable<WikiGraphLibraryArchiveRecord["file"]> {
  if (!archive.exists || archive.status === "missing") {
    throw new Error(`Wiki Graph library archive is missing: ${archive.uri}`);
  }
  if (archive.status === "conflict") {
    throw new Error(
      `Wiki Graph library archive has a conflict and cannot be read: ${archive.uri}`,
    );
  }
  if (archive.file === undefined) {
    throw new Error(
      `Wiki Graph library archive is unavailable: ${archive.uri}`,
    );
  }
  return archive.file;
}

const ARCHIVE_STREAM_CHUNK_SIZE = 64 * 1024;

function createCallbackScopedArchiveStream(
  reader: FileReader,
  isActive: () => boolean,
  signal: AbortSignal | undefined,
): AsyncIterable<Uint8Array> {
  let consumed = false;

  return {
    [Symbol.asyncIterator]() {
      assertArchiveReadSessionActive(isActive, signal);
      if (consumed) {
        throw new Error(
          "The library archive stream has already been consumed.",
        );
      }
      consumed = true;
      let offset = 0;
      let finished = false;

      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          if (finished) return { done: true, value: undefined };
          assertArchiveReadSessionActive(isActive, signal);
          if (offset >= reader.size) {
            finished = true;
            return { done: true, value: undefined };
          }

          const length = Math.min(
            ARCHIVE_STREAM_CHUNK_SIZE,
            reader.size - offset,
          );
          const chunk = await reader.read(offset, length);
          assertArchiveReadSessionActive(isActive, signal);
          offset += chunk.byteLength;
          return { done: false, value: chunk };
        },
        return(): Promise<IteratorResult<Uint8Array>> {
          finished = true;
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

function assertArchiveReadSessionActive(
  isActive: () => boolean,
  signal: AbortSignal | undefined,
): void {
  if (!isActive()) {
    throw new Error(
      "The library archive stream cannot be read after its callback has finished.",
    );
  }
  throwIfAborted(signal);
}

async function runAbortableCallback<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return await operation();
  throwIfAborted(signal);

  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => rejectAbort(abortReason(signal));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException("The operation was aborted.", "AbortError")
  );
}

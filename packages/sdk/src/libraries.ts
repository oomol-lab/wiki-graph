import {
  addWikiGraphLibraryArchive,
  assertWikiGraphLibrarySchemaCurrent,
  cleanWikiGraphLibraryIndex,
  clearWikiGraphLibraryMetadata,
  createWikiGraphLibrary,
  deleteWikiGraphLibraryMetadataKey,
  findWikiGraphLibraryObjects,
  formatWikiGraphLibraryUri,
  getWikiGraphLibraryArchive,
  getWikiGraphLibraryMetadata,
  listRelatedWikiGraphLibraryObjects,
  listWikiGraphLibraries,
  listWikiGraphLibraryArchives,
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
  replaceWikiGraphLibraryMetadata,
  resolveWikiGraphLibrary,
  scanWikiGraphLibrary,
  type ArchiveCollectionOptions,
  type ArchiveCollectionResult,
  type ArchiveEvidence,
  type ArchiveFindOptions,
  type ArchiveFindResult,
  type ArchivePack,
  type ArchivePage,
  type ArchiveRelatedResult,
  type ParsedWikiGraphLibraryUri,
  type WikiGraphLibraryArchiveRecord,
  type WikiGraphLibraryIndexState,
  type WikiGraphLibraryRecord,
  type WikiGraphLibraryScanResult,
} from "wiki-graph-core";
import { mkdir } from "fs/promises";

import type { WikiGraphJobRuntime } from "./jobs.js";
import { NodeDirectory, NodeFile } from "./node-platform.js";

export type WikiGraphLibraryTarget = ParsedWikiGraphLibraryUri | string;

export interface WikiGraphLibraryAddArchiveOptions {
  readonly inputPath: string;
  readonly target: WikiGraphLibraryTarget;
  readonly to?: string;
}

export interface WikiGraphLibraryMoveArchiveOptions {
  readonly target: WikiGraphLibraryTarget;
  readonly to: string;
}

export class WikiGraphLibraryManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async create(folder: string): Promise<WikiGraphLibrary> {
    await mkdir(folder);
    const record = await this.#runtime.run(
      async () =>
        await createWikiGraphLibrary({ folder: new NodeDirectory(folder) }),
    );
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
  ): Promise<WikiGraphLibraryArchiveRecord> {
    return await this.#runtime.run(
      async () =>
        await addWikiGraphLibraryArchive({
          inputFile: new NodeFile(options.inputPath),
          target: requireLibraryTarget(options.target),
          ...(options.to === undefined ? {} : { to: options.to }),
        }),
    );
  }

  public async assertCurrent(target: WikiGraphLibraryTarget): Promise<void> {
    await this.#runtime.run(
      async () =>
        await assertWikiGraphLibrarySchemaCurrent(
          requireLibraryTarget(target),
        ),
    );
  }

  public async rebind(
    target: WikiGraphLibraryTarget,
    folder: string,
  ): Promise<WikiGraphLibraryScanResult> {
    return await this.#runtime.run(
      async () =>
        await rebindWikiGraphLibrary({
          folder: new NodeDirectory(folder),
          target: requireLibraryTarget(target),
        }),
    );
  }

  public async remove(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibraryRecord> {
    return await this.#runtime.run(
      async () => await removeWikiGraphLibrary(requireLibraryTarget(target)),
    );
  }

  public async scan(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibraryScanResult> {
    return await this.#runtime.run(
      async () => await scanWikiGraphLibrary(requireLibraryTarget(target)),
    );
  }

  public async getArchive(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibraryArchiveRecord> {
    return await this.#runtime.run(
      async () =>
        await getWikiGraphLibraryArchive(requireLibraryTarget(target)),
    );
  }

  public async moveArchive(
    options: WikiGraphLibraryMoveArchiveOptions,
  ): Promise<WikiGraphLibraryArchiveRecord> {
    return await this.#runtime.run(
      async () =>
        await moveWikiGraphLibraryArchive({
          target: requireLibraryTarget(options.target),
          to: options.to,
        }),
    );
  }

  public async removeArchive(
    target: WikiGraphLibraryTarget,
  ): Promise<WikiGraphLibraryArchiveRecord> {
    return await this.#runtime.run(
      async () =>
        await removeWikiGraphLibraryArchive({
          target: requireLibraryTarget(target),
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
    options: ArchiveFindOptions = {},
  ): Promise<ArchiveFindResult> {
    return await this.#runtime.run(
      async () =>
        await findWikiGraphLibraryObjects(
          requireLibraryTarget(target),
          query,
          options,
        ),
    );
  }

  public async objects(
    target: WikiGraphLibraryTarget,
    options: ArchiveCollectionOptions = {},
  ): Promise<ArchiveCollectionResult> {
    return await this.#runtime.run(
      async () =>
        await listWikiGraphLibraryObjects(requireLibraryTarget(target), options),
    );
  }

  public async page(
    target: WikiGraphLibraryTarget,
    objectUri: string,
    options: Parameters<typeof readWikiGraphLibraryPage>[2] = {},
  ): Promise<ArchivePage> {
    return await this.#runtime.run(
      async () =>
        await readWikiGraphLibraryPage(
          requireLibraryTarget(target),
          objectUri,
          options,
        ),
    );
  }

  public async related(
    target: WikiGraphLibraryTarget,
    objectUri: string,
    options: Parameters<typeof listRelatedWikiGraphLibraryObjects>[2] = {},
  ): Promise<ArchiveRelatedResult> {
    return await this.#runtime.run(
      async () =>
        await listRelatedWikiGraphLibraryObjects(
          requireLibraryTarget(target),
          objectUri,
          options,
        ),
    );
  }

  public async evidence(
    target: WikiGraphLibraryTarget,
    objectUri: string,
    options: Parameters<typeof listWikiGraphLibraryEvidence>[2] = {},
  ): Promise<ArchiveEvidence> {
    return await this.#runtime.run(
      async () =>
        await listWikiGraphLibraryEvidence(
          requireLibraryTarget(target),
          objectUri,
          options,
        ),
    );
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

  public get snapshot(): WikiGraphLibraryRecord {
    return this.#record;
  }

  public get uri(): string {
    return formatWikiGraphLibraryUri(
      this.#record.isDefault ? undefined : this.#record.publicId,
    );
  }

  public async archives(): Promise<readonly WikiGraphLibraryArchiveRecord[]> {
    const target = requireLibraryTarget(this.uri);
    return await this.#runtime.run(
      async () => await listWikiGraphLibraryArchives(target),
    );
  }

  public async scan(): Promise<WikiGraphLibraryScanResult> {
    const target = requireLibraryTarget(this.uri);
    return await this.#runtime.run(
      async () => await scanWikiGraphLibrary(target),
    );
  }

  public async remove(): Promise<WikiGraphLibraryRecord> {
    const target = requireLibraryTarget(this.uri);
    return await this.#runtime.run(
      async () => await removeWikiGraphLibrary(target),
    );
  }
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

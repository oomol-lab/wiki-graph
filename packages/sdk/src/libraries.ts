import {
  createWikiGraphLibrary,
  formatWikiGraphLibraryUri,
  listWikiGraphLibraries,
  listWikiGraphLibraryArchives,
  parseWikiGraphLibraryUri,
  removeWikiGraphLibrary,
  resolveWikiGraphLibrary,
  scanWikiGraphLibrary,
  type ParsedWikiGraphLibraryUri,
  type WikiGraphLibraryArchiveRecord,
  type WikiGraphLibraryRecord,
  type WikiGraphLibraryScanResult,
} from "wiki-graph-core";

import type { WikiGraphJobRuntime } from "./jobs.js";
import { NodeDirectory } from "./node-platform.js";

export class WikiGraphLibraryManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async create(folder: string): Promise<WikiGraphLibrary> {
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

function requireLibraryTarget(uri: string): ParsedWikiGraphLibraryUri {
  const target = parseWikiGraphLibraryUri(uri);
  if (target === undefined) {
    throw new TypeError(`Invalid Wiki Graph library URI: ${uri}`);
  }
  return target;
}

/** A host-owned file whose identity remains opaque to Core. */
export interface File {
  /** Stable opaque identity used only for coordination; it must not be a path. */
  readonly identity: string;
  /** Logical entry name only; never a URI or operating-system path. */
  readonly name: string;
  readonly size?: number;
  readonly lastModified?: number;
  getSize?(): Promise<number>;
  getLastModified?(): Promise<number | undefined>;
  read(options?: { readonly encoding?: string }): Promise<Uint8Array | string>;
  openReader(): Promise<FileReader>;
  openWriter(): Promise<FileWriter>;
}

/** Random-access reader for a host-owned file snapshot. */
export interface FileReader {
  readonly size: number;
  /** Reads exactly `length` bytes; ranges outside `[0, size]` are rejected. */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Releases host resources. Calling close repeatedly is allowed. */
  close(): Promise<void>;
}

/** Transactional writer supplied by the host file system. */
export interface FileWriter {
  /** Appends to the writer's sequential output position. */
  write(data: Uint8Array | string): Promise<void>;
  /**
   * Writes at an absolute byte offset without advancing the sequential
   * position. It replaces overlapping bytes and zero-fills any extended gap.
   */
  writeAt(offset: number, data: Uint8Array): Promise<void>;
  /** Atomically publishes the complete written file; later terminal calls are no-ops. */
  commit(): Promise<void>;
  /** Discards all written data without publishing it; later terminal calls are no-ops. */
  abort(): Promise<void>;
}

/** Directory tree supplied by the host. Only relative child names are used. */
export interface Directory {
  /** Stable opaque identity used only for coordination; it must not be a path. */
  readonly identity: string;
  readonly name: string;
  readonly lastModified?: number;
  getLastModified?(): Promise<number | undefined>;
  getFile(name: string): Promise<File | undefined>;
  getDirectory(name: string): Promise<Directory | undefined>;
  list(): Promise<ReadonlyArray<File | Directory>>;
  createFile(name: string): Promise<File>;
  createDirectory(name: string): Promise<Directory>;
  remove(
    name: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void>;
}

/**
 * Resolves stable host-owned identities back to capabilities. Core persists
 * identities, never host locations. This is required by jobs and library
 * membership, whose records can outlive one JavaScript execution context.
 */
export interface HostResourceProvider {
  getDirectory(identity: string): Promise<Directory | undefined>;
  getFile(identity: string): Promise<File | undefined>;
  /** Resolves a pre-v4 persisted directory reference during home migration. */
  resolveLegacyDirectory?(reference: string): Promise<Directory | undefined>;
}

/** Host storage roots. Their backing locations are never visible to Core. */
export interface WikiGraphStorage {
  readonly library: Directory;
  readonly documentStore: Directory;
}

export interface HostAsyncContext<T> {
  run<R>(store: T, callback: () => R): R;
  enterWith(store: T): void;
  getStore(): T | undefined;
}

export interface HostAsyncContextProvider {
  create<T>(): HostAsyncContext<T>;
}

export type HostDatabaseValue = Uint8Array | number | string | null;
export type HostDatabaseRow = Readonly<Record<string, HostDatabaseValue>>;

export interface HostDatabaseConnection {
  close(): Promise<void>;
  execute(sql: string): Promise<void>;
  queryAll(
    sql: string,
    params?: readonly HostDatabaseValue[],
  ): Promise<readonly HostDatabaseRow[]>;
  queryOne(
    sql: string,
    params?: readonly HostDatabaseValue[],
  ): Promise<HostDatabaseRow | undefined>;
  run(sql: string, params?: readonly HostDatabaseValue[]): Promise<void>;
}

export interface HostDatabaseProvider {
  open(
    file: File,
    options?: { readonly readonly?: boolean },
  ): Promise<HostDatabaseConnection>;
}

export interface HostZipEntry {
  readonly data: Uint8Array;
  readonly name: string;
}

/** Lazily reads entries from one host-owned ZIP archive. */
export interface HostZipReader {
  close(): Promise<void>;
  listEntries(): Promise<readonly string[]>;
  readEntry(name: string): Promise<Uint8Array | undefined>;
}

export interface HostZipProvider {
  open(file: File): Promise<HostZipReader>;
  write(
    file: File,
    entries: Iterable<HostZipEntry> | AsyncIterable<HostZipEntry>,
  ): Promise<void>;
}

/** Identifies one host execution and probes executions that may have died. */
export interface HostLifecycleProvider {
  readonly instanceId: string;
  isInstanceAlive(instanceId: string): Promise<boolean | undefined>;
}

export interface HostTemplateProvider {
  createEnvironment(options: {
    readonly autoescape: boolean;
    readonly trimBlocks: boolean;
  }): HostTemplateEnvironment;
}

export interface HostTemplateEnvironment {
  render(
    templateName: string,
    context?: Readonly<Record<string, unknown>>,
  ): string;
}

/** Platform-neutral host services required before Core operations run. */
export interface WikiGraphPlatform {
  readonly asyncContext: HostAsyncContextProvider;
  readonly database: HostDatabaseProvider;
  readonly lifecycle: HostLifecycleProvider;
  readonly resources: HostResourceProvider;
  readonly templates: HostTemplateProvider;
  readonly zip: HostZipProvider;
}

export interface HostError extends Error {
  readonly code?: string;
}

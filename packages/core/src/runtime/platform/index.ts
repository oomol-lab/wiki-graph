import type {
  Directory,
  File,
  ReadonlyFile,
  HostAsyncContext,
  HostZipEntry,
  WikiGraphPlatform,
  WikiGraphStorage,
} from "./types.js";

export type {
  Directory,
  Entry,
  File,
  FileReader,
  FileWriter,
  ReadonlyFile,
  HostAsyncContext,
  HostAsyncContextProvider,
  HostDatabaseConnection,
  HostDatabaseOpenOptions,
  HostDatabaseProvider,
  HostDatabaseRow,
  HostDatabaseValue,
  HostError,
  HostLifecycleProvider,
  HostResourceProvider,
  HostTemplateProvider,
  HostTemplateEnvironment,
  HostZipEntry,
  HostZipRangeEntry,
  HostZipWriteEntry,
  HostZipProvider,
  HostZipReader,
  WikiGraphPlatform,
  WikiGraphStorage,
} from "./types.js";
export {
  appendFileText,
  copyFileContent,
  getHostEntryLastModified,
  isHostFileEmpty,
  isDirectory,
  readFileText,
  readFileBytes,
  readHostEntrySize,
  readHostFileSize,
  writeFileContent,
} from "./files.js";

/** Shared by independently bundled CommonJS package entry points. */
const RUNTIME_STATE_KEY = Symbol.for("wiki-graph-core.runtime.v1");

/** Install the process-default platform services used by Core. */
export function installWikiGraphPlatform(platform: WikiGraphPlatform): void {
  getRuntimeState().installedPlatform = platform;
}

export function getWikiGraphPlatform(): WikiGraphPlatform {
  const { installedPlatform } = getRuntimeState();
  if (installedPlatform === undefined) {
    throw new Error(
      "No WikiGraph runtime platform has been installed. Provide a runtime adapter before using wiki-graph-core.",
    );
  }

  return installedPlatform;
}

/** Materialize a ZIP only for workflows that inherently consume every entry. */
export async function readHostZipEntries(
  file: ReadonlyFile,
): Promise<HostZipEntry[]> {
  const reader = await getWikiGraphPlatform().zip.open(file);
  try {
    const entries: HostZipEntry[] = [];
    for (const name of await reader.listEntries()) {
      const data = await reader.readEntry(name);
      if (data !== undefined) entries.push({ data, name });
    }
    return entries;
  } finally {
    await reader.close();
  }
}

/** Resolve an opaque persisted identity into its host file capability. */
export async function resolveHostFile(file: File | string): Promise<File> {
  if (typeof file !== "string") return file;
  const resolved = await getWikiGraphPlatform().resources.getFile(file);
  if (resolved === undefined) throw new Error("Host file is unavailable");
  return resolved;
}

/** Resolve an opaque read capability without requiring a writable host file. */
export async function resolveHostReadonlyFile(
  file: ReadonlyFile | string,
): Promise<ReadonlyFile> {
  if (typeof file !== "string") return file;
  const resolved = await getWikiGraphPlatform().resources.getFile(file);
  if (resolved === undefined) throw new Error("Host file is unavailable");
  return resolved;
}

/** Resolve an opaque persisted identity into its host directory capability. */
export async function resolveHostDirectory(
  directory: Directory | string,
): Promise<Directory> {
  if (typeof directory !== "string") return directory;
  const resolved =
    await getWikiGraphPlatform().resources.getDirectory(directory);
  if (resolved === undefined) {
    throw new Error("Host directory is unavailable");
  }
  return resolved;
}

/** Resolve a logical relative file name inside a host-provided directory. */
export async function getRelativeFile(
  root: Directory,
  relativeName: string,
): Promise<File | undefined> {
  const parts = relativeName.replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new TypeError(`Directory path must remain relative: ${relativeName}`);
  }
  const fileName = parts.pop();
  if (!fileName) return undefined;
  let directory = root;
  for (const part of parts) {
    const next = await directory.getDirectory(part);
    if (!next) return undefined;
    directory = next;
  }
  return await directory.getFile(fileName);
}

/** Resolve a logical relative directory without permitting root escape. */
export async function getRelativeDirectory(
  root: Directory,
  relativeName: string,
): Promise<Directory | undefined> {
  const parts = splitRelativeName(relativeName);
  let directory = root;
  for (const part of parts) {
    const next = await directory.getDirectory(part);
    if (!next) return undefined;
    directory = next;
  }
  return directory;
}

/** Create missing logical directories below a host-owned root. */
export async function ensureRelativeDirectory(
  root: Directory,
  relativeName: string,
): Promise<Directory> {
  const parts = splitRelativeName(relativeName);
  let directory = root;
  for (const part of parts) {
    const existing = await directory.getDirectory(part);
    if (existing !== undefined) {
      directory = existing;
      continue;
    }
    try {
      directory = await directory.createDirectory(part);
    } catch (error) {
      const raced = await directory.getDirectory(part);
      if (raced === undefined) throw error;
      directory = raced;
    }
  }
  return directory;
}

/** Get or create a logical file below a host-owned root. */
export async function ensureRelativeFile(
  root: Directory,
  relativeName: string,
): Promise<File> {
  const parts = splitRelativeName(relativeName);
  const fileName = parts.pop();
  if (!fileName) throw new TypeError("File name must remain relative");
  const parent = await ensureRelativeDirectory(root, parts.join("/"));
  const existing = await parent.getFile(fileName);
  if (existing !== undefined) return existing;
  try {
    return await parent.createFile(fileName);
  } catch (error) {
    const raced = await parent.getFile(fileName);
    if (raced !== undefined) return raced;
    throw error;
  }
}

function splitRelativeName(relativeName: string): string[] {
  const normalized = relativeName.replaceAll("\\", "/");
  if (normalized.startsWith("/")) {
    throw new TypeError(`Directory path must remain relative: ${relativeName}`);
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new TypeError(`Directory path must remain relative: ${relativeName}`);
  }
  return parts;
}

class DeferredHostAsyncContext<T> {
  #impl: HostAsyncContext<T> | undefined;
  #fallbackStore: T | undefined;

  public run<R>(store: T, callback: () => R): R {
    const implementation = this.#implementation();
    if (implementation !== undefined) {
      return implementation.run(store, callback);
    }

    const previous = this.#fallbackStore;
    this.#fallbackStore = store;
    try {
      return callback();
    } finally {
      this.#fallbackStore = previous;
    }
  }

  public enterWith(store: T): void {
    const implementation = this.#implementation();
    if (implementation !== undefined) {
      implementation.enterWith(store);
    } else {
      this.#fallbackStore = store;
    }
  }

  public getStore(): T | undefined {
    return this.#implementation()?.getStore() ?? this.#fallbackStore;
  }

  #implementation(): HostAsyncContext<T> | undefined {
    if (this.#impl !== undefined) {
      return this.#impl;
    }
    const { installedPlatform } = getRuntimeState();
    if (installedPlatform === undefined) {
      return undefined;
    }

    this.#impl = installedPlatform.asyncContext.create<T>();
    if (this.#fallbackStore !== undefined) {
      this.#impl.enterWith(this.#fallbackStore);
      this.#fallbackStore = undefined;
    }
    return this.#impl;
  }
}

interface WikiGraphRuntimeState {
  installedPlatform?: WikiGraphPlatform;
  installedStorage?: WikiGraphStorage;
  readonly storageContext: DeferredHostAsyncContext<WikiGraphStorage>;
}

function getRuntimeState(): WikiGraphRuntimeState {
  const runtimeGlobal = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = runtimeGlobal[RUNTIME_STATE_KEY];
  if (existing !== undefined) return existing as WikiGraphRuntimeState;

  const state: WikiGraphRuntimeState = {
    storageContext: new DeferredHostAsyncContext<WikiGraphStorage>(),
  };
  Object.defineProperty(runtimeGlobal, RUNTIME_STATE_KEY, {
    configurable: false,
    enumerable: false,
    value: state,
    writable: false,
  });
  return state;
}

/** Install process-default storage, primarily for CLI bootstrap. */
export function installWikiGraphStorage(storage: WikiGraphStorage): void {
  getRuntimeState().installedStorage = storage;
}

export async function withWikiGraphStorage<T>(
  storage: WikiGraphStorage | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  if (storage === undefined) {
    return await operation();
  }
  return await getRuntimeState().storageContext.run(storage, operation);
}

export function getWikiGraphStorage(): WikiGraphStorage {
  const { installedStorage, storageContext } = getRuntimeState();
  const storage = storageContext.getStore() ?? installedStorage;
  if (storage === undefined) {
    throw new Error(
      "No WikiGraph storage roots have been configured. Pass storage to WikiGraph or install process-default storage.",
    );
  }
  return storage;
}

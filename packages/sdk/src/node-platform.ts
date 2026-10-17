/* eslint-disable no-restricted-syntax, @typescript-eslint/parameter-properties */
import * as asyncHooks from "node:async_hooks";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as pathModule from "node:path";
import * as process from "node:process";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as sqlite3 from "sqlite3";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { Environment, Loader, type LoaderSource } from "nunjucks";

const nodeProcess =
  (process as unknown as { default?: typeof process }).default ?? process;
const nodeSqlite3 =
  (sqlite3 as unknown as { default?: typeof sqlite3 }).default ?? sqlite3;

import {
  getWikiGraphPlatform,
  getWikiGraphStorage,
  installWikiGraphPlatform,
  installWikiGraphStorage,
  withWikiGraphStorage,
  type Directory,
  type File,
  type FileReader,
  type ReadonlyFile,
  type FileWriter,
  type HostDatabaseConnection,
  type HostDatabaseOpenOptions,
  type HostDatabaseRow,
  type HostDatabaseValue,
  type HostLifecycleProvider,
  type HostZipWriteEntry,
  type HostZipReader,
  type WikiGraphPlatform,
  type WikiGraphStorage,
  normalizeTemplateName,
} from "wiki-graph-core/platform";

/** Stable across independently bundled SDK entry points. */
const NODE_RESOURCE_KIND = Symbol.for("wiki-graph-sdk.node-resource.v1");

/** Install the Node implementation used by the CLI and its workers. */
export class NodeFile implements File {
  public async getPhysicalIdentity(): Promise<string | undefined> {
    const value = await fsPromises
      .stat(toNodeFilesystemPath(this.path))
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return undefined;
        throw error;
      });
    if (value === undefined) return undefined;
    return `${value.dev}:${value.ino}`;
  }
  public readonly kind = "file" as const;
  public readonly [NODE_RESOURCE_KIND] = "file" as const;
  public readonly identity: string;
  public readonly name: string;

  public constructor(
    public readonly path: string,
    name = pathModule.basename(path),
  ) {
    this.identity = encodeNodeResourceIdentity("file", path);
    this.name = name;
  }

  public async openReader(): Promise<FileReader> {
    const handle = await fsPromises.open(toNodeFilesystemPath(this.path), "r");
    let closed = false;
    try {
      const stats = await handle.stat();
      if (!stats.isFile())
        throw new Error("File reader requires a regular file");
      const { size } = stats;
      return {
        size,
        close: async () => {
          if (!closed) await handle.close();
          closed = true;
        },
        read: async (offset, length) => {
          if (closed) throw new Error("Cannot read from a closed FileReader");
          assertFileRange(offset, length, size);
          const buffer = Buffer.allocUnsafe(length);
          let bytesRead = 0;
          while (bytesRead < length) {
            const result = await handle.read(
              buffer,
              bytesRead,
              length - bytesRead,
              offset + bytesRead,
            );
            if (result.bytesRead === 0) {
              throw new Error("File changed while reading its byte range");
            }
            bytesRead += result.bytesRead;
          }
          return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
        },
      };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  public async getLastModified(): Promise<number | undefined> {
    try {
      return (await fsPromises.stat(toNodeFilesystemPath(this.path))).mtimeMs;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  public async openWriter(): Promise<FileWriter> {
    await fsPromises.mkdir(
      toNodeFilesystemPath(pathModule.dirname(this.path)),
      {
        recursive: true,
      },
    );
    const temporary = `${this.path}.tmp-${crypto.randomUUID()}`;
    const handle = await fsPromises.open(toNodeFilesystemPath(temporary), "wx");
    let closed = false;
    return {
      write: async (data) => {
        if (closed) throw new Error("Cannot write to a closed FileWriter");
        await writeNodeFileHandle(handle, data);
      },
      writeAt: async (offset, data) => {
        if (closed) throw new Error("Cannot write to a closed FileWriter");
        assertFileOffset(offset);
        await writeNodeFileHandle(handle, data, offset);
      },
      commit: async () => {
        if (!closed) {
          await handle.close();
          await fsPromises.rename(
            toNodeFilesystemPath(temporary),
            toNodeFilesystemPath(this.path),
          );
        }
        closed = true;
      },
      abort: async () => {
        if (!closed) {
          await handle.close();
          await fsPromises.rm(toNodeFilesystemPath(temporary), { force: true });
        }
        closed = true;
      },
    };
  }
}

/** @internal Completes writes even when the Node file handle reports a short write. */
export async function writeNodeFileHandle(
  handle: Pick<fsPromises.FileHandle, "write">,
  data: Uint8Array | string,
  position?: number,
): Promise<void> {
  const buffer = Buffer.from(data);
  let written = 0;
  while (written < buffer.byteLength) {
    const result = await handle.write(
      buffer,
      written,
      buffer.byteLength - written,
      position === undefined ? null : position + written,
    );
    if (result.bytesWritten === 0) {
      throw new Error("File writer made no progress");
    }
    written += result.bytesWritten;
  }
}

function assertFileRange(offset: number, length: number, size: number): void {
  assertFileOffset(offset);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(
      "File read length must be a non-negative safe integer",
    );
  }
  if (offset > size || length > size - offset) {
    throw new RangeError("File read range exceeds the file size");
  }
}

function assertFileOffset(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("File offset must be a non-negative safe integer");
  }
}

export class NodeDirectory implements Directory {
  public async getPhysicalIdentity(): Promise<string | undefined> {
    const value = await fsPromises
      .stat(toNodeFilesystemPath(this.path))
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return undefined;
        throw error;
      });
    if (value === undefined) return undefined;
    return `${value.dev}:${value.ino}`;
  }
  public readonly kind = "directory" as const;
  public readonly [NODE_RESOURCE_KIND] = "directory" as const;
  public readonly identity: string;
  public readonly name: string;

  public constructor(public readonly path: string) {
    this.identity = encodeNodeResourceIdentity("directory", path);
    this.name = pathModule.basename(path);
  }

  public async getFile(name: string): Promise<File | undefined> {
    assertChildName(name);
    const file = new NodeFile(pathModule.join(this.path, name));
    try {
      return (await fsPromises.stat(toNodeFilesystemPath(file.path))).isFile()
        ? file
        : undefined;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
        return undefined;
      throw error;
    }
  }

  public async getLastModified(): Promise<number | undefined> {
    try {
      return (await fsPromises.stat(toNodeFilesystemPath(this.path))).mtimeMs;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  public async getDirectory(name: string): Promise<Directory | undefined> {
    assertChildName(name);
    const directory = new NodeDirectory(pathModule.join(this.path, name));
    try {
      return (
        await fsPromises.stat(toNodeFilesystemPath(directory.path))
      ).isDirectory()
        ? directory
        : undefined;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
        return undefined;
      throw error;
    }
  }

  public async list(): Promise<ReadonlyArray<File | Directory>> {
    const entries = await fsPromises.readdir(toNodeFilesystemPath(this.path), {
      withFileTypes: true,
    });
    return entries.map((entry) =>
      entry.isDirectory()
        ? new NodeDirectory(pathModule.join(this.path, entry.name))
        : new NodeFile(pathModule.join(this.path, entry.name), entry.name),
    );
  }

  public async createFile(name: string): Promise<File> {
    assertChildName(name);
    await fsPromises.mkdir(toNodeFilesystemPath(this.path), {
      recursive: true,
    });
    const file = new NodeFile(pathModule.join(this.path, name));
    await fsPromises.writeFile(toNodeFilesystemPath(file.path), "", {
      flag: "wx",
    });
    return file;
  }

  public async createDirectory(name: string): Promise<Directory> {
    assertChildName(name);
    await fsPromises.mkdir(toNodeFilesystemPath(this.path), {
      recursive: true,
    });
    const directory = new NodeDirectory(pathModule.join(this.path, name));
    await fsPromises.mkdir(toNodeFilesystemPath(directory.path));
    return directory;
  }

  public async remove(
    name: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void> {
    assertChildName(name);
    await fsPromises.rm(
      toNodeFilesystemPath(pathModule.join(this.path, name)),
      {
        force: true,
        recursive: options?.recursive === true,
      },
    );
  }
}

function toNodeFilesystemPath(path: string): string {
  if (nodeProcess.platform !== "win32" || path.startsWith("\\\\?\\")) {
    return path;
  }
  const absolute = pathModule.resolve(path);
  if (absolute.startsWith("\\\\")) {
    return `\\\\?\\UNC\\${absolute.slice(2)}`;
  }
  return `\\\\?\\${absolute}`;
}

function encodeNodeResourceIdentity(
  kind: "directory" | "file",
  path: string,
): string {
  return `node-${kind}:${Buffer.from(pathModule.resolve(path), "utf8").toString("base64url")}`;
}

function decodeNodeResourceIdentity(
  identity: string,
  kind: "directory" | "file",
): string | undefined {
  const prefix = `node-${kind}:`;
  if (!identity.startsWith(prefix)) {
    // State created before opaque resource identities stored native paths.
    return pathModule.isAbsolute(identity) ? identity : undefined;
  }
  try {
    return Buffer.from(identity.slice(prefix.length), "base64url").toString(
      "utf8",
    );
  } catch {
    return undefined;
  }
}

export function getNodeResourcePath(resource: File | Directory): string {
  const brandedPath = getBrandedNodeResourcePath(resource, resource.kind);
  if (brandedPath !== undefined) return brandedPath;
  if (
    typeof resource === "object" &&
    resource !== null &&
    "path" in resource &&
    typeof resource.path === "string"
  ) {
    return resource.path;
  }
  throw new TypeError("Expected a Node File or Directory resource");
}

function assertChildName(name: string): void {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    pathModule.isAbsolute(name) ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new TypeError(`Directory child must be a relative name: ${name}`);
  }
}

class NodeDatabaseConnection implements HostDatabaseConnection {
  public constructor(private readonly database: sqlite3.Database) {}

  public async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.database.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  public async execute(sql: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.database.exec(sql, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  public async queryAll(
    sql: string,
    params: readonly HostDatabaseValue[] = [],
  ): Promise<readonly HostDatabaseRow[]> {
    return await new Promise((resolve, reject) => {
      this.database.all(sql, [...params], (error, rows: HostDatabaseRow[]) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });
  }

  public async queryOne(
    sql: string,
    params: readonly HostDatabaseValue[] = [],
  ): Promise<HostDatabaseRow | undefined> {
    return await new Promise((resolve, reject) => {
      this.database.get(sql, [...params], (error, row: HostDatabaseRow) => {
        if (error) reject(error);
        else resolve(row);
      });
    });
  }

  public async run(
    sql: string,
    params: readonly HostDatabaseValue[] = [],
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.database.run(sql, [...params], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function openNodeDatabase(
  file: ReadonlyFile,
  options: HostDatabaseOpenOptions,
): Promise<NodeDatabaseConnection> {
  const flags =
    (options.mode === "readonly"
      ? nodeSqlite3.OPEN_READONLY
      : nodeSqlite3.OPEN_READWRITE |
        (options.create ? nodeSqlite3.OPEN_CREATE : 0)) |
    nodeSqlite3.OPEN_FULLMUTEX;
  return new NodeDatabaseConnection(await openNativeNodeDatabase(file, flags));
}

async function openNativeNodeDatabase(
  file: ReadonlyFile,
  flags: number,
): Promise<sqlite3.Database> {
  const path = getBrandedNodeResourcePath(file, "file");
  if (path === undefined) {
    throw new TypeError("The Node database adapter requires a NodeFile");
  }
  return await new Promise((resolve, reject) => {
    const database = new nodeSqlite3.Database(
      toNodeFilesystemPath(path),
      flags,
      (error) => {
        if (error) reject(error);
        else resolve(database);
      },
    );
  });
}

async function openNodeZip(
  file: ReadonlyFile,
  options: { readonly entryNameMode?: "raw" | "normalized" } = {},
): Promise<HostZipReader> {
  const path = getBrandedNodeResourcePath(file, "file");
  if (path === undefined) {
    throw new TypeError("The Node ZIP adapter requires a NodeFile");
  }
  const handle = await fsPromises.open(toNodeFilesystemPath(path), "r");
  let size: number;
  try {
    size = (await handle.stat()).size;
  } catch (error) {
    await handle.close();
    throw error;
  }
  const open = () =>
    new Promise<yauzl.ZipFile>((resolve, reject) => {
      yauzl.fromRandomAccessReader(
        new NodeZipSource(handle),
        size,
        { autoClose: false, lazyEntries: true },
        (error, opened) => {
          if (error || opened === undefined)
            reject(error ?? new Error("Cannot open ZIP"));
          else resolve(opened);
        },
      );
    });
  // Validate the ZIP envelope without enumerating its entries. Keep the same
  // file descriptor across lookups, even if the path is replaced meanwhile.
  try {
    (await open()).close();
  } catch (error) {
    await handle.close();
    throw error;
  }
  let closed = false;
  let pending: Promise<unknown> = Promise.resolve();
  let closing: Promise<void> | undefined;
  const run = <T>(
    operation: (zip: yauzl.ZipFile) => Promise<T>,
  ): Promise<T> => {
    if (closed)
      return Promise.reject(new Error("Cannot read a closed ZIP archive"));
    const result = pending.then(async () => {
      const zip = await open();
      try {
        return await operation(zip);
      } finally {
        zip.close();
      }
    });
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const withEntry = <T>(
    name: string,
    operation: (
      zip: yauzl.ZipFile,
      entry: yauzl.Entry | undefined,
    ) => Promise<T>,
  ) =>
    run(async (zip) => {
      let exact: yauzl.Entry | undefined;
      let alias: yauzl.Entry | undefined;
      let aliasCollision = false;
      // Retain only matches, not a directory index. Scan through the end so
      // duplicate raw names keep their existing last-entry-wins behavior.
      await scanNodeZip(zip, (entry) => {
        if (entry.fileName === name) exact = entry;
        if (normalizeNodeZipName(entry.fileName) === name) {
          if (alias !== undefined && alias.fileName !== entry.fileName)
            aliasCollision = true;
          alias = entry;
        }
      });
      if (
        (exact === undefined || options.entryNameMode === "normalized") &&
        aliasCollision
      ) {
        // The former Map ordered aliases by the first occurrence of each raw
        // name, but used its last duplicate's contents. Resolve this uncommon
        // ambiguity with rescans instead of retaining a set of all raw names.
        let bestPosition = -1;
        const candidates = await open();
        try {
          await scanNodeZip(candidates, async (entry) => {
            if (normalizeNodeZipName(entry.fileName) !== name) return;
            const probe = await open();
            let position = 0;
            try {
              await scanNodeZip(probe, (candidate) => {
                if (candidate.fileName === entry.fileName) return false;
                position++;
              });
            } finally {
              probe.close();
            }
            if (position >= bestPosition) {
              bestPosition = position;
              alias = entry;
            }
          });
          return await operation(candidates, alias);
        } finally {
          candidates.close();
        }
      }
      return await operation(
        zip,
        options.entryNameMode === "normalized" ? alias : (exact ?? alias),
      );
    });
  return {
    close: () => {
      closed = true;
      closing ??= pending.then(() => handle.close());
      return closing;
    },
    copyEntry: (name, target) =>
      withEntry(name, async (zip, entry) => {
        if (entry === undefined) return false;
        await copyNodeZipEntry(zip, entry, target);
        return true;
      }),
    getEntrySize: (name) =>
      withEntry(name, (_zip, entry) =>
        Promise.resolve(entry?.uncompressedSize),
      ),
    listEntries: () =>
      run(async (zip) => {
        const names = new Set<string>();
        await scanNodeZip(zip, (entry) => {
          names.add(entry.fileName);
        });
        return [...names];
      }),
    readEntryRange: (name, offset, length) =>
      withEntry(name, async (zip, entry) => {
        if (entry === undefined) return undefined;
        return await readNodeZipEntryRange(zip, entry, offset, length);
      }),
    readEntry: (name) =>
      withEntry(name, async (zip, entry) => {
        if (entry === undefined) return undefined;
        return await readNodeZipEntry(zip, entry);
      }),
  };
}

/** yauzl owns ZIP parsing; this source only provides positioned file reads. */
class NodeZipSource extends yauzl.RandomAccessReader {
  public constructor(private readonly handle: fsPromises.FileHandle) {
    super();
  }
  public override read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error: Error | null) => void,
  ): void {
    // Central-directory reads are small. Avoid creating a stream pipeline for
    // each header; yauzl still owns parsing and requests the exact byte range.
    const read = (written: number): void => {
      if (written === length) {
        callback(null);
        return;
      }
      fs.read(
        this.handle.fd,
        buffer,
        offset + written,
        length - written,
        position + written,
        (error, bytesRead) => {
          if (error) callback(error);
          else if (bytesRead === 0)
            callback(new Error("Unexpected end of ZIP file"));
          else read(written + bytesRead);
        },
      );
    };
    read(0);
  }
  public override _readStreamForRange(start: number, end: number): Readable {
    const handle = this.handle;
    return Readable.from(
      (async function* () {
        for (let position = start; position < end; ) {
          const buffer = Buffer.allocUnsafe(
            Math.min(64 * 1024, end - position),
          );
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            position,
          );
          if (bytesRead === 0) return;
          position += bytesRead;
          yield buffer.subarray(0, bytesRead);
        }
      })(),
    );
  }
}

function normalizeNodeZipName(name: string): string | undefined {
  const normalized = name
    .replaceAll("\\", "/")
    .trim()
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
  return normalized.split("/").includes("..") ? undefined : normalized;
}

async function scanNodeZip(
  zip: yauzl.ZipFile,
  visit: (entry: yauzl.Entry) => void | boolean | Promise<void | boolean>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      zip.off("entry", onEntry);
      zip.off("end", onEnd);
      zip.off("error", onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      resolve();
    };
    const onEntry = (entry: yauzl.Entry) => {
      void Promise.resolve()
        .then(() => (entry.fileName.endsWith("/") ? undefined : visit(entry)))
        .then((keepReading) => {
          if (keepReading === false) onEnd();
          else zip.readEntry();
        })
        .catch((error: unknown) =>
          onError(
            error instanceof Error
              ? error
              : new Error("Cannot scan ZIP", { cause: error }),
          ),
        );
    };
    zip.on("entry", onEntry);
    zip.once("end", onEnd);
    zip.once("error", onError);
    zip.readEntry();
  });
}

async function copyNodeZipEntry(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  target: File,
): Promise<void> {
  const writer = await target.openWriter();
  try {
    const stream = await openNodeZipEntryStream(zipFile, entry);
    await writeNodeStream(stream, writer);
    await writer.commit();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}

async function readNodeZipEntry(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<Uint8Array> {
  return await collectNodeStream(await openNodeZipEntryStream(zipFile, entry));
}

async function readNodeZipEntryRange(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  assertFileRange(offset, length, entry.uncompressedSize);
  if (length === 0) return new Uint8Array();
  if (entry.compressionMethod !== 0) {
    const content = await collectDecodedNodeStreamRange(
      await openNodeZipEntryStream(zipFile, entry),
      offset,
      length,
    );
    return new Uint8Array(
      content.buffer,
      content.byteOffset,
      content.byteLength,
    );
  }
  const content = await collectNodeStream(
    await openNodeZipEntryStream(zipFile, entry, {
      decompress: null,
      decrypt: null,
      end: offset + length,
      start: offset,
    }),
  );
  return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
}

async function collectDecodedNodeStreamRange(
  input: NodeJS.ReadableStream,
  offset: number,
  length: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const end = offset + length;
  let position = 0;
  let collected = 0;
  for await (const value of input) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const chunkEnd = position + chunk.byteLength;
    if (chunkEnd > offset && position < end) {
      const selected = chunk.subarray(
        Math.max(0, offset - position),
        Math.min(chunk.byteLength, end - position),
      );
      chunks.push(selected);
      collected += selected.byteLength;
    }
    position = chunkEnd;
    if (position >= end) break;
  }
  if (collected !== length) {
    throw new Error("ZIP entry changed while reading its byte range");
  }
  return Buffer.concat(chunks, collected);
}

async function openNodeZipEntryStream(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  options?: yauzl.ZipFileOptions,
): Promise<NodeJS.ReadableStream> {
  return await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    const callback = (error: Error | null, opened: Readable) => {
      if (error || opened === undefined) {
        reject(error ?? new Error(`Cannot read ZIP entry: ${entry.fileName}`));
      } else {
        resolve(opened);
      }
    };
    if (options === undefined) zipFile.openReadStream(entry, callback);
    else zipFile.openReadStream(entry, options, callback);
  });
}

async function writeNodeZip(
  file: File,
  entries: Iterable<HostZipWriteEntry> | AsyncIterable<HostZipWriteEntry>,
  options: { readonly beforeCommit?: () => Promise<void> } = {},
): Promise<void> {
  const zipFile = new yazl.ZipFile();
  const writer = await file.openWriter();
  const outputStream = zipFile.outputStream as Readable;
  const outputDone = writeNodeStream(outputStream, writer);
  const entryState = { cancelled: false, complete: false };
  let iterator:
    | Iterator<HostZipWriteEntry>
    | AsyncIterator<HostZipWriteEntry>
    | undefined;

  try {
    iterator = getNodeZipEntryIterator(entries);
    const entriesDone = addNodeZipEntries(zipFile, iterator, entryState);
    await Promise.race([entriesDone, outputDone]);
    if (!entryState.complete) {
      throw new Error("ZIP output ended before entry production completed");
    }
    zipFile.end();
    await outputDone;
    await options.beforeCommit?.();
    await writer.commit();
  } catch (error) {
    entryState.cancelled = true;
    if (!entryState.complete && iterator !== undefined) {
      closeNodeZipEntryIterator(iterator);
    }
    if (!outputStream.destroyed) {
      outputStream.destroy(
        error instanceof Error ? error : new Error("Cannot write ZIP archive"),
      );
    }
    await outputDone.catch(() => undefined);
    await writer.abort().catch(() => undefined);
    throw error;
  }
}

async function addNodeZipEntries(
  zipFile: yazl.ZipFile,
  iterator: Iterator<HostZipWriteEntry> | AsyncIterator<HostZipWriteEntry>,
  state: { cancelled: boolean; complete: boolean },
): Promise<void> {
  const stableZipOptions = {
    compress: false,
    forceDosTimestamp: true,
    mtime: new Date(1980, 0, 2),
  } as const;
  while (!state.cancelled) {
    const result = await iterator.next();
    if (state.cancelled) return;
    if (result.done) {
      state.complete = true;
      return;
    }
    if ("file" in result.value) {
      zipFile.addReadStream(
        createNodeFileReadStream(result.value.file),
        result.value.name,
        stableZipOptions,
      );
    } else if ("data" in result.value) {
      zipFile.addBuffer(Buffer.from(result.value.data), result.value.name, {
        ...stableZipOptions,
      });
    } else {
      zipFile.addReadStream(
        createNodeRangeReadStream(result.value),
        result.value.name,
        { ...stableZipOptions, size: result.value.size },
      );
    }
  }
}

function createNodeFileReadStream(file: ReadonlyFile): Readable {
  return Readable.from(
    (async function* () {
      const reader = await file.openReader();
      try {
        for (let offset = 0; offset < reader.size; ) {
          const chunk = await reader.read(
            offset,
            Math.min(64 * 1024, reader.size - offset),
          );
          offset += chunk.byteLength;
          yield chunk;
        }
      } finally {
        await reader.close();
      }
    })(),
  );
}

function getBrandedNodeResourcePath(
  resource: unknown,
  kind: "directory" | "file",
): string | undefined {
  if (typeof resource !== "object" || resource === null) return undefined;
  const candidate = resource as {
    readonly [NODE_RESOURCE_KIND]?: unknown;
    readonly path?: unknown;
  };
  return candidate[NODE_RESOURCE_KIND] === kind &&
    typeof candidate.path === "string"
    ? candidate.path
    : undefined;
}

function createNodeRangeReadStream(
  entry: Extract<HostZipWriteEntry, { readonly size: number }>,
): Readable {
  return Readable.from(
    (async function* () {
      for (let offset = 0; offset < entry.size; ) {
        const chunk = await entry.read(
          offset,
          Math.min(64 * 1024, entry.size - offset),
        );
        offset += chunk.byteLength;
        yield chunk;
      }
    })(),
  );
}

function getNodeZipEntryIterator(
  entries: Iterable<HostZipWriteEntry> | AsyncIterable<HostZipWriteEntry>,
): Iterator<HostZipWriteEntry> | AsyncIterator<HostZipWriteEntry> {
  const asyncIterator = (entries as AsyncIterable<HostZipWriteEntry>)[
    Symbol.asyncIterator
  ];
  return asyncIterator === undefined
    ? (entries as Iterable<HostZipWriteEntry>)[Symbol.iterator]()
    : asyncIterator.call(entries);
}

function closeNodeZipEntryIterator(
  iterator: Iterator<HostZipWriteEntry> | AsyncIterator<HostZipWriteEntry>,
): void {
  if (iterator.return === undefined) return;
  try {
    void Promise.resolve(iterator.return()).catch(() => undefined);
  } catch {
    // Preserve the failure that caused iteration to stop.
  }
}

async function writeNodeStream(
  input: NodeJS.ReadableStream,
  writer: FileWriter,
): Promise<void> {
  await pipeline(
    input,
    new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        void writer.write(chunk).then(
          () => callback(),
          (error: unknown) =>
            callback(
              error instanceof Error
                ? error
                : new Error("Cannot stream ZIP archive"),
            ),
        );
      },
    }),
  );
}

async function collectNodeStream(
  input: NodeJS.ReadableStream,
): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    input.on("data", (chunk: Buffer) => chunks.push(chunk));
    input.once("error", reject);
    input.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

export const nodeWikiGraphPlatform: WikiGraphPlatform = {
  asyncContext: {
    create: <T>() => new asyncHooks.AsyncLocalStorage<T>(),
  },
  database: { open: openNodeDatabase },
  lifecycle: {
    instanceId: `node-process:${nodeProcess.pid}`,
    isInstanceAlive: (instanceId) => {
      const match = /^node-process:(\d+)$/u.exec(instanceId);
      if (match === null) return Promise.resolve(undefined);
      try {
        nodeProcess.kill(Number(match[1]), 0);
        return Promise.resolve(true);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ESRCH"
        ) {
          return Promise.resolve(false);
        }
        return Promise.resolve(true);
      }
    },
  },
  resources: {
    getDirectory: (identity) => {
      const path = decodeNodeResourceIdentity(identity, "directory");
      return Promise.resolve(
        path === undefined ? undefined : new NodeDirectory(path),
      );
    },
    getFile: (identity) => {
      const path = decodeNodeResourceIdentity(identity, "file");
      return Promise.resolve(
        path === undefined ? undefined : new NodeFile(path),
      );
    },
    resolveLegacyDirectory: (reference) => {
      const path = decodeNodeResourceIdentity(reference, "directory");
      return Promise.resolve(
        path === undefined ? undefined : new NodeDirectory(path),
      );
    },
  },
  templates: {
    createEnvironment: (options) =>
      new Environment(new NodeTemplateLoader(), options),
  },
  zip: {
    open: openNodeZip,
    write: writeNodeZip,
  },
};

export interface NodeWikiGraphPlatformOptions {
  readonly lifecycle?: HostLifecycleProvider;
}

/** Create the Node platform with an optional host-owned lifecycle identity. */
export function createNodeWikiGraphPlatform(
  options: NodeWikiGraphPlatformOptions = {},
): WikiGraphPlatform {
  return options.lifecycle === undefined
    ? nodeWikiGraphPlatform
    : { ...nodeWikiGraphPlatform, lifecycle: options.lifecycle };
}

class NodeTemplateLoader extends Loader {
  readonly #dataDirectory: string | undefined;

  public constructor(dataDirectory?: string) {
    super();
    this.#dataDirectory = dataDirectory;
  }

  public getSource(templateName: string): LoaderSource {
    const name = normalizeTemplateName(templateName);
    const filePath = pathModule.join(
      this.#dataDirectory ?? resolveNodeDataDirectory(),
      name,
    );
    return {
      noCache: false,
      path: name,
      src: fs.readFileSync(filePath, "utf8"),
    };
  }
}

export function createNodeTemplateEnvironment(
  dataDirectory: string,
  options: {
    readonly autoescape?: boolean;
    readonly trimBlocks?: boolean;
  } = {},
): Environment {
  return new Environment(new NodeTemplateLoader(dataDirectory), {
    autoescape: options.autoescape ?? true,
    trimBlocks: options.trimBlocks ?? true,
  });
}

function resolveNodeDataDirectory(): string {
  const injected = (globalThis as { __WIKIGRAPH_DATA_DIR__?: unknown })
    .__WIKIGRAPH_DATA_DIR__;
  if (typeof injected === "string" && injected !== "") return injected;
  let directory = nodeProcess.cwd();
  while (true) {
    for (const candidate of [
      pathModule.join(directory, "data"),
      pathModule.join(directory, "packages", "core", "data"),
    ]) {
      try {
        if (fs.statSync(candidate).isDirectory()) return candidate;
      } catch {
        // Keep looking toward the filesystem root.
      }
    }
    const parent = pathModule.dirname(directory);
    if (parent === directory)
      throw new Error("Could not locate data directory");
    directory = parent;
  }
}

export interface NodeWikiGraphStorageOptions {
  readonly documentStoreRoot: string;
  readonly libraryRoot: string;
}

export function createNodeWikiGraphStorage(
  stateRootOrOptions: string | NodeWikiGraphStorageOptions = pathModule.join(
    os.homedir(),
    ".wikigraph",
  ),
): WikiGraphStorage {
  const libraryRoot =
    typeof stateRootOrOptions === "string"
      ? stateRootOrOptions
      : stateRootOrOptions.libraryRoot;
  const documentStoreRoot =
    typeof stateRootOrOptions === "string"
      ? pathModule.join(stateRootOrOptions, "documents")
      : stateRootOrOptions.documentStoreRoot;
  return {
    library: new NodeDirectory(libraryRoot),
    documentStore: new NodeDirectory(documentStoreRoot),
  };
}

export function installNodeWikiGraphPlatform(stateRoot?: string): void {
  installWikiGraphPlatform(nodeWikiGraphPlatform);
  installWikiGraphStorage(createNodeWikiGraphStorage(stateRoot));
}

export function ensureNodeWikiGraphPlatform(): void {
  try {
    getWikiGraphPlatform();
  } catch {
    installWikiGraphPlatform(nodeWikiGraphPlatform);
  }
  try {
    getWikiGraphStorage();
  } catch {
    installWikiGraphStorage(createNodeWikiGraphStorage());
  }
}

export async function withNodeWikiGraphStorage<T>(
  stateRoot: string | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await withWikiGraphStorage(
    stateRoot === undefined ? undefined : createNodeWikiGraphStorage(stateRoot),
    operation,
  );
}

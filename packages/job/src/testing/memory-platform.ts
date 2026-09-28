import type {
  JobDirectory,
  JobFile,
  JobFileReader,
  JobFileWriter,
} from "../platform.js";

export class MemoryJobFile implements JobFile {
  public readonly identity: string;
  public readonly kind = "file" as const;
  public readonly name: string;
  #bytes = new Uint8Array();

  public constructor(name: string) {
    this.name = name;
    this.identity = `memory:${name}`;
  }

  public openReader(): Promise<JobFileReader> {
    const bytes = this.#bytes;
    return Promise.resolve({
      size: bytes.byteLength,
      close: () => Promise.resolve(),
      read: (offset, length) =>
        Promise.resolve(bytes.slice(offset, offset + length)),
    });
  }

  public openWriter(): Promise<JobFileWriter> {
    const chunks: Uint8Array[] = [];
    const encoder = new TextEncoder();
    return Promise.resolve({
      abort: () => {
        chunks.length = 0;
        return Promise.resolve();
      },
      commit: () => {
        const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        this.#bytes = bytes;
        return Promise.resolve();
      },
      write: (data) => {
        chunks.push(typeof data === "string" ? encoder.encode(data) : data);
        return Promise.resolve();
      },
      writeAt: () => Promise.reject(new Error("writeAt is not implemented.")),
    });
  }
}

export class MemoryJobDirectory implements JobDirectory {
  public readonly identity = "memory:directory";
  public readonly kind = "directory" as const;
  public readonly name = "workspace";
  readonly #files = new Map<string, MemoryJobFile>();

  public createDirectory(): Promise<JobDirectory> {
    return Promise.reject(new Error("Nested directories are not implemented."));
  }

  public createFile(name: string): Promise<MemoryJobFile> {
    if (this.#files.has(name)) {
      return Promise.reject(new Error(`File ${name} already exists.`));
    }
    const file = new MemoryJobFile(name);
    this.#files.set(name, file);
    return Promise.resolve(file);
  }

  public getDirectory(): Promise<JobDirectory | undefined> {
    return Promise.resolve(undefined);
  }

  public getFile(name: string): Promise<MemoryJobFile | undefined> {
    return Promise.resolve(this.#files.get(name));
  }

  public list(): Promise<ReadonlyArray<MemoryJobFile>> {
    return Promise.resolve([...this.#files.values()]);
  }

  public remove(name: string): Promise<void> {
    this.#files.delete(name);
    return Promise.resolve();
  }
}

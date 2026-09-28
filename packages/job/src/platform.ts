export interface JobEntry {
  readonly identity: string;
  readonly kind: "directory" | "file";
  readonly name: string;
}

export interface JobFileReader {
  readonly size: number;
  close(): Promise<void>;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface JobFileWriter {
  abort(): Promise<void>;
  commit(): Promise<void>;
  write(data: Uint8Array | string): Promise<void>;
  writeAt(offset: number, data: Uint8Array): Promise<void>;
}

export interface JobFile extends JobEntry {
  readonly kind: "file";
  openReader(): Promise<JobFileReader>;
  openWriter(): Promise<JobFileWriter>;
}

export interface JobDirectory extends JobEntry {
  readonly kind: "directory";
  createDirectory(name: string): Promise<JobDirectory>;
  createFile(name: string): Promise<JobFile>;
  getDirectory(name: string): Promise<JobDirectory | undefined>;
  getFile(name: string): Promise<JobFile | undefined>;
  list(): Promise<ReadonlyArray<JobDirectory | JobFile>>;
  remove(
    name: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void>;
}

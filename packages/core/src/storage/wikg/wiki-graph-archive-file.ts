import type { File, ReadonlyFile } from "../../runtime/platform/index.js";

import { DirectoryDocument } from "../../document/index.js";
import { WikiGraphArchive } from "../../api/wiki-graph-archive.js";
import { deleteArchiveSearchSessions } from "../../retrieval/query/index.js";

import { WikgCoordinator } from "./coordinator.js";
import type { HostWikgArchiveSession } from "./wikg-coordinator/host-session.js";

// Keep high-level callbacks exclusive in this realm; the coordinator retains
// its finer-grained entry and cross-process concurrency underneath.
const archiveFileQueues = new Map<string, Promise<void>>();

/** A .wikg archive exposed to Core as an opaque host File capability. */
export class WikiGraphArchiveFile<TFile extends ReadonlyFile = ReadonlyFile> {
  readonly #file: TFile;
  readonly #coordinator = new WikgCoordinator();

  public constructor(file: TFile) {
    this.#file = file;
  }

  public async read<T>(
    operation: (archive: WikiGraphArchive) => Promise<T> | T,
  ): Promise<T> {
    return await this.readDocument(
      async (document) =>
        await operation(
          new WikiGraphArchive(document, this.#file, { sourceKind: "archive" }),
        ),
    );
  }

  public async readDocument<T>(
    operation: (document: DirectoryDocument) => Promise<T> | T,
    options: { readonly searchIndexWritebackPolicy?: "archive" | "cache" } = {},
  ): Promise<T> {
    return await withSerializedArchiveFileSession(
      this.#file,
      this.#coordinator,
      async (session) => {
        const fileStore = session.createFileStore({
          readonlyDatabase: true,
          ...(options.searchIndexWritebackPolicy === undefined
            ? {}
            : {
                searchIndexWritebackPolicy: options.searchIndexWritebackPolicy,
              }),
        });
        const document = await DirectoryDocument.openFileStore(fileStore);
        try {
          return await operation(document);
        } finally {
          await document.release();
        }
      },
    );
  }

  public async write<T>(
    this: WikiGraphArchiveFile<File>,
    operation: (document: DirectoryDocument) => Promise<T> | T,
    options: { readonly searchIndexWritebackPolicy?: "archive" | "cache" } = {},
  ): Promise<T> {
    const file = requireWritableFile(this.#file);
    return await withSerializedArchiveFileSession(
      file,
      this.#coordinator,
      async (session) => {
        const fileStore = session.createFileStore({
          ...(options.searchIndexWritebackPolicy === undefined
            ? {}
            : {
                searchIndexWritebackPolicy: options.searchIndexWritebackPolicy,
              }),
        });
        const document = await DirectoryDocument.openFileStore(fileStore);
        try {
          return await operation(document);
        } finally {
          try {
            await document.release();
          } finally {
            await deleteArchiveSearchSessions(this.#file.identity);
          }
        }
      },
    );
  }
}

function requireWritableFile(file: ReadonlyFile): File {
  if (!isWritableFile(file)) {
    throw new TypeError("Archive write requires a writable File capability.");
  }
  return file;
}

function isWritableFile(file: ReadonlyFile): file is File {
  return (
    "openWriter" in file &&
    typeof (file as Partial<File>).openWriter === "function"
  );
}

async function withSerializedArchiveFileSession<T>(
  file: ReadonlyFile,
  coordinator: WikgCoordinator,
  operation: (session: HostWikgArchiveSession) => Promise<T> | T,
): Promise<T> {
  return await withSerializedArchiveFileAccess(
    file,
    async () => await coordinator.withArchiveSession(file, operation),
  );
}

async function withSerializedArchiveFileAccess<T>(
  file: ReadonlyFile,
  operation: () => Promise<T>,
): Promise<T> {
  const identity = file.identity;
  const previous = archiveFileQueues.get(identity) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  archiveFileQueues.set(identity, queued);
  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (archiveFileQueues.get(identity) === queued) {
      archiveFileQueues.delete(identity);
    }
  }
}

import type { Directory } from "../../runtime/platform/index.js";
import type { DirectoryDocument } from "../../document/index.js";
import type { WikiGraphArchive } from "../../api/wiki-graph-archive.js";

/** Directory spelling for callers; implementation is loaded lazily to avoid the archive API cycle. */
export class WikiGraphDirectoryFile {
  readonly #directory: Directory;

  public constructor(directory: Directory) {
    this.#directory = directory;
  }

  public async read<T>(
    operation: (archive: WikiGraphArchive) => Promise<T> | T,
  ): Promise<T> {
    const { WikiGraphArchiveFile } =
      await import("./wiki-graph-archive-file.js");
    return await new WikiGraphArchiveFile(this.#directory).read(operation);
  }

  public async readDocument<T>(
    operation: (document: DirectoryDocument) => Promise<T> | T,
  ): Promise<T> {
    const { WikiGraphArchiveFile } =
      await import("./wiki-graph-archive-file.js");
    return await new WikiGraphArchiveFile(this.#directory).readDocument(
      operation,
    );
  }

  public async write<T>(
    operation: (document: DirectoryDocument) => Promise<T> | T,
    options: {
      readonly derivedStateKeys?: readonly string[];
      readonly invalidateContinuationCursors?: boolean;
      readonly searchIndexWritebackPolicy?: "archive" | "cache";
    } = {},
  ): Promise<T> {
    const { WikiGraphArchiveFile } =
      await import("./wiki-graph-archive-file.js");
    return await new WikiGraphArchiveFile(this.#directory).write(
      operation,
      options,
    );
  }
}

export function isWikiGraphDirectoryFile(value: {
  readonly kind: string;
}): value is Directory {
  return value.kind === "directory";
}

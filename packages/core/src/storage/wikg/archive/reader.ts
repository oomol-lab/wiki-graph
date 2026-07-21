import { open as openFile, readFile, type FileHandle } from "fs/promises";
import { join } from "path";

import type { Entry, ZipFile as YauzlZipFile } from "yauzl";

import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import { parseWikgManifest, parseWikgMutationToken } from "./manifest.js";
import { isWikgArchivePath, normalizeArchivePath } from "./paths.js";
import { openIndexedArchive, readArchiveEntryBufferFromFile } from "./zip.js";

export class WikgArchiveReader {
  readonly #entryByPath: Map<string, Entry>;
  readonly #entries: readonly string[];
  #file: Promise<FileHandle> | undefined;
  readonly #path: string;
  readonly #zipFile: YauzlZipFile;

  public constructor(
    path: string,
    zipFile: YauzlZipFile,
    entries: readonly Entry[],
  ) {
    this.#path = path;
    this.#zipFile = zipFile;
    this.#entryByPath = new Map(
      entries
        .map((entry) => [normalizeArchivePath(entry.fileName), entry] as const)
        .filter(([entryPath]) => entryPath !== "")
        .filter(([entryPath]) => isWikgArchivePath(entryPath)),
    );
    this.#entries = [...this.#entryByPath.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  public static async open(inputPath: string): Promise<WikgArchiveReader> {
    const { entries, zipFile } = await openIndexedArchive(inputPath);

    return new WikgArchiveReader(inputPath, zipFile, entries);
  }

  public close(): void {
    this.#zipFile.close();
    if (this.#file !== undefined) {
      void this.#file.then(async (file) => {
        await file.close();
      });
      this.#file = undefined;
    }
  }

  public listEntries(): readonly string[] {
    return this.#entries;
  }

  public async readEntry(entryPath: string): Promise<Buffer | undefined> {
    const entry = this.#entryByPath.get(normalizeArchivePath(entryPath));

    if (entry === undefined) {
      return undefined;
    }

    return await readArchiveEntryBufferFromFile(await this.#getFile(), entry);
  }

  async #getFile(): Promise<FileHandle> {
    this.#file ??= openFile(this.#path, "r");
    return await this.#file;
  }
}

export async function listWikgArchiveEntries(
  inputPath: string,
): Promise<readonly string[]> {
  const reader = await WikgArchiveReader.open(inputPath);

  try {
    return reader.listEntries();
  } finally {
    reader.close();
  }
}

export async function readWikgArchiveEntry(
  inputPath: string,
  entryPath: string,
): Promise<Buffer | undefined> {
  const reader = await WikgArchiveReader.open(inputPath);

  try {
    return await reader.readEntry(entryPath);
  } finally {
    reader.close();
  }
}

export async function readWikgArchiveMutationToken(
  inputPath: string,
): Promise<string> {
  const reader = await WikgArchiveReader.open(inputPath);

  try {
    const content = await reader.readEntry(WIKG_MUTATION_TOKEN_PATH);

    if (content === undefined) {
      throw new Error(
        `Missing WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
      );
    }

    return parseWikgMutationToken(content.toString("utf8"));
  } finally {
    reader.close();
  }
}

export async function readWikgArchiveFormatVersion(
  documentDirectoryPath: string,
): Promise<number> {
  return parseWikgManifest(
    await readFile(join(documentDirectoryPath, WIKG_MANIFEST_PATH), "utf8"),
  ).formatVersion;
}

import { createWriteStream } from "fs";
import {
  mkdir,
  open as openFile,
  readFile,
  readdir,
  writeFile,
  type FileHandle,
} from "fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "path";
import { finished } from "stream/promises";
import { inflateRaw } from "zlib";

import { z } from "zod";
import {
  open as openZip,
  type Entry,
  type ZipFile as YauzlZipFile,
} from "yauzl";
import { ZipFile as YazlZipFile } from "yazl";

import { Database } from "../document/database.js";

export const WIKG_FORMAT_VERSION = 1;
const WIKG_MANIFEST_PATH = "manifest.json";
const SEARCH_INDEX_DATABASE_PATH = "fts.db";
const WIKG_MANIFEST_CONTENT = `${JSON.stringify({
  formatVersion: WIKG_FORMAT_VERSION,
})}\n`;

const WIKG_ARCHIVE_PATTERNS = [
  /^manifest\.json$/u,
  /^database\.db$/u,
  /^fts\.db$/u,
  /^book-meta\.json$/u,
  /^toc\.json$/u,
  /^cover\/(?:data\.bin|info\.json)$/u,
  /^texts\/(?:source|summary)\/\d+\.txt$/u,
] as const;

const wikgManifestSchema = z.object({
  formatVersion: z.literal(WIKG_FORMAT_VERSION),
});

export type WikgArchiveOverlay =
  | {
      readonly entryPath: string;
      readonly kind: "deleted";
    }
  | {
      readonly entryPath: string;
      readonly kind: "file";
      readonly workspacePath: string;
    };

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

export async function extractWikgArchive(
  inputPath: string,
  outputDirectoryPath: string,
): Promise<void> {
  const { entries, zipFile } = await openIndexedArchive(inputPath);
  const file = await openFile(inputPath, "r");

  try {
    for (const entry of entries) {
      const archivePath = normalizeArchivePath(entry.fileName);

      if (archivePath === "") {
        throw new Error(`Invalid archive entry path: ${entry.fileName}`);
      }
      if (!isWikgArchivePath(archivePath)) {
        continue;
      }

      const targetPath = resolve(outputDirectoryPath, archivePath);

      assertWithinDirectory(outputDirectoryPath, targetPath, archivePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(
        targetPath,
        await readArchiveEntryBufferFromFile(file, entry),
      );
    }
  } finally {
    await file.close();
    zipFile.close();
  }
}

export async function writeWikgArchive(
  documentDirectoryPath: string,
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const zipFile = new YazlZipFile();
  const files = await listDocumentFiles(documentDirectoryPath);
  const includeSearchIndex = await shouldEmbedSearchIndex(
    documentDirectoryPath,
  );
  const entries = [
    ...files.filter((file) => {
      if (file.archivePath === WIKG_MANIFEST_PATH) {
        return false;
      }

      return (
        file.archivePath !== SEARCH_INDEX_DATABASE_PATH || includeSearchIndex
      );
    }),
    {
      archivePath: WIKG_MANIFEST_PATH,
      content: Buffer.from(WIKG_MANIFEST_CONTENT, "utf8"),
    },
  ].sort((left, right) => left.archivePath.localeCompare(right.archivePath));

  for (const entry of entries) {
    if ("content" in entry) {
      zipFile.addBuffer(entry.content, entry.archivePath, {
        compress: false,
      });
    } else {
      zipFile.addFile(entry.absolutePath, entry.archivePath, {
        compress: false,
      });
    }
  }

  zipFile.end();

  const output = createWriteStream(outputPath);
  const outputDone = finished(output);
  const zipDone = finished(zipFile.outputStream);

  zipFile.outputStream.pipe(output);
  await Promise.all([outputDone, zipDone]);
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

export async function writeWikgArchiveWithOverlays(
  inputPath: string,
  outputPath: string,
  overlays: readonly WikgArchiveOverlay[],
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const { entries: sourceEntries, zipFile } =
    await openIndexedArchive(inputPath);
  const overlayByPath = new Map(
    overlays.map((overlay) => [
      normalizeArchivePath(overlay.entryPath),
      overlay,
    ]),
  );
  const entryPaths = new Set<string>();

  for (const entry of sourceEntries) {
    const archivePath = normalizeArchivePath(entry.fileName);

    if (archivePath !== "" && isWikgArchivePath(archivePath)) {
      entryPaths.add(archivePath);
    }
  }
  for (const overlay of overlayByPath.values()) {
    const archivePath = normalizeArchivePath(overlay.entryPath);

    if (archivePath !== "" && isWikgArchivePath(archivePath)) {
      entryPaths.add(archivePath);
    }
  }
  entryPaths.add(WIKG_MANIFEST_PATH);

  const outputZipFile = new YazlZipFile();
  const sourceFile = await openFile(inputPath, "r");

  try {
    for (const entryPath of [...entryPaths].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const overlay = overlayByPath.get(entryPath);

      if (entryPath === WIKG_MANIFEST_PATH) {
        outputZipFile.addBuffer(
          Buffer.from(WIKG_MANIFEST_CONTENT, "utf8"),
          entryPath,
          { compress: false },
        );
        continue;
      }
      if (overlay?.kind === "deleted") {
        continue;
      }
      if (overlay?.kind === "file") {
        outputZipFile.addFile(overlay.workspacePath, entryPath, {
          compress: false,
        });
        continue;
      }

      const sourceEntry = sourceEntries.find(
        (candidate) => normalizeArchivePath(candidate.fileName) === entryPath,
      );

      if (sourceEntry === undefined) {
        continue;
      }

      outputZipFile.addBuffer(
        await readArchiveEntryBufferFromFile(sourceFile, sourceEntry),
        entryPath,
        { compress: false },
      );
    }
  } finally {
    await sourceFile.close();
    zipFile.close();
  }

  outputZipFile.end();

  const output = createWriteStream(outputPath);
  const outputDone = finished(output);
  const zipDone = finished(outputZipFile.outputStream);

  outputZipFile.outputStream.pipe(output);
  await Promise.all([outputDone, zipDone]);
}

export async function readWikgArchiveFormatVersion(
  documentDirectoryPath: string,
): Promise<number> {
  return parseWikgManifest(
    await readFile(join(documentDirectoryPath, WIKG_MANIFEST_PATH), "utf8"),
  ).formatVersion;
}

async function listDocumentFiles(
  rootDirectoryPath: string,
  currentDirectoryPath = rootDirectoryPath,
): Promise<Array<{ absolutePath: string; archivePath: string }>> {
  const entries = await readdir(currentDirectoryPath, { withFileTypes: true });
  const files: Array<{ absolutePath: string; archivePath: string }> = [];

  for (const entry of [...entries].sort(compareDirEntryName)) {
    const absolutePath = join(currentDirectoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listDocumentFiles(rootDirectoryPath, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    files.push({
      absolutePath,
      archivePath: relative(rootDirectoryPath, absolutePath)
        .split(sep)
        .join(posix.sep),
    });
  }

  return files.filter((file) => isWikgArchivePath(file.archivePath));
}

async function shouldEmbedSearchIndex(
  documentDirectoryPath: string,
): Promise<boolean> {
  const database = await Database.open(
    join(documentDirectoryPath, "database.db"),
    "",
    {
      readonly: true,
    },
  ).catch(() => undefined);

  if (database === undefined) {
    return true;
  }

  try {
    const row = await database.queryOne(
      `
        SELECT fts_embedded
        FROM archive_index_settings
        WHERE id = 1
      `,
      undefined,
      (value) => Number(value.fts_embedded) !== 0,
    );

    return row ?? false;
  } catch {
    return true;
  } finally {
    await database.close();
  }
}

async function openIndexedArchive(inputPath: string): Promise<{
  readonly entries: readonly Entry[];
  readonly zipFile: YauzlZipFile;
}> {
  const zipFile = await openArchive(inputPath);

  try {
    const entries = await indexArchiveEntries(zipFile);

    await validateArchiveManifest(inputPath, entries);
    return { entries, zipFile };
  } catch (error) {
    zipFile.close();
    throw error;
  }
}

async function indexArchiveEntries(
  zipFile: YauzlZipFile,
): Promise<readonly Entry[]> {
  return await new Promise((resolve, reject) => {
    const entries: Entry[] = [];

    zipFile.on("entry", (entry: Entry) => {
      if (entry.fileName.endsWith("/")) {
        zipFile.readEntry();
        return;
      }

      entries.push(entry);
      zipFile.readEntry();
    });
    zipFile.once("end", () => {
      resolve(entries);
    });
    zipFile.once("error", (error: Error) => {
      reject(error);
    });

    zipFile.readEntry();
  });
}

function compareDirEntryName(
  left: { readonly name: string },
  right: { readonly name: string },
): number {
  return left.name.localeCompare(right.name);
}

function isWikgArchivePath(archivePath: string): boolean {
  return WIKG_ARCHIVE_PATTERNS.some((pattern) => pattern.test(archivePath));
}

async function validateArchiveManifest(
  inputPath: string,
  entries: readonly Entry[],
): Promise<void> {
  const entry = entries.find(
    (candidate) =>
      normalizeArchivePath(candidate.fileName) === WIKG_MANIFEST_PATH,
  );

  if (entry === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }

  parseWikgManifest(await readArchiveEntryText(inputPath, entry));
}

function parseWikgManifest(
  content: string,
): z.infer<typeof wikgManifestSchema> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }

  const result = wikgManifestSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Unsupported WIKG format version in ${WIKG_MANIFEST_PATH}.`,
    );
  }

  return result.data;
}

function assertWithinDirectory(
  rootDirectoryPath: string,
  targetPath: string,
  archivePath: string,
): void {
  const resolvedRootDirectoryPath = resolve(rootDirectoryPath);
  const rootPrefix = resolvedRootDirectoryPath.endsWith(sep)
    ? resolvedRootDirectoryPath
    : `${resolvedRootDirectoryPath}${sep}`;

  if (
    targetPath === resolvedRootDirectoryPath ||
    targetPath.startsWith(rootPrefix)
  ) {
    return;
  }

  throw new Error(`Invalid archive entry path: ${archivePath}`);
}

function normalizeArchivePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").trim();
  const withoutLeadingSlash = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;

  return posix
    .normalize(withoutLeadingSlash)
    .replace(/^(\.\/)+/u, "")
    .replace(/^\/+/u, "");
}

async function openArchive(path: string): Promise<YauzlZipFile> {
  return await new Promise((resolve, reject) => {
    openZip(path, { autoClose: false, lazyEntries: true }, (error, zipFile) => {
      if (error !== null || zipFile === undefined) {
        reject(error ?? new Error(`Cannot open archive: ${path}`));
        return;
      }

      resolve(zipFile);
    });
  });
}

async function readArchiveEntryText(
  inputPath: string,
  entry: Entry,
): Promise<string> {
  return (await readArchiveEntryBuffer(inputPath, entry)).toString("utf8");
}

async function readArchiveEntryBuffer(
  inputPath: string,
  entry: Entry,
): Promise<Buffer> {
  const file = await openFile(inputPath, "r");

  try {
    return await readArchiveEntryBufferFromFile(file, entry);
  } finally {
    await file.close();
  }
}

async function readArchiveEntryBufferFromFile(
  file: FileHandle,
  entry: Entry,
): Promise<Buffer> {
  const compressed = await readCompressedArchiveEntryBuffer(file, entry);

  if (entry.compressionMethod === 0) {
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    return await inflateRawBuffer(compressed);
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.fileName}`);
}

async function readCompressedArchiveEntryBuffer(
  file: FileHandle,
  entry: Entry,
): Promise<Buffer> {
  const header = Buffer.alloc(30);

  await file.read(header, 0, header.length, entry.relativeOffsetOfLocalHeader);
  if (header.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`Invalid ZIP local file header: ${entry.fileName}`);
  }

  const fileNameLength = header.readUInt16LE(26);
  const extraFieldLength = header.readUInt16LE(28);
  const dataOffset =
    entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraFieldLength;
  const compressed = Buffer.alloc(entry.compressedSize);

  await file.read(compressed, 0, compressed.length, dataOffset);
  return compressed;
}

async function inflateRawBuffer(input: Buffer): Promise<Buffer> {
  return await new Promise((resolveInflate, rejectInflate) => {
    inflateRaw(input, (error, output) => {
      if (error !== null) {
        rejectInflate(error);
        return;
      }

      resolveInflate(output);
    });
  });
}

import { createWriteStream } from "fs";
import { mkdir, readFile, readdir } from "fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "path";
import { finished, pipeline } from "stream/promises";

import { z } from "zod";
import {
  open as openZip,
  type Entry,
  type ZipFile as YauzlZipFile,
} from "yauzl";
import { ZipFile as YazlZipFile } from "yazl";

export const WIKG_FORMAT_VERSION = 1;
const WIKG_MANIFEST_PATH = "manifest.json";
const WIKG_MANIFEST_CONTENT = `${JSON.stringify({
  formatVersion: WIKG_FORMAT_VERSION,
})}\n`;

const WIKG_ARCHIVE_PATTERNS = [
  /^manifest\.json$/u,
  /^database\.db$/u,
  /^book-meta\.json$/u,
  /^toc\.json$/u,
  /^cover\/(?:data\.bin|info\.json)$/u,
  /^summaries\/serial-\d+\/fragment_\d+\.json$/u,
  /^fragments\/serial-\d+\/fragment_\d+\.json$/u,
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
  readonly #zipFile: YauzlZipFile;

  public constructor(zipFile: YauzlZipFile, entries: readonly Entry[]) {
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
    const zipFile = await openArchive(inputPath);
    const entries = await indexArchiveEntries(zipFile);

    try {
      await validateArchiveManifest(zipFile, entries);
      return new WikgArchiveReader(zipFile, entries);
    } catch (error) {
      zipFile.close();
      throw error;
    }
  }

  public close(): void {
    this.#zipFile.close();
  }

  public listEntries(): readonly string[] {
    return this.#entries;
  }

  public async readEntry(entryPath: string): Promise<Buffer | undefined> {
    const entry = this.#entryByPath.get(normalizeArchivePath(entryPath));

    if (entry === undefined) {
      return undefined;
    }

    return await readArchiveEntryBuffer(this.#zipFile, entry);
  }
}

export async function extractWikgArchive(
  inputPath: string,
  outputDirectoryPath: string,
): Promise<void> {
  const zipFile = await openArchive(inputPath);
  const entries = await indexArchiveEntries(zipFile);

  try {
    await validateArchiveManifest(zipFile, entries);

    for (const entry of entries) {
      const archivePath = normalizeArchivePath(entry.fileName);

      if (archivePath === "") {
        throw new Error(`Invalid archive entry path: ${entry.fileName}`);
      }

      const targetPath = resolve(outputDirectoryPath, archivePath);

      assertWithinDirectory(outputDirectoryPath, targetPath, archivePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await pipeline(
        await openArchiveEntryStream(zipFile, entry),
        createWriteStream(targetPath),
      );
    }
  } finally {
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
  const entries = [
    ...files.filter((file) => file.archivePath !== WIKG_MANIFEST_PATH),
    {
      archivePath: WIKG_MANIFEST_PATH,
      content: Buffer.from(WIKG_MANIFEST_CONTENT, "utf8"),
    },
  ].sort((left, right) => left.archivePath.localeCompare(right.archivePath));

  for (const entry of entries) {
    if ("content" in entry) {
      zipFile.addBuffer(entry.content, entry.archivePath);
    } else {
      zipFile.addFile(entry.absolutePath, entry.archivePath);
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

  const zipFile = await openArchive(inputPath);
  const sourceEntries = await indexArchiveEntries(zipFile);
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

  try {
    await validateArchiveManifest(zipFile, sourceEntries);

    for (const entryPath of [...entryPaths].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const overlay = overlayByPath.get(entryPath);

      if (overlay?.kind === "deleted") {
        continue;
      }
      if (entryPath === WIKG_MANIFEST_PATH) {
        outputZipFile.addBuffer(
          Buffer.from(WIKG_MANIFEST_CONTENT, "utf8"),
          entryPath,
        );
        continue;
      }
      if (overlay?.kind === "file") {
        outputZipFile.addFile(overlay.workspacePath, entryPath);
        continue;
      }

      const sourceEntry = sourceEntries.find(
        (candidate) => normalizeArchivePath(candidate.fileName) === entryPath,
      );

      if (sourceEntry === undefined) {
        continue;
      }

      outputZipFile.addBuffer(
        await readArchiveEntryBuffer(zipFile, sourceEntry),
        entryPath,
      );
    }
  } finally {
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
  zipFile: YauzlZipFile,
  entries: readonly Entry[],
): Promise<void> {
  const entry = entries.find(
    (candidate) =>
      normalizeArchivePath(candidate.fileName) === WIKG_MANIFEST_PATH,
  );

  if (entry === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }

  parseWikgManifest(await readArchiveEntryText(zipFile, entry));
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

async function openArchiveEntryStream(
  zipFile: YauzlZipFile,
  entry: Entry,
): Promise<NodeJS.ReadableStream> {
  return await new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error !== null || stream === undefined) {
        reject(
          error ?? new Error(`Cannot open archive entry: ${entry.fileName}`),
        );
        return;
      }

      resolve(stream);
    });
  });
}

async function readArchiveEntryText(
  zipFile: YauzlZipFile,
  entry: Entry,
): Promise<string> {
  return (await readArchiveEntryBuffer(zipFile, entry)).toString("utf8");
}

async function readArchiveEntryBuffer(
  zipFile: YauzlZipFile,
  entry: Entry,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = await openArchiveEntryStream(zipFile, entry);

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

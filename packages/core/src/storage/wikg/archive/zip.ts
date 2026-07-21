import { open as openFile, type FileHandle } from "fs/promises";
import { inflateRaw } from "zlib";

import {
  open as openZip,
  type Entry,
  type ZipFile as YauzlZipFile,
} from "yauzl";

import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import { parseWikgManifest, parseWikgMutationToken } from "./manifest.js";
import { normalizeArchivePath } from "./paths.js";

export async function openIndexedArchive(inputPath: string): Promise<{
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

export async function indexArchiveEntries(
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

export async function readArchiveEntryText(
  inputPath: string,
  entry: Entry,
): Promise<string> {
  return (await readArchiveEntryBuffer(inputPath, entry)).toString("utf8");
}

export async function readArchiveEntryBuffer(
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

export async function readArchiveEntryBufferFromFile(
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

async function validateArchiveManifest(
  inputPath: string,
  entries: readonly Entry[],
): Promise<void> {
  await validateArchiveMutationToken(inputPath, entries);

  const entry = entries.find(
    (candidate) =>
      normalizeArchivePath(candidate.fileName) === WIKG_MANIFEST_PATH,
  );

  if (entry === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }

  parseWikgManifest(await readArchiveEntryText(inputPath, entry));
}

async function validateArchiveMutationToken(
  inputPath: string,
  entries: readonly Entry[],
): Promise<void> {
  const firstEntryPath = normalizeArchivePath(entries[0]?.fileName ?? "");

  if (firstEntryPath !== WIKG_MUTATION_TOKEN_PATH) {
    throw new Error(
      `Missing WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
    );
  }

  parseWikgMutationToken(await readArchiveEntryText(inputPath, entries[0]!));
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

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

export const SDPUB_FORMAT_VERSION = 1;
const SDPUB_MANIFEST_PATH = "manifest.json";
const SDPUB_MANIFEST_CONTENT = `${JSON.stringify({
  formatVersion: SDPUB_FORMAT_VERSION,
})}\n`;

const SDPUB_ARCHIVE_PATTERNS = [
  /^manifest\.json$/u,
  /^database\.db$/u,
  /^book-meta\.json$/u,
  /^toc\.json$/u,
  /^cover\/(?:data\.bin|info\.json)$/u,
  /^summaries\/serial-\d+\.txt$/u,
  /^fragments\/serial-\d+\/fragment_\d+\.json$/u,
] as const;

const sdpubManifestSchema = z.object({
  formatVersion: z.literal(SDPUB_FORMAT_VERSION),
});

export async function extractSdpubArchive(
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

export async function writeSdpubArchive(
  documentDirectoryPath: string,
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const zipFile = new YazlZipFile();
  const files = await listDocumentFiles(documentDirectoryPath);
  const entries = [
    ...files.filter((file) => file.archivePath !== SDPUB_MANIFEST_PATH),
    {
      archivePath: SDPUB_MANIFEST_PATH,
      content: Buffer.from(SDPUB_MANIFEST_CONTENT, "utf8"),
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

export async function readSdpubArchiveFormatVersion(
  documentDirectoryPath: string,
): Promise<number> {
  return parseSdpubManifest(
    await readFile(join(documentDirectoryPath, SDPUB_MANIFEST_PATH), "utf8"),
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

  return files.filter((file) => isSdpubArchivePath(file.archivePath));
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

function isSdpubArchivePath(archivePath: string): boolean {
  return SDPUB_ARCHIVE_PATTERNS.some((pattern) => pattern.test(archivePath));
}

async function validateArchiveManifest(
  zipFile: YauzlZipFile,
  entries: readonly Entry[],
): Promise<void> {
  const entry = entries.find(
    (candidate) =>
      normalizeArchivePath(candidate.fileName) === SDPUB_MANIFEST_PATH,
  );

  if (entry === undefined) {
    throw new Error(`Missing SDPUB manifest: ${SDPUB_MANIFEST_PATH}.`);
  }

  parseSdpubManifest(await readArchiveEntryText(zipFile, entry));
}

function parseSdpubManifest(
  content: string,
): z.infer<typeof sdpubManifestSchema> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid SDPUB manifest: ${SDPUB_MANIFEST_PATH}.`);
  }

  const result = sdpubManifestSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Unsupported SDPUB format version in ${SDPUB_MANIFEST_PATH}.`,
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
  const chunks: Buffer[] = [];
  const stream = await openArchiveEntryStream(zipFile, entry);

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

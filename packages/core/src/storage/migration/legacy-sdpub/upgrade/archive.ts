import { posix, resolve, sep } from "path";
import {
  open as openZip,
  type Entry,
  type ZipFile as YauzlZipFile,
} from "yauzl";

const LEGACY_SDPUB_PATTERNS = [
  /^manifest\.json$/u,
  /^database\.db$/u,
  /^toc\.json$/u,
  /^cover\/(?:data\.bin|info\.json)$/u,
  /^summaries\/serial-\d+\.txt$/u,
  /^fragments\/serial-\d+\/fragment_\d+\.json$/u,
] as const;

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

export function isLegacySdpubPath(archivePath: string): boolean {
  return LEGACY_SDPUB_PATTERNS.some((pattern) => pattern.test(archivePath));
}

export function assertWithinDirectory(
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

export function normalizeArchivePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").trim();
  const withoutLeadingSlash = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;

  return posix
    .normalize(withoutLeadingSlash)
    .replace(/^(\.\/)+/u, "")
    .replace(/^\/+/u, "");
}

export async function openArchive(path: string): Promise<YauzlZipFile> {
  return await new Promise((resolveOpen, rejectOpen) => {
    openZip(path, { autoClose: false, lazyEntries: true }, (error, zipFile) => {
      if (error !== null || zipFile === undefined) {
        rejectOpen(error ?? new Error(`Cannot open archive: ${path}`));
        return;
      }

      resolveOpen(zipFile);
    });
  });
}

export async function openArchiveEntryStream(
  zipFile: YauzlZipFile,
  entry: Entry,
): Promise<NodeJS.ReadableStream> {
  return await new Promise((resolveStream, rejectStream) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error !== null || stream === undefined) {
        rejectStream(
          error ?? new Error(`Cannot open archive entry: ${entry.fileName}`),
        );
        return;
      }

      resolveStream(stream);
    });
  });
}

export async function readArchiveEntryText(
  zipFile: YauzlZipFile,
  entry: Entry,
): Promise<string> {
  const chunks: Buffer[] = [];
  const stream = await openArchiveEntryStream(zipFile, entry);

  await new Promise<void>((resolveRead, rejectRead) => {
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    stream.once("end", resolveRead);
    stream.once("error", rejectRead);
  });

  return Buffer.concat(chunks).toString("utf8");
}

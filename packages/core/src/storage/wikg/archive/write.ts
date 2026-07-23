import { createWriteStream } from "fs";
import { mkdir, open as openFile } from "fs/promises";
import { dirname } from "path";
import { finished } from "stream/promises";

import { ZipFile as YazlZipFile } from "yazl";

import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import {
  listDocumentFiles,
  shouldEmbedSearchIndex,
  shouldWriteDocumentFile,
} from "./document-files.js";
import {
  createWikgMutationTokenContent,
  WIKG_MANIFEST_CONTENT,
} from "./manifest.js";
import {
  isWikgArchivePath,
  normalizeArchivePath,
  sortArchiveEntriesForWrite,
  sortArchiveEntryPathsForWrite,
} from "./paths.js";
import type { WikgArchiveOverlay } from "./types.js";
import { openIndexedArchive, readArchiveEntryBufferFromFile } from "./zip.js";

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
  const entries = sortArchiveEntriesForWrite([
    {
      archivePath: WIKG_MUTATION_TOKEN_PATH,
      content: createWikgMutationTokenContent(),
    },
    {
      archivePath: WIKG_MANIFEST_PATH,
      content: Buffer.from(WIKG_MANIFEST_CONTENT, "utf8"),
    },
    ...files.filter((file) =>
      shouldWriteDocumentFile({
        archivePath: file.archivePath,
        includeSearchIndex,
      }),
    ),
  ]);

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
  await writeZipFile(zipFile, outputPath);
}

export async function writeWikgArchiveWithOverlays(
  inputPath: string,
  outputPath: string,
  overlays: readonly WikgArchiveOverlay[],
  options: { readonly preserveMutationToken?: boolean } = {},
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
  entryPaths.add(WIKG_MUTATION_TOKEN_PATH);
  entryPaths.add(WIKG_MANIFEST_PATH);

  const outputZipFile = new YazlZipFile();
  const sourceFile = await openFile(inputPath, "r");

  try {
    for (const entryPath of sortArchiveEntryPathsForWrite(entryPaths)) {
      const overlay = overlayByPath.get(entryPath);

      if (entryPath === WIKG_MUTATION_TOKEN_PATH) {
        if (options.preserveMutationToken === true) {
          const sourceEntry = sourceEntries.find(
            (candidate) =>
              normalizeArchivePath(candidate.fileName) === entryPath,
          );

          if (sourceEntry !== undefined) {
            outputZipFile.addBuffer(
              await readArchiveEntryBufferFromFile(sourceFile, sourceEntry),
              entryPath,
              { compress: false },
            );
            continue;
          }
        }

        outputZipFile.addBuffer(createWikgMutationTokenContent(), entryPath, {
          compress: false,
        });
        continue;
      }
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
  await writeZipFile(outputZipFile, outputPath);
}

async function writeZipFile(
  zipFile: YazlZipFile,
  outputPath: string,
): Promise<void> {
  const output = createWriteStream(outputPath);
  const outputDone = finished(output);
  const zipDone = finished(zipFile.outputStream);

  zipFile.outputStream.pipe(output);
  await Promise.all([outputDone, zipDone]);
}

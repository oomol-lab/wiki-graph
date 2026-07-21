import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import { pipeline } from "stream/promises";

import type { Entry, ZipFile as YauzlZipFile } from "yauzl";

import {
  assertWithinDirectory,
  indexArchiveEntries,
  isLegacySdpubPath,
  normalizeArchivePath,
  openArchive,
  openArchiveEntryStream,
  readArchiveEntryText,
} from "./archive.js";

const LEGACY_FORMAT_VERSION = 1;

export async function extractLegacySdpubArchive(
  inputPath: string,
  outputDirectoryPath: string,
): Promise<void> {
  const zipFile = await openArchive(inputPath);

  try {
    const entries = await indexArchiveEntries(zipFile);

    await assertLegacySdpubArchive(zipFile, entries);
    for (const entry of entries) {
      const archivePath = normalizeArchivePath(entry.fileName);

      if (archivePath === "" || !isLegacySdpubPath(archivePath)) {
        continue;
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

async function assertLegacySdpubArchive(
  zipFile: YauzlZipFile,
  entries: readonly Entry[],
): Promise<void> {
  const paths = new Set(
    entries.map((entry) => normalizeArchivePath(entry.fileName)),
  );

  if (!paths.has("database.db") || !paths.has("toc.json")) {
    throw new Error("Unsupported legacy sdpub archive.");
  }
  if (paths.has("manifest.json")) {
    const manifestEntry = entries.find(
      (entry) => normalizeArchivePath(entry.fileName) === "manifest.json",
    );

    if (manifestEntry === undefined) {
      throw new Error("Unsupported legacy sdpub archive.");
    }

    assertSupportedManifest(await readArchiveEntryText(zipFile, manifestEntry));
  }
}

function assertSupportedManifest(content: string): void {
  try {
    const parsed = JSON.parse(content) as { readonly formatVersion?: unknown };

    if (parsed.formatVersion === LEGACY_FORMAT_VERSION) {
      return;
    }
  } catch {
    throw new Error("Unsupported legacy sdpub archive.");
  }

  throw new Error("Unsupported legacy sdpub archive.");
}

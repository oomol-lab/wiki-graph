import { mkdir, open as openFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

import {
  assertWithinDirectory,
  isWikgArchivePath,
  normalizeArchivePath,
} from "./paths.js";
import { openIndexedArchive, readArchiveEntryBufferFromFile } from "./zip.js";

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

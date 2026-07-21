import { readdir, rm, rmdir, stat } from "fs/promises";
import { join } from "path";

import { isNodeError } from "../../utils/node-error.js";

const DISPOSABLE_DIRECTORY_ENTRIES = new Set([".DS_Store"]);
const DISPOSABLE_DIRECTORY_TTL_MS = 60_000;

export function isDisposableDirectoryEntry(name: string): boolean {
  return DISPOSABLE_DIRECTORY_ENTRIES.has(name);
}

export async function removeDisposableDirectory(
  directoryPath: string,
): Promise<number> {
  const entries = await readdir(directoryPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (entries === undefined) {
    return 0;
  }
  if (entries.some((entry) => !isDisposableDirectoryEntry(entry))) {
    return 0;
  }

  let freedBytes = 0;

  for (const entry of entries) {
    const path = join(directoryPath, entry);

    freedBytes += await readPathSize(path);
    await rm(path, { force: true, recursive: true });
  }

  await rmdir(directoryPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  });
  return freedBytes;
}

export async function removeDisposableChildDirectories(
  rootPath: string,
): Promise<{
  readonly freedBytes: number;
  readonly removed: number;
  readonly scanned: number;
}> {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    },
  );
  let freedBytes = 0;
  let removed = 0;
  let scanned = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    scanned += 1;
    const directoryPath = join(rootPath, entry.name);
    const stats = await stat(directoryPath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    });

    if (
      stats === undefined ||
      Date.now() - stats.mtimeMs < DISPOSABLE_DIRECTORY_TTL_MS
    ) {
      continue;
    }

    const removedBytes = await removeDisposableDirectory(directoryPath);

    if (await pathExists(directoryPath)) {
      freedBytes += removedBytes;
      continue;
    }

    freedBytes += removedBytes;
    removed += 1;
  }

  return { freedBytes, removed, scanned };
}

export async function removeDisposableDescendantDirectories(
  rootPath: string,
): Promise<{
  readonly freedBytes: number;
  readonly removed: number;
  readonly scanned: number;
}> {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    },
  );
  let freedBytes = 0;
  let removed = 0;
  let scanned = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directoryPath = join(rootPath, entry.name);
    const childResult =
      await removeDisposableDescendantDirectories(directoryPath);

    freedBytes += childResult.freedBytes;
    removed += childResult.removed;
    scanned += childResult.scanned + 1;

    const removedBytes = await removeDisposableDirectory(directoryPath);

    if (await pathExists(directoryPath)) {
      freedBytes += removedBytes;
      continue;
    }

    freedBytes += removedBytes;
    removed += 1;
  }

  return { freedBytes, removed, scanned };
}

export async function readPathSize(path: string): Promise<number> {
  try {
    const stats = await stat(path);

    if (stats.isDirectory()) {
      const entries = await readdir(path);
      let size = 0;

      for (const entry of entries) {
        size += await readPathSize(join(path, entry));
      }

      return size;
    }

    return stats.size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }

    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

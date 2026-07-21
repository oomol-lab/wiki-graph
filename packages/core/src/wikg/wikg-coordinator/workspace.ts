import { mkdir, readdir } from "fs/promises";
import { basename, dirname, join } from "path";

import { isNodeError } from "../../utils/node-error.js";

import { getCoordinatorStateDirectoryPath } from "./state.js";
import type { WorkspaceDirectoryEntry } from "./types.js";

export async function createWorkspaceFilePath(
  archiveKey: string,
  entryPath: string,
): Promise<string> {
  const directoryPath = join(
    getCoordinatorWorkspaceRootPath(),
    archiveKey,
    dirname(entryPath),
  );

  await mkdir(directoryPath, { recursive: true });
  return join(directoryPath, basename(entryPath));
}

export function getCoordinatorWorkspaceRootPath(): string {
  return join(getCoordinatorStateDirectoryPath(), "work");
}

export async function ensureEmptyDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });

  const entries = await readdir(directoryPath);

  if (entries.length > 0) {
    throw new Error(`Read workspace directory is not empty: ${directoryPath}`);
  }
}

export async function listWorkspaceFiles(directoryPath: string): Promise<string[]> {
  let entries: readonly WorkspaceDirectoryEntry[];

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listWorkspaceFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

export function normalizeEntryPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/u, "");
}

export function normalizeEntryDirectoryPrefix(path: string): string {
  const entryPath = normalizeEntryPath(path);

  return entryPath === "" || entryPath.endsWith("/")
    ? entryPath
    : `${entryPath}/`;
}

import { readdir, rm, stat } from "fs/promises";
import { join } from "path";

import { resolveWikiGraphTempDirectoryPath } from "../common/wiki-graph-temp.js";
import { isNodeError } from "../utils/node-error.js";

import type { GcContext, GcJobResult } from "./types.js";

const TEMP_DIRECTORY_TTL_MS = 60 * 60 * 1000;

export async function runTempDirectoryGc(
  context: GcContext,
): Promise<GcJobResult> {
  const rootPath = resolveWikiGraphTempDirectoryPath();
  let scanned = 0;
  let removed = 0;
  let freedBytes = 0;

  for (const path of await listTempEntryPaths(rootPath)) {
    scanned += 1;
    const stats = await stat(path).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    });

    if (
      stats === undefined ||
      (!context.force && context.now - stats.mtimeMs < TEMP_DIRECTORY_TTL_MS)
    ) {
      continue;
    }

    const bytes = stats.size;

    if (!context.dryRun) {
      await rm(path, { force: true, recursive: true });
    }
    removed += 1;
    freedBytes += bytes;
  }

  return { freedBytes, removed, scanned };
}

async function listTempEntryPaths(rootPath: string): Promise<string[]> {
  try {
    const categories = await readdir(rootPath, { withFileTypes: true });
    const paths: string[] = [];

    for (const category of categories) {
      if (!category.isDirectory()) {
        continue;
      }

      const categoryPath = join(rootPath, category.name);
      const entries = await readdir(categoryPath, { withFileTypes: true });

      for (const entry of entries) {
        paths.push(join(categoryPath, entry.name));
      }
    }

    return paths;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

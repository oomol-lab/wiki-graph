import { mkdir, mkdtemp } from "fs/promises";
import { join } from "path";

import { resolveWikiGraphTempRootDirectoryPath } from "./wiki-graph-dir.js";

export type WikiGraphTempCategory =
  | "archive-open"
  | "archive-write"
  | "cli-output"
  | "sdpub-upgrade"
  | "stdin-create"
  | "url-create";

export function resolveWikiGraphStateRootPath(): string {
  return resolveWikiGraphTempRootDirectoryPath();
}

export function resolveWikiGraphTempDirectoryPath(
  category?: WikiGraphTempCategory,
): string {
  const rootPath = resolveWikiGraphStateRootPath();

  return category === undefined ? rootPath : join(rootPath, category);
}

export async function createWikiGraphTempDirectory(
  category: WikiGraphTempCategory,
): Promise<string> {
  const rootPath = resolveWikiGraphTempDirectoryPath(category);

  await mkdir(rootPath, { recursive: true });
  return await mkdtemp(join(rootPath, `${category}-`));
}

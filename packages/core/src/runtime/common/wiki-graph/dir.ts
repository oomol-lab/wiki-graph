import { homedir } from "os";
import { join, resolve } from "path";

declare global {
  var __WIKIGRAPH_STATE_DIR__: string | undefined;
}

export function resolveWikiGraphHomeDirectoryPath(): string {
  const injectedStateDirPath = globalThis.__WIKIGRAPH_STATE_DIR__;

  if (
    injectedStateDirPath !== undefined &&
    injectedStateDirPath.trim() !== ""
  ) {
    return resolve(injectedStateDirPath);
  }

  return join(homedir(), ".wikigraph");
}

export function setWikiGraphStateDirectoryPathForTesting(
  path: string | undefined,
): void {
  globalThis.__WIKIGRAPH_STATE_DIR__ = path;
}

export function getWikiGraphStateDirectoryPathForTesting(): string | undefined {
  return globalThis.__WIKIGRAPH_STATE_DIR__;
}

export function resolveWikiGraphCoreDatabasePath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "core.sqlite");
}

export function resolveWikiGraphCacheDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "cache");
}

export function resolveWikiGraphCacheDatabasePath(): string {
  return join(resolveWikiGraphCacheDirectoryPath(), "cache.sqlite");
}

export function resolveWikiGraphJobsDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "jobs");
}

export function resolveWikiGraphStagingDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "staging");
}

export function resolveWikiGraphTempRootDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "tmp");
}

export function resolveWikiGraphLogsDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "logs");
}

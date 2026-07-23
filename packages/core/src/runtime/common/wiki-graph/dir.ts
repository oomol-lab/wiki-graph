import { homedir } from "os";
import { join, resolve } from "path";

export function resolveWikiGraphHomeDirectoryPath(): string {
  const devStateDirPath = process.env.WIKIGRAPH_DEV;

  if (devStateDirPath !== undefined && devStateDirPath.trim() !== "") {
    return resolve(devStateDirPath);
  }

  return join(homedir(), ".wikigraph");
}

export function setWikiGraphStateDirectoryPathForTesting(
  path: string | undefined,
): void {
  if (path === undefined) {
    delete process.env.WIKIGRAPH_DEV;
    return;
  }

  process.env.WIKIGRAPH_DEV = path;
}

export function getWikiGraphStateDirectoryPathForTesting(): string | undefined {
  return process.env.WIKIGRAPH_DEV;
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

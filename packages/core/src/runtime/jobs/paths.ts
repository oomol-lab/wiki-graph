import { mkdir } from "fs/promises";
import { join } from "path";

import { resolveWikiGraphJobsDirectoryPath } from "../common/wiki-graph/dir.js";

export function getBuildQueueDatabasePath(): string {
  return join(getBuildQueueStateDirectoryPath(), "job.sqlite");
}

export async function createJobWorkspacePath(jobId: string): Promise<string> {
  const workspacePath = join(getBuildJobWorkspaceRootPath(), jobId);

  await mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

export function getBuildJobWorkspaceRootPath(): string {
  return join(getBuildQueueStateDirectoryPath(), "work");
}

export async function createJobCachePath(jobId: string): Promise<string> {
  const cachePath = join(getBuildJobCacheRootPath(), jobId);

  await mkdir(cachePath, { recursive: true });
  return cachePath;
}

function getBuildJobCacheRootPath(): string {
  return join(getBuildQueueStateDirectoryPath(), "cache");
}

export async function createJobLogPath(jobId: string): Promise<string> {
  const logPath = join(getBuildJobLogRootPath(), jobId);

  await mkdir(logPath, { recursive: true });
  return logPath;
}

function getBuildJobLogRootPath(): string {
  return join(getBuildQueueStateDirectoryPath(), "logs");
}

export async function createJobEventsPath(jobId: string): Promise<string> {
  const rootPath = join(getBuildQueueStateDirectoryPath(), "events");

  await mkdir(rootPath, { recursive: true });
  return join(rootPath, `${jobId}.ndjson`);
}

export function getBuildQueueStateDirectoryPath(): string {
  return resolveWikiGraphJobsDirectoryPath();
}

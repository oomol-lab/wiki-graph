import {
  BUILD_JOB_STATES,
  type BuildJob,
  type BuildJobState,
  type BuildJobTarget,
} from "./types.js";
import {
  getRelativeDirectory,
  getRelativeFile,
  ensureRelativeDirectory,
  ensureRelativeFile,
  getWikiGraphPlatform,
  getWikiGraphStorage,
  type Directory,
} from "../platform/index.js";

export interface StoredBuildJob extends Omit<
  BuildJob,
  "archive" | "cache" | "events" | "log" | "workspace"
> {
  readonly archiveIdentity: string;
  readonly cacheLocator: string;
  readonly eventsLocator: string;
  readonly logLocator: string;
  readonly ownerPid?: number;
  readonly workspaceLocator: string;
}

export function mapBuildJob(row: Record<string, unknown>): StoredBuildJob {
  const currentStep = parseOptionalBuildJobTarget(
    getOptionalString(row, "current_step"),
    "current_step",
  );
  const ownerId = getOptionalString(row, "owner_id");
  const ownerPid =
    row.owner_pid === null ? undefined : getNumber(row, "owner_pid");
  const readingSummaryStartedAt =
    row.reading_summary_started_at === null
      ? undefined
      : getNumber(row, "reading_summary_started_at");
  const finishedAt =
    row.finished_at === null ? undefined : getNumber(row, "finished_at");
  const errorJSON = getOptionalString(row, "error_json");
  const inputRevision =
    row.input_revision === null ? undefined : getNumber(row, "input_revision");
  const llmJSON = getOptionalString(row, "llm_json");
  const prompt = getOptionalString(row, "prompt");

  return {
    archiveKey: getString(row, "archive_key"),
    archiveIdentity: getString(row, "archive_path"),
    cacheLocator: getString(row, "cache_path"),
    chapterId: getNumber(row, "chapter_id"),
    createdAt: getNumber(row, "created_at"),
    ...(currentStep === undefined ? {} : { currentStep }),
    ...(errorJSON === undefined ? {} : { errorJSON }),
    eventsLocator: getString(row, "events_path"),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    jobId: getString(row, "job_id"),
    ...(inputRevision === undefined ? {} : { inputRevision }),
    logLocator: getString(row, "log_path"),
    ...(llmJSON === undefined ? {} : { llmJSON }),
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(ownerPid === undefined ? {} : { ownerPid }),
    ...(prompt === undefined ? {} : { prompt }),
    queueRank: getNumber(row, "queue_rank"),
    state: parseBuildJobState(getString(row, "state")),
    ...(readingSummaryStartedAt === undefined
      ? {}
      : { readingSummaryStartedAt }),
    target: parseBuildJobTarget(getString(row, "target"), "target"),
    updatedAt: getNumber(row, "updated_at"),
    workspaceLocator: getString(row, "workspace_path"),
  };
}

export async function hydrateBuildJob(job: StoredBuildJob): Promise<BuildJob> {
  const resources = getWikiGraphPlatform().resources;
  const [archive, cache, events, log, workspace] = await Promise.all([
    resources.getFile(job.archiveIdentity),
    resolveManagedDirectory(job.cacheLocator),
    resolveManagedFile(job.eventsLocator),
    resolveManagedDirectory(job.logLocator),
    resolveManagedDirectory(job.workspaceLocator),
  ]);
  if (archive === undefined) throw missingResource("archive");
  if (cache === undefined) throw missingResource("cache");
  if (events === undefined) throw missingResource("events");
  if (log === undefined) throw missingResource("log");
  if (workspace === undefined) throw missingResource("workspace");
  const {
    archiveIdentity: _archiveIdentity,
    cacheLocator: _cacheLocator,
    eventsLocator: _eventsLocator,
    logLocator: _logLocator,
    ownerPid: _ownerPid,
    workspaceLocator: _workspaceLocator,
    ...metadata
  } = job;
  return { ...metadata, archive, cache, events, log, workspace };
}

async function resolveManagedDirectory(locator: string) {
  if (locator.startsWith("jobs/")) {
    return (
      (await getRelativeDirectory(getWikiGraphStorage().library, locator)) ??
      createManagedDirectoryHandle(locator)
    );
  }
  return await getWikiGraphPlatform().resources.getDirectory(locator);
}

function createManagedDirectoryHandle(relativePath: string): Directory {
  const root = getWikiGraphStorage().library;
  const childPath = (name: string) => `${relativePath}/${name}`;
  return {
    createDirectory: async (name) =>
      await ensureRelativeDirectory(root, childPath(name)),
    createFile: async (name) => await ensureRelativeFile(root, childPath(name)),
    getDirectory: async (name) =>
      await getRelativeDirectory(root, childPath(name)),
    getFile: async (name) => await getRelativeFile(root, childPath(name)),
    getLastModified: async () =>
      await (
        await getRelativeDirectory(root, relativePath)
      )?.getLastModified?.(),
    identity: `managed:library:${relativePath}`,
    kind: "directory",
    list: async () =>
      (await getRelativeDirectory(root, relativePath))?.list() ?? [],
    name: relativePath.split("/").at(-1) ?? relativePath,
    remove: async (name, options) => {
      await (
        await getRelativeDirectory(root, relativePath)
      )?.remove(name, options);
    },
  };
}

async function resolveManagedFile(locator: string) {
  if (locator.startsWith("jobs/")) {
    return await getRelativeFile(getWikiGraphStorage().library, locator);
  }
  return await getWikiGraphPlatform().resources.getFile(locator);
}

function missingResource(kind: string): Error {
  return new Error(`Build job ${kind} resource is unavailable`);
}

function parseBuildJobState(value: string): BuildJobState {
  if (BUILD_JOB_STATES.includes(value as BuildJobState)) {
    return value as BuildJobState;
  }

  throw new Error(`Invalid build job state: ${value}`);
}

export function parseBuildJobTarget(
  value: string,
  field: string,
): BuildJobTarget {
  if (
    value === "index-embedding-source" ||
    value === "index-embedding-summary" ||
    value === "index-fts" ||
    value === "reading-graph" ||
    value === "knowledge-graph" ||
    value === "reading-summary"
  ) {
    return value;
  }

  throw new Error(`Invalid ${field}: ${value}`);
}

function parseOptionalBuildJobTarget(
  value: string | undefined,
  field: string,
): BuildJobTarget | undefined {
  return value === undefined ? undefined : parseBuildJobTarget(value, field);
}

export function formatBuildJobLane(target: BuildJobTarget): string {
  if (target === "knowledge-graph") {
    return "knowledge-graph";
  }
  if (target.startsWith("index-")) {
    return target;
  }

  return "reading";
}

export function getString(row: Record<string, unknown>, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

export function getNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}

export function getOptionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

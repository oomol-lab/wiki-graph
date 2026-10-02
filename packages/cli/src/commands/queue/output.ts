import {
  formatLocatedChapterUri,
  type BuildJob,
  type ChapterEntry,
  type WikiGraphJobChapterReference,
} from "wiki-graph-sdk";

import {
  formatCLIJSON,
  formatCliCommand,
  formatWikiGraphCommandUri,
  writeTextToStdout,
} from "../../support/index.js";
import {
  formatQueueAddEstimateJSON,
  formatQueueAddEstimateLines,
  type QueueAddEstimate,
} from "./estimate.js";
import { getNodeResourcePath } from "../../runtime/node-platform.js";
import {
  getCLIEnvValue,
  getCLIStateDir,
  getWikiGraphSDK,
} from "../../runtime/context.js";
import { homedir } from "os";
import { join } from "path";

type JobChapterReference = WikiGraphJobChapterReference;

export async function writeJobList(
  jobs: readonly BuildJob[],
  options: { readonly json: boolean },
): Promise<void> {
  const chapters = await resolveJobChapters(jobs);
  if (options.json) {
    await writeTextToStdout(
      formatCLIJSON({
        items: jobs.map((job) => formatJobJSON(job, chapters.get(job.jobId))),
      }),
    );
    return;
  }

  if (jobs.length === 0) {
    await writeTextToStdout("No jobs.\n");
    return;
  }

  await writeTextToStdout(
    `${formatJobListHeader()}\n${jobs
      .map(
        (job) =>
          `${job.jobId.slice(0, 8).padEnd(8)} ${job.state.padEnd(9)} ${(job.currentStep ?? "-").padEnd(7)} ${job.target.padEnd(7)} ${formatJobChapterListLabel(job, chapters.get(job.jobId))}`,
      )
      .join("\n")}\n`,
  );
}

function formatJobListHeader(): string {
  return `${"JOB".padEnd(8)} ${"STATE".padEnd(9)} ${"STEP".padEnd(7)} ${"TARGET".padEnd(7)} CHAPTER`;
}

export async function writeJobStatus(
  job: BuildJob,
  options: { readonly json: boolean },
): Promise<void> {
  const chapter = await resolveJobChapter(job);
  if (options.json) {
    await writeTextToStdout(formatCLIJSON(formatJobJSON(job, chapter)));
    return;
  }

  await writeTextToStdout(
    [
      `Job: ${job.jobId}`,
      `State: ${job.state}`,
      `Archive: ${requireJobResourcePath(job, "archive", "archivePath")}`,
      `Chapter: ${formatJobChapterLabel(job, chapter)}`,
      ...(chapter === undefined ? [] : [`Chapter URI: ${chapter.locatedUri}`]),
      `Target: ${job.target}`,
      `Step: ${job.currentStep ?? "-"}`,
      `Workspace: ${getJobResourcePath(job, "workspace", "workspacePath") ?? "-"}`,
      `Cache: ${getJobResourcePath(job, "cache", "cachePath") ?? "-"}`,
      `Logs: ${getJobResourcePath(job, "log", "logPath") ?? "-"}`,
      ...(job.errorJSON === undefined ? [] : [`Error: ${job.errorJSON}`]),
    ].join("\n") + "\n",
  );
}

function formatJobJSON(
  job: BuildJob,
  chapter?: JobChapterReference,
): Record<string, unknown> {
  return {
    archiveKey: job.archiveKey,
    archivePath: getJobResourcePath(job, "archive", "archivePath"),
    cachePath: getJobResourcePath(job, "cache", "cachePath"),
    chapterId: job.chapterId,
    ...(chapter === undefined
      ? {}
      : {
          chapter: {
            locatedUri: chapter.locatedUri,
            title: chapter.title,
            uri: chapter.uri,
          },
        }),
    createdAt: job.createdAt,
    ...(job.currentStep === undefined ? {} : { currentStep: job.currentStep }),
    ...(job.errorJSON === undefined ? {} : { errorJSON: job.errorJSON }),
    eventsPath: getJobResourcePath(job, "events", "eventsPath"),
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    jobId: job.jobId,
    logPath: getJobResourcePath(job, "log", "logPath"),
    ...(job.llmJSON === undefined
      ? {}
      : { llm: formatJobLLMJSON(job.llmJSON) }),
    ...(job.ownerId === undefined ? {} : { ownerId: job.ownerId }),
    ...(job.prompt === undefined ? {} : { prompt: job.prompt }),
    queueRank: job.queueRank,
    state: job.state,
    ...(job.readingSummaryStartedAt === undefined
      ? {}
      : { readingSummaryStartedAt: job.readingSummaryStartedAt }),
    target: job.target,
    updatedAt: job.updatedAt,
    workspacePath: getJobResourcePath(job, "workspace", "workspacePath"),
  };
}

export function formatJobQueuedNotice(job: BuildJob): string | undefined {
  if (job.state !== "queued") {
    return undefined;
  }

  return "Job is queued; the requested artifact or generated data is not ready until the job succeeds.";
}

function formatJobLLMJSON(value: string): unknown {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      configured: true,
      invalid: true,
    };
  }

  const llm = readJobLLMObject(parsed);

  return {
    configured: true,
    ...(readOptionalString(llm, "provider") === undefined
      ? {}
      : { provider: readOptionalString(llm, "provider") }),
    ...(readOptionalString(llm, "model") === undefined
      ? {}
      : { model: readOptionalString(llm, "model") }),
    ...(readOptionalString(llm, "name") === undefined
      ? {}
      : { name: readOptionalString(llm, "name") }),
    hasApiKey: readOptionalString(llm, "apiKey") !== undefined,
    hasBaseURL:
      readOptionalString(llm, "baseURL") !== undefined ||
      readOptionalString(llm, "baseUrl") !== undefined ||
      readOptionalString(llm, "chatCompletionsUrl") !== undefined,
  };
}

function readJobLLMObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const nested = value.llm;

  return isRecord(nested) ? nested : value;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];

  return typeof field === "string" && field !== "" ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function writeJobSummary(
  job: BuildJob,
  options: {
    readonly estimate?: QueueAddEstimate;
    readonly chapter?: ChapterEntry;
    readonly json: boolean;
    readonly watch?: boolean;
  } = { json: false },
): Promise<void> {
  const chapter =
    options.chapter === undefined
      ? await resolveJobChapter(job)
      : createJobChapterReference(job, options.chapter);
  if (options.json) {
    await writeTextToStdout(
      formatCLIJSON({
        ...formatJobJSON(job, chapter),
        ...(formatJobQueuedNotice(job) === undefined
          ? {}
          : { notice: formatJobQueuedNotice(job) }),
        ...(options.estimate === undefined
          ? {}
          : { estimate: formatQueueAddEstimateJSON(options.estimate) }),
        ...(options.watch === true
          ? {
              watchCommand: formatCliCommand([
                `wikg://local/job/${job.jobId}`,
                "watch",
              ]),
            }
          : {}),
      }),
    );
    return;
  }

  await writeTextToStdout(
    [
      `Job ${job.jobId} ${job.state} ${job.target} chapter ${formatJobChapterLabel(job, chapter)}`,
      ...(chapter === undefined ? [] : [`Chapter URI: ${chapter.locatedUri}`]),
      ...(formatJobQueuedNotice(job) === undefined
        ? []
        : [formatJobQueuedNotice(job)!]),
      ...(options.watch === true
        ? [
            `Watch: ${formatCliCommand([
              `wikg://local/job/${job.jobId}`,
              "watch",
            ])}`,
          ]
        : []),
      ...(options.estimate === undefined
        ? []
        : ["", ...formatQueueAddEstimateLines(options.estimate)]),
      "",
    ].join("\n"),
  );
}

export async function writeArchiveAddSummary(input: {
  readonly archivePath: string;
  readonly created: readonly {
    readonly chapter: ChapterEntry;
    readonly job: BuildJob;
  }[];
  readonly estimate?: QueueAddEstimate;
  readonly json: boolean;
  readonly skipped: readonly {
    readonly chapter: ChapterEntry;
    readonly reason: string;
  }[];
}): Promise<void> {
  const jobsCommand = formatCliCommand(["wikg://local/job", "--json"]);
  const verifyCommand = formatCliCommand([
    formatWikiGraphCommandUri(input.archivePath),
    "inspect",
  ]);

  if (input.json) {
    await writeTextToStdout(
      formatCLIJSON({
        created: input.created.map((item) =>
          formatJobJSON(
            item.job,
            createJobChapterReference(item.job, item.chapter),
          ),
        ),
        ...(input.estimate === undefined
          ? {}
          : { estimate: formatQueueAddEstimateJSON(input.estimate) }),
        ...(input.created.length === 0 ? {} : { jobsCommand, verifyCommand }),
        skipped: input.skipped.map((item) => ({
          chapterId: item.chapter.chapterId,
          chapter: formatChapterJSON(
            createJobChapterReferenceFromPath(input.archivePath, item.chapter),
          ),
          reason: item.reason,
        })),
      }),
    );
    return;
  }

  const lines = [
    `Created: ${input.created.length}`,
    `Skipped: ${input.skipped.length}`,
  ];

  for (const job of input.created) {
    lines.push(
      `Job ${job.job.jobId} ${job.job.state} ${job.job.target} chapter ${formatChapterLabel(job.chapter)}`,
      `Chapter URI: ${createJobChapterReference(job.job, job.chapter).locatedUri}`,
    );
  }
  for (const skipped of input.skipped) {
    lines.push(
      `Skipped chapter ${formatChapterLabel(skipped.chapter)}: ${skipped.reason}`,
    );
  }
  if (input.estimate !== undefined) {
    lines.push("", ...formatQueueAddEstimateLines(input.estimate));
  }
  if (input.created.length > 0) {
    lines.push(
      "",
      `Jobs: ${jobsCommand}`,
      `Verify after the jobs finish: ${verifyCommand}`,
    );
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function formatJobChapterLabel(
  job: BuildJob,
  chapter: JobChapterReference | undefined,
): string {
  return chapter === undefined
    ? `[unavailable; internal id ${job.chapterId}]`
    : formatChapterLabel(chapter);
}

function formatJobChapterListLabel(
  job: BuildJob,
  chapter: JobChapterReference | undefined,
): string {
  return chapter === undefined
    ? `[unavailable; internal id ${job.chapterId}]`
    : `${chapter.title ?? "[untitled]"} ${chapter.locatedUri}`;
}

function formatChapterLabel(
  chapter: Pick<JobChapterReference, "title" | "uri">,
): string {
  return chapter.title === null || chapter.title === undefined
    ? chapter.uri
    : `${JSON.stringify(chapter.title)} (${chapter.uri})`;
}

function formatChapterJSON(
  chapter: JobChapterReference,
): Record<string, unknown> {
  return {
    locatedUri: chapter.locatedUri,
    title: chapter.title,
    uri: chapter.uri,
  };
}

function createJobChapterReference(
  job: BuildJob,
  chapter: ChapterEntry,
): JobChapterReference {
  return createJobChapterReferenceFromPath(
    requireJobResourcePath(job, "archive", "archivePath"),
    chapter,
  );
}

function createJobChapterReferenceFromPath(
  archivePath: string,
  chapter: ChapterEntry,
): JobChapterReference {
  return {
    locatedUri: formatLocatedChapterUri(archivePath, chapter.path),
    title: chapter.title,
    uri: chapter.uri,
  };
}

async function resolveJobChapters(
  jobs: readonly BuildJob[],
): Promise<ReadonlyMap<string, JobChapterReference>> {
  return await getWikiGraphSDK().jobs.resolveChapters(jobs);
}

async function resolveJobChapter(
  job: BuildJob,
): Promise<JobChapterReference | undefined> {
  return await getWikiGraphSDK().jobs.resolveChapter(job);
}

function getJobResourcePath(
  job: BuildJob,
  resourceKey: "archive" | "cache" | "events" | "log" | "workspace",
  legacyKey:
    | "archivePath"
    | "cachePath"
    | "eventsPath"
    | "logPath"
    | "workspacePath",
): string | undefined {
  const record = job as unknown as Record<string, unknown>;
  const resource = record[resourceKey];
  if (resource !== undefined) {
    const managedPath = getManagedJobResourcePath(resource);
    if (managedPath !== undefined) return managedPath;
    return getNodeResourcePath(resource as BuildJob[typeof resourceKey]);
  }
  const legacyPath = record[legacyKey];
  if (typeof legacyPath === "string") return legacyPath;
  return undefined;
}

function getManagedJobResourcePath(resource: unknown): string | undefined {
  if (
    typeof resource !== "object" ||
    resource === null ||
    !("identity" in resource) ||
    typeof resource.identity !== "string" ||
    !resource.identity.startsWith("managed:library:")
  ) {
    return undefined;
  }

  const relativePath = resource.identity.slice("managed:library:".length);
  const segments = relativePath.split("/");
  if (
    relativePath === "" ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\"),
    )
  ) {
    throw new TypeError(`Invalid managed job resource: ${resource.identity}`);
  }
  const environmentHome = getCLIEnvValue("HOME")?.trim();
  const stateDirectory =
    getCLIStateDir() ??
    join(
      environmentHome === undefined || environmentHome === ""
        ? homedir()
        : environmentHome,
      ".wikigraph",
    );
  return join(stateDirectory, ...segments);
}

function requireJobResourcePath(
  job: BuildJob,
  resourceKey: "archive" | "cache" | "events" | "log" | "workspace",
  legacyKey:
    | "archivePath"
    | "cachePath"
    | "eventsPath"
    | "logPath"
    | "workspacePath",
): string {
  const path = getJobResourcePath(job, resourceKey, legacyKey);
  if (path !== undefined) return path;
  throw new TypeError(`Build job is missing ${resourceKey}`);
}

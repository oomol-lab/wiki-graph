import type { BuildJob, ChapterEntry } from "wiki-graph-core";

import {
  formatCLIJSON,
  formatCliCommand,
  writeTextToStdout,
} from "../../support/index.js";
import {
  formatQueueAddEstimateJSON,
  formatQueueAddEstimateLines,
  type QueueAddEstimate,
} from "./estimate.js";

export async function writeJobList(
  jobs: readonly BuildJob[],
  options: { readonly json: boolean },
): Promise<void> {
  if (options.json) {
    await writeTextToStdout(formatCLIJSON({ items: jobs.map(formatJobJSON) }));
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
          `${job.jobId.slice(0, 8).padEnd(8)} ${job.state.padEnd(9)} ${(job.currentStep ?? "-").padEnd(7)} ${job.target.padEnd(7)} ${job.chapterId.toString().padStart(7)} ${formatArchiveName(job.archivePath)}`,
      )
      .join("\n")}\n`,
  );
}

function formatJobListHeader(): string {
  return `${"JOB".padEnd(8)} ${"STATE".padEnd(9)} ${"STEP".padEnd(7)} ${"TARGET".padEnd(7)} ${"CHAPTER".padStart(7)} ARCHIVE`;
}

export async function writeJobStatus(
  job: BuildJob,
  options: { readonly json: boolean },
): Promise<void> {
  if (options.json) {
    await writeTextToStdout(formatCLIJSON(formatJobJSON(job)));
    return;
  }

  await writeTextToStdout(
    [
      `Job: ${job.jobId}`,
      `State: ${job.state}`,
      `Archive: ${job.archivePath}`,
      `Chapter: ${job.chapterId}`,
      `Target: ${job.target}`,
      `Step: ${job.currentStep ?? "-"}`,
      `Workspace: ${job.workspacePath}`,
      `Cache: ${job.cachePath}`,
      `Logs: ${job.logPath}`,
      ...(job.errorJSON === undefined ? [] : [`Error: ${job.errorJSON}`]),
    ].join("\n") + "\n",
  );
}

function formatJobJSON(job: BuildJob): Record<string, unknown> {
  return {
    archiveKey: job.archiveKey,
    archivePath: job.archivePath,
    cachePath: job.cachePath,
    chapterId: job.chapterId,
    createdAt: job.createdAt,
    ...(job.currentStep === undefined ? {} : { currentStep: job.currentStep }),
    ...(job.errorJSON === undefined ? {} : { errorJSON: job.errorJSON }),
    eventsPath: job.eventsPath,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    jobId: job.jobId,
    logPath: job.logPath,
    ...(job.llmJSON === undefined
      ? {}
      : { llm: formatJobLLMJSON(job.llmJSON) }),
    ...(job.ownerId === undefined ? {} : { ownerId: job.ownerId }),
    ...(job.ownerPid === undefined ? {} : { ownerPid: job.ownerPid }),
    ...(job.prompt === undefined ? {} : { prompt: job.prompt }),
    queueRank: job.queueRank,
    state: job.state,
    ...(job.readingSummaryStartedAt === undefined
      ? {}
      : { readingSummaryStartedAt: job.readingSummaryStartedAt }),
    target: job.target,
    updatedAt: job.updatedAt,
    workspacePath: job.workspacePath,
  };
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
    readonly json: boolean;
    readonly watch?: boolean;
  } = { json: false },
): Promise<void> {
  if (options.json) {
    await writeTextToStdout(
      formatCLIJSON({
        ...formatJobJSON(job),
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
      `Job ${job.jobId} ${job.state} ${job.target} chapter ${job.chapterId} ${job.archivePath}`,
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
  readonly created: readonly {
    readonly chapter: ChapterEntry;
    readonly job: BuildJob;
  }[];
  readonly estimate?: QueueAddEstimate;
  readonly json: boolean;
  readonly skipped: readonly {
    readonly chapterId: number;
    readonly reason: string;
  }[];
}): Promise<void> {
  if (input.json) {
    await writeTextToStdout(
      formatCLIJSON({
        created: input.created.map((item) => formatJobJSON(item.job)),
        ...(input.estimate === undefined
          ? {}
          : { estimate: formatQueueAddEstimateJSON(input.estimate) }),
        skipped: input.skipped,
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
      `Job ${job.job.jobId} ${job.job.state} ${job.job.target} chapter ${job.job.chapterId}`,
    );
  }
  for (const skipped of input.skipped) {
    lines.push(`Skipped chapter ${skipped.chapterId}: ${skipped.reason}`);
  }
  if (input.estimate !== undefined) {
    lines.push("", ...formatQueueAddEstimateLines(input.estimate));
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function formatArchiveName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

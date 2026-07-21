import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { WikiGraphScope } from "wiki-graph-core";
import { withLoggingContext } from "wiki-graph-core";
import {
  addBuildJob,
  assertBuildJobInputRevision,
  boostBuildJob,
  buildChapterGraphArtifact,
  buildChapterSummaryArtifactFromSnapshot,
  cancelBuildJob,
  cleanBuildJobs,
  commitChapterGraphArtifact,
  commitChapterKnowledgeGraphArtifact,
  commitChapterSummaryArtifact,
  generateChapterKnowledgeGraphArtifactFromSnapshot,
  getBuildJob,
  listBuildJobs,
  listChapters,
  pauseBuildJob,
  readChapterBuildInput,
  readBuildJobEvents,
  recordBuildJobInputRevision,
  resumeBuildJob,
  resolveBuildJobId,
  runBuildJobWorker,
  snapshotChapterKnowledgeGraphInput,
  snapshotChapterSummaryInput,
  updateBuildJobTarget,
  type BuildJob,
  type BuildJobEvent,
  type BuildJobExecutionContext,
  type BuildJobProgressCounter,
  type BuildJobProgressReporter,
  type BuildJobState,
  type BuildJobTarget,
  type ChapterEntry,
} from "wiki-graph-core";
import { WikiGraphArchiveFile } from "wiki-graph-core";
import type {
  GuaranteedRequest,
  GuaranteedRequestController,
} from "wiki-graph-core";
import type { LLMessage } from "wiki-graph-core";

import type { CLIQueueArguments } from "../args.js";
import { loadCLIConfig, type CLIConfig } from "../config.js";
import {
  createGenerationPerformanceHints,
  DEFAULT_GENERATION_JOB_CONCURRENCY,
  DEFAULT_GENERATION_REQUEST_CONCURRENCY,
  formatGenerationPlanningDuration,
  formatGenerationPlanningModel,
  planGenerationTask,
  type GenerationConcurrency,
  type GenerationPerformanceHint,
  type GenerationPlanningCost,
} from "../generation-planning.js";
import { writeTextToStdout } from "../io.js";
import { formatCLIJSON } from "../json.js";
import { formatCliCommand } from "../shell.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../errors.js";
import {
  ProgressOutputWriter,
  type ProgressCounter,
  type ProgressMetricGroup,
} from "../progress-output.js";
import {
  createStageLLM,
  loadRequiredStageConfig,
  resolveExtractionPrompt,
  resolveKnowledgeGraphRecallPrompt,
} from "../stage-runtime.js";

const TERMINAL_STATES = new Set<BuildJobState>([
  "succeeded",
  "failed",
  "canceled",
]);
const PROGRESS_OUTPUT_INTERVAL_MS = 6_000;

interface QueueAddEstimate {
  readonly chapters: number;
  readonly concurrent: GenerationConcurrency;
  readonly includesPrerequisites: boolean;
  readonly performanceHints: readonly GenerationPerformanceHint[];
  readonly planning: GenerationPlanningCost;
  readonly steps: readonly QueueAddEstimateStep[];
  readonly target: BuildJobTarget;
  readonly words: number;
}

interface QueueAddEstimateStep {
  readonly chapters: number;
  readonly planning: GenerationPlanningCost;
  readonly prerequisite: boolean;
  readonly task: BuildJobTarget;
  readonly words: number;
}

export async function runQueueCommand(args: CLIQueueArguments): Promise<void> {
  switch (args.action) {
    case "add": {
      if (args.chapterId !== undefined) {
        await assertQueueAddReady(args);
      }
      assertBuildCostAccepted(args);
      const config = await loadRequiredStageConfig({
        ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      });
      if (args.target === "knowledge-graph") {
        requireKnowledgeGraphWikispineConfig(config);
      }

      if (args.chapterId === undefined) {
        await addArchiveJobs(args, config);
      } else {
        const chapter = await readQueueAddChapter(args, args.chapterId);
        const estimate = createQueueAddEstimate({
          chapters: [chapter],
          config,
          target: args.target ?? "reading-summary",
        });

        await writeJobSummary(await addChapterJob(args, args.chapterId), {
          estimate,
          json: args.json ?? false,
          watch: true,
        });
      }

      tryStartQueueWorker();
      return;
    }
    case "list":
      await writeJobList(
        await listBuildJobs({
          ...(args.activeOnly === undefined
            ? {}
            : { activeOnly: args.activeOnly }),
          ...(args.all === undefined ? {} : { all: args.all }),
          ...(args.archivePath === undefined
            ? {}
            : { archivePath: args.archivePath }),
        }),
        { json: args.json ?? false },
      );
      return;
    case "status":
      await writeJobStatus(await getBuildJob(await resolveQueueJobId(args)), {
        json: args.json ?? false,
      });
      return;
    case "watch":
      await watchBuildJob(await resolveQueueJobId(args), {
        from: args.from ?? "beginning",
        jsonl: args.jsonl ?? !process.stdout.isTTY,
      });
      return;
    case "pause":
      await writeJobSummary(await pauseBuildJob(await resolveQueueJobId(args)));
      return;
    case "resume":
      await writeJobSummary(
        await resumeBuildJob(await resolveQueueJobId(args)),
      );
      tryStartQueueWorker();
      return;
    case "cancel":
      await writeJobSummary(
        await cancelBuildJob(await resolveQueueJobId(args)),
      );
      return;
    case "boost":
      await writeJobSummary(await boostBuildJob(await resolveQueueJobId(args)));
      tryStartQueueWorker();
      return;
    case "target":
      await writeJobSummary(
        await updateBuildJobTarget(
          await resolveQueueJobId(args),
          args.target ?? "reading-summary",
        ),
      );
      tryStartQueueWorker();
      return;
    case "clean":
      await writeTextToStdout(`Cleaned ${await cleanBuildJobs()} jobs.\n`);
      return;
  }
}

async function resolveQueueJobId(args: CLIQueueArguments): Promise<string> {
  return await resolveBuildJobId(args.jobId!);
}

async function addChapterJob(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<BuildJob> {
  return await addBuildJob({
    archivePath: args.archivePath!,
    boost: args.boost ?? false,
    chapterId,
    ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
    ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
    target: args.target ?? "reading-summary",
  });
}

async function addArchiveJobs(
  args: CLIQueueArguments,
  config: CLIConfig,
): Promise<void> {
  const created: Array<{
    readonly chapter: ChapterEntry;
    readonly job: BuildJob;
  }> = [];
  const skipped: Array<{
    readonly chapterId: number;
    readonly reason: string;
  }> = [];

  await new WikiGraphArchiveFile(args.archivePath!).readDocument(
    async (document) => {
      for (const chapter of await listChapters(document)) {
        if (chapter.stage === "planned") {
          skipped.push({
            chapterId: chapter.chapterId,
            reason: "planned",
          });
          continue;
        }

        try {
          created.push({
            chapter,
            job: await addChapterJob(args, chapter.chapterId),
          });
        } catch (error) {
          skipped.push({
            chapterId: chapter.chapterId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );

  await writeArchiveAddSummary({
    created,
    ...(created.length === 0
      ? {}
      : {
          estimate: createQueueAddEstimate({
            chapters: created.map((item) => item.chapter),
            config,
            target: args.target ?? "reading-summary",
          }),
        }),
    json: args.json ?? false,
    skipped,
  });
}

async function assertQueueAddReady(args: CLIQueueArguments): Promise<void> {
  await new WikiGraphArchiveFile(args.archivePath!).read(async (digest) => {
    if ((await digest.readChapterStage(args.chapterId!)) === "planned") {
      throw new Error(
        `Chapter ${args.chapterId!} is planned. Set source before queueing a build job.`,
      );
    }
  });
}

async function readQueueAddChapter(
  args: CLIQueueArguments,
  chapterId: number,
): Promise<ChapterEntry> {
  let matched: ChapterEntry | undefined;

  await new WikiGraphArchiveFile(args.archivePath!).readDocument(
    async (document) => {
      matched = (await listChapters(document)).find(
        (chapter) => chapter.chapterId === chapterId,
      );
    },
  );

  if (matched === undefined) {
    throw new Error(`Chapter ${chapterId} does not exist.`);
  }

  return matched;
}

function assertBuildCostAccepted(args: CLIQueueArguments): void {
  if (args.acceptCost === true) {
    return;
  }

  throw new Error(
    "Generation tasks can call an LLM, consume tokens, incur provider charges, and run for minutes to hours on large archives. Run `wg <archive-uri> inspect`, then rerun `wg wikg://local/job add` with --accept-cost if the cost and wait time are acceptable.",
  );
}

export async function runQueueWorker(): Promise<void> {
  const config = await loadCLIConfig();

  await runBuildJobWorker({
    concurrency: config.concurrent?.job ?? DEFAULT_GENERATION_JOB_CONCURRENCY,
    executeJob: async (job, reporter, context) => {
      await executeBuildJob(job, reporter, context);
    },
  });
}

async function executeBuildJob(
  job: BuildJob,
  reporter: BuildJobProgressReporter,
  context: BuildJobExecutionContext,
): Promise<void> {
  await withLoggingContext(
    {
      logDirPath: job.logPath,
      operation: "build-job",
    },
    async () => {
      await executeBuildJobWithLogging(job, reporter, context);
    },
  );
}

async function executeBuildJobWithLogging(
  job: BuildJob,
  reporter: BuildJobProgressReporter,
  context: BuildJobExecutionContext,
): Promise<void> {
  const config = await loadRequiredStageConfig({
    ...(job.llmJSON === undefined ? {} : { llmJSON: job.llmJSON }),
  });
  const llm = createStageLLM(config, {
    cacheDirPath: job.cachePath,
    logDirPath: job.logPath,
    onStreamProgress: async (event) => {
      await reporter.addOutputCharacters(event.outputCharacters);
    },
    onTokenUsage: async (usage) => {
      await reporter.addTokenUsage({
        ...(usage.cacheReadTokens === undefined
          ? {}
          : { cacheReadTokens: usage.cacheReadTokens }),
        ...(usage.inputTokens === undefined
          ? {}
          : { inputTokens: usage.inputTokens }),
        ...(usage.outputTokens === undefined
          ? {}
          : { outputTokens: usage.outputTokens }),
      });
    },
  });
  const promptSource = job.prompt ?? config.prompt;
  const extractionPrompt = resolveExtractionPrompt(promptSource);
  const knowledgeGraphRecallPrompt =
    resolveKnowledgeGraphRecallPrompt(promptSource);
  const request: GuaranteedRequestController = async (
    messages: readonly LLMessage[],
    index: number,
    maxRetries: number,
  ): Promise<string> =>
    await llm.request(messages, {
      retryIndex: index,
      retryMax: maxRetries,
      scope: WikiGraphScope.ReaderExtraction,
      signal: context.signal,
    });
  request.lazy = async <T>(
    operation: (request: GuaranteedRequest) => Promise<T>,
  ): Promise<T> => await llm.request(async () => await operation(request));

  const buildInput = await new WikiGraphArchiveFile(
    job.archivePath,
  ).readDocument(
    async (document) => await readChapterBuildInput(document, job.chapterId),
  );
  let { details } = buildInput;
  const { sourceText } = buildInput;
  await recordBuildJobInputRevision({
    currentRevision: buildInput.revision,
    jobId: job.jobId,
    ownerId: requireRunningJobOwnerId(job),
  });

  await reporter.setTotals({
    totalGraphWords: details.stage === "sourced" ? details.words : 0,
    totalReadingSummaryWords:
      details.stage === "sourced" || details.stage === "graphed"
        ? details.words
        : 0,
  });

  if (details.stage === "planned") {
    throw new Error(
      `Chapter ${job.chapterId} is planned. Set source before queueing a build job.`,
    );
  }
  if (job.target === "knowledge-graph") {
    const wikispine = requireKnowledgeGraphWikispineConfig(config);

    await reporter.stepStarted("knowledge-graph");
    const knowledgeGraphInput = await new WikiGraphArchiveFile(
      job.archivePath,
    ).readDocument(async (document) => {
      await assertCurrentBuildInputRevision(job, document);
      return await snapshotChapterKnowledgeGraphInput(document, job.chapterId);
    });
    const artifact = await generateChapterKnowledgeGraphArtifactFromSnapshot(
      job.chapterId,
      knowledgeGraphInput,
      {
        policyPrompt: knowledgeGraphRecallPrompt,
        progressTracker: reporter,
        request,
        resolverOptions: {
          logDirPath: job.logPath,
        },
        wikispine,
        workspacePath: job.workspacePath,
      },
    );

    await reporter.updatePhase({
      done: 0,
      phase: "committing",
      total: 1,
      unit: "item",
    });
    await new WikiGraphArchiveFile(job.archivePath).write(async (document) => {
      assertJobStillRunning(await getBuildJob(job.jobId));
      await assertCurrentBuildInputRevision(job, document);
      await commitChapterKnowledgeGraphArtifact(document, artifact);
    });
    await reporter.updatePhase({
      done: 1,
      phase: "committing",
      total: 1,
      unit: "item",
    });
    await reporter.stepCompleted("knowledge-graph");
    assertJobStillRunning(await getBuildJob(job.jobId));
    return;
  }
  if (details.stage === "sourced") {
    let graphWords = 0;

    await reporter.stepStarted("reading-graph");
    const artifact = await buildChapterGraphArtifact(job.chapterId, {
      extractionPrompt,
      llm,
      sourceText,
      workspacePath: job.workspacePath,
      progressTracker: {
        async advance(wordsCount) {
          graphWords += wordsCount;
          await reporter.updateWords({ graphWords });
        },
        async complete(finalWordsCount) {
          await reporter.updateWords({
            graphWords: finalWordsCount ?? details.words,
          });
        },
      },
    });
    await reporter.updatePhase({
      done: 0,
      phase: "committing",
      total: 1,
      unit: "item",
    });
    details = await new WikiGraphArchiveFile(job.archivePath).write(
      async (document) => {
        assertJobStillRunning(await getBuildJob(job.jobId));
        await assertCurrentBuildInputRevision(job, document);
        return await commitChapterGraphArtifact(document, artifact);
      },
    );
    await reporter.updatePhase({
      done: 1,
      phase: "committing",
      total: 1,
      unit: "item",
    });
    const nextBuildInput = await new WikiGraphArchiveFile(
      job.archivePath,
    ).readDocument(
      async (document) => await readChapterBuildInput(document, job.chapterId),
    );
    details = nextBuildInput.details;
    await recordBuildJobInputRevision({
      currentRevision: nextBuildInput.revision,
      jobId: job.jobId,
      ownerId: requireRunningJobOwnerId(job),
    });
    await reporter.updateWords({ graphWords: details.words });
    await reporter.stepCompleted("reading-graph");
  }

  const latestJob = await getBuildJob(job.jobId);

  assertJobStillRunning(latestJob);
  if (latestJob.target === "reading-graph" || details.stage === "summarized") {
    return;
  }
  if (details.stage !== "graphed") {
    ({ details } = await new WikiGraphArchiveFile(job.archivePath).readDocument(
      async (document) => await readChapterBuildInput(document, job.chapterId),
    ));
  }
  if (details.stage !== "graphed") {
    throw new Error(
      `Chapter ${job.chapterId} is ${details.stage}. Cannot generate summary.`,
    );
  }

  await reporter.stepStarted("reading-summary");
  const summaryInput = await new WikiGraphArchiveFile(
    job.archivePath,
  ).readDocument(async (document) => {
    await assertCurrentBuildInputRevision(job, document);
    return await snapshotChapterSummaryInput(
      document,
      job.chapterId,
      job.workspacePath,
    );
  });
  const summary = await buildChapterSummaryArtifactFromSnapshot(job.chapterId, {
    llm,
    snapshotPath: summaryInput.filePath,
    workspacePath: job.workspacePath,
  });
  await reporter.updatePhase({
    done: 0,
    phase: "committing",
    total: 1,
    unit: "item",
  });
  details = await new WikiGraphArchiveFile(job.archivePath).write(
    async (document) => {
      assertJobStillRunning(await getBuildJob(job.jobId));
      await assertCurrentBuildInputRevision(job, document);
      return await commitChapterSummaryArtifact(
        document,
        job.chapterId,
        summary,
      );
    },
  );
  await reporter.updatePhase({
    done: 1,
    phase: "committing",
    total: 1,
    unit: "item",
  });
  await reporter.updateWords({ readingSummaryWords: details.words });
  await reporter.stepCompleted("reading-summary");
  assertJobStillRunning(await getBuildJob(job.jobId));
}

function requireKnowledgeGraphWikispineConfig(
  config: CLIConfig,
): NonNullable<CLIConfig["wikispine"]> {
  if (config.wikispine?.provider !== undefined) {
    return config.wikispine;
  }

  throw new Error(
    withHelpRoute(
      [
        "Knowledge Graph requires WikiSpine.",
        "Configure `wikg://local/config/wikispine` with provider `cli` or `fetch`, then run `wg wikg://local/config/wikispine test`.",
      ].join(" "),
      CLI_HELP_ROUTES.config,
    ),
  );
}

function assertJobStillRunning(job: BuildJob): void {
  if (job.state !== "running") {
    throw new Error(`Job ${job.jobId} is ${job.state}. Stop before flushing.`);
  }
}

async function assertCurrentBuildInputRevision(
  job: BuildJob,
  document: {
    readonly serials: {
      getRevision(serialId: number): Promise<number>;
    };
  },
): Promise<void> {
  await assertBuildJobInputRevision({
    currentRevision: await document.serials.getRevision(job.chapterId),
    jobId: job.jobId,
    ownerId: requireRunningJobOwnerId(job),
  });
}

function requireRunningJobOwnerId(job: BuildJob): string {
  if (job.ownerId === undefined) {
    throw new Error(`Job ${job.jobId} is not owned by this worker.`);
  }

  return job.ownerId;
}

async function watchBuildJob(
  jobId: string,
  options: {
    readonly from: "beginning" | "now";
    readonly jsonl: boolean;
  },
): Promise<void> {
  let seenSeq = 0;
  const writer = new ProgressOutputWriter({
    jsonl: options.jsonl,
    throttleMs: PROGRESS_OUTPUT_INTERVAL_MS,
  });

  if (options.from === "now") {
    const job = await getBuildJob(jobId);
    const events = await readBuildJobEvents(job);

    seenSeq = events.at(-1)?.seq ?? 0;
  }

  while (true) {
    const job = await getBuildJob(jobId);
    const events = (await readBuildJobEvents(job)).filter(
      (event) => event.seq > seenSeq,
    );

    for (const event of events) {
      seenSeq = Math.max(seenSeq, event.seq);
      await writer.write(formatWatchOutputEvent(event));
    }

    if (TERMINAL_STATES.has(job.state)) {
      return;
    }

    await delay(1_000);
  }
}

function formatWatchOutputEvent(event: BuildJobEvent) {
  switch (event.type) {
    case "status_snapshot": {
      const tokenMetrics = formatProgressTokenMetrics(event.tokens);
      return {
        counters: event.counters.map(formatProgressCounter),
        json: event,
        kind: "status" as const,
        ...(tokenMetrics === undefined ? {} : { metricGroups: [tokenMetrics] }),
        phase: event.phase ?? formatFallbackStatusPhase(event.step),
      };
    }
    case "target_changed":
      return {
        json: event,
        kind: "lifecycle" as const,
        text: `target ${event.from} -> ${event.to}`,
      };
    case "step_started":
      return {
        json: event,
        kind: "lifecycle" as const,
        text: `${event.step} started\nsteps: ${formatStepPlan(event.step)}`,
      };
    case "step_completed":
      return {
        json: event,
        kind: "lifecycle" as const,
        text: `${event.step} completed`,
      };
    case "created":
      return {
        json: event,
        kind: "lifecycle" as const,
        text: "created",
      };
    default:
      return {
        json: event,
        kind: "lifecycle" as const,
        text: event.type,
      };
  }
}

function formatFallbackStatusPhase(step: BuildJobTarget | undefined): string {
  switch (step) {
    case "reading-graph":
      return "extracting";
    case "reading-summary":
      return "summarizing";
    case "knowledge-graph":
      return "knowledge-graph";
    case undefined:
      return "status";
    default:
      return "status";
  }
}

function formatStepPlan(step: string): string {
  switch (step) {
    case "knowledge-graph":
      return "matching -> screening -> enrichment -> grounding -> relation-discovery -> committing";
    case "reading-summary":
      return "reading-graph -> summarizing -> committing";
    case "reading-graph":
      return "extracting -> committing";
    default:
      return step;
  }
}

function formatProgressCounter(
  counter: BuildJobProgressCounter,
): ProgressCounter {
  return {
    done: counter.done,
    name: counter.name,
    total: counter.total,
    unit: formatProgressUnit(counter.unit),
  };
}

function formatProgressUnit(unit: string): string {
  switch (unit) {
    case "candidate":
      return "candidates";
    case "char":
      return "chars";
    case "item":
      return "items";
    case "page":
      return "pages";
    case "qid":
      return "qids";
    case "record":
      return "records";
    case "sentence":
      return "sentences";
    case "word":
      return "words";
    case "window":
      return "windows";
    default:
      return unit;
  }
}

function formatProgressTokenMetrics(
  tokens: Extract<
    BuildJobEvent,
    { readonly type: "status_snapshot" }
  >["tokens"],
): ProgressMetricGroup | undefined {
  if (tokens === undefined) {
    return undefined;
  }

  const metrics = [
    ...(tokens.inputTokens === undefined
      ? []
      : [{ name: "input", value: tokens.inputTokens }]),
    ...(tokens.cacheReadTokens === undefined
      ? []
      : [{ name: "cache", value: tokens.cacheReadTokens }]),
    ...(tokens.outputTokens === undefined
      ? []
      : [{ name: "output", value: tokens.outputTokens }]),
  ];

  return metrics.length === 0 ? undefined : { metrics, name: "tokens" };
}

async function writeJobList(
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

async function writeJobStatus(
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

async function writeJobSummary(
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

async function writeArchiveAddSummary(input: {
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

function createQueueAddEstimate(input: {
  readonly chapters: readonly Pick<ChapterEntry, "stage" | "words">[];
  readonly config: CLIConfig;
  readonly target: BuildJobTarget;
}): QueueAddEstimate {
  const concurrent = {
    job: input.config.concurrent?.job ?? DEFAULT_GENERATION_JOB_CONCURRENCY,
    request:
      input.config.concurrent?.request ??
      DEFAULT_GENERATION_REQUEST_CONCURRENCY,
  };
  const words = input.chapters.reduce(
    (total, chapter) => total + chapter.words,
    0,
  );
  const model = formatGenerationPlanningModel(input.config.llm);
  const steps = createQueueAddEstimateSteps({
    chapters: input.chapters,
    concurrent,
    model,
    target: input.target,
  });
  const workChapters = Math.max(0, ...steps.map((step) => step.chapters));

  return {
    chapters: input.chapters.length,
    concurrent,
    includesPrerequisites: steps.some((step) => step.prerequisite),
    performanceHints: createGenerationPerformanceHints({
      chapters: workChapters,
      concurrent,
      hasGenerationWork: steps.length > 0,
    }),
    planning: sumGenerationPlanningCosts(model, steps),
    steps,
    target: input.target,
    words,
  };
}

function createQueueAddEstimateSteps(input: {
  readonly chapters: readonly Pick<ChapterEntry, "stage" | "words">[];
  readonly concurrent: GenerationConcurrency;
  readonly model: string;
  readonly target: BuildJobTarget;
}): readonly QueueAddEstimateStep[] {
  switch (input.target) {
    case "knowledge-graph":
      return [
        createQueueAddEstimateStep({
          chapters: input.chapters,
          concurrent: input.concurrent,
          model: input.model,
          prerequisite: false,
          task: "knowledge-graph",
        }),
      ].filter((step) => step.chapters > 0);
    case "reading-graph":
      return [
        createQueueAddEstimateStep({
          chapters: input.chapters.filter(
            (chapter) => chapter.stage === "sourced",
          ),
          concurrent: input.concurrent,
          model: input.model,
          prerequisite: false,
          task: "reading-graph",
        }),
      ].filter((step) => step.chapters > 0);
    case "reading-summary": {
      const graphChapters = input.chapters.filter(
        (chapter) => chapter.stage === "sourced",
      );
      const summaryChapters = input.chapters.filter(
        (chapter) => chapter.stage === "sourced" || chapter.stage === "graphed",
      );

      return [
        createQueueAddEstimateStep({
          chapters: graphChapters,
          concurrent: input.concurrent,
          model: input.model,
          prerequisite: true,
          task: "reading-graph",
        }),
        createQueueAddEstimateStep({
          chapters: summaryChapters,
          concurrent: input.concurrent,
          model: input.model,
          prerequisite: false,
          task: "reading-summary",
        }),
      ].filter((step) => step.chapters > 0);
    }
  }
}

function createQueueAddEstimateStep(input: {
  readonly chapters: readonly Pick<ChapterEntry, "words">[];
  readonly concurrent: GenerationConcurrency;
  readonly model: string;
  readonly prerequisite: boolean;
  readonly task: BuildJobTarget;
}): QueueAddEstimateStep {
  const words = input.chapters.reduce(
    (total, chapter) => total + chapter.words,
    0,
  );

  return {
    chapters: input.chapters.length,
    planning: planGenerationTask(
      input.task,
      words,
      input.chapters.length,
      input.concurrent,
      input.model,
    ),
    prerequisite: input.prerequisite,
    task: input.task,
    words,
  };
}

function sumGenerationPlanningCosts(
  model: string,
  steps: readonly QueueAddEstimateStep[],
): GenerationPlanningCost {
  return {
    model,
    timeSeconds: {
      max: steps.reduce(
        (total, step) => total + step.planning.timeSeconds.max,
        0,
      ),
      min: steps.reduce(
        (total, step) => total + step.planning.timeSeconds.min,
        0,
      ),
    },
    tokens: {
      cacheableInput: steps.reduce(
        (total, step) => total + step.planning.tokens.cacheableInput,
        0,
      ),
      input: steps.reduce(
        (total, step) => total + step.planning.tokens.input,
        0,
      ),
      output: steps.reduce(
        (total, step) => total + step.planning.tokens.output,
        0,
      ),
    },
  };
}

function formatQueueAddEstimateJSON(estimate: QueueAddEstimate): unknown {
  return {
    chapters: estimate.chapters,
    concurrent: estimate.concurrent,
    includesPrerequisites: estimate.includesPrerequisites,
    performanceHints: estimate.performanceHints,
    steps: estimate.steps.map((step) => ({
      chapters: step.chapters,
      prerequisite: step.prerequisite,
      task: step.task,
      tokens: step.planning.tokens,
      waitSeconds: step.planning.timeSeconds,
      words: step.words,
    })),
    target: estimate.target,
    tokens: estimate.planning.tokens,
    waitSeconds: estimate.planning.timeSeconds,
    words: estimate.words,
    model: estimate.planning.model,
  };
}

function formatQueueAddEstimateLines(
  estimate: QueueAddEstimate,
): readonly string[] {
  return [
    "Estimate:",
    `  Work: ${estimate.target} over ${estimate.chapters} chapter${estimate.chapters === 1 ? "" : "s"} / ${estimate.words} words`,
    ...(estimate.includesPrerequisites
      ? ["  Includes prerequisite Reading Graph work where missing."]
      : []),
    `  Model: ${estimate.planning.model}`,
    `  Tokens: ${estimate.planning.tokens.input} input / ${estimate.planning.tokens.cacheableInput} cacheable input / ${estimate.planning.tokens.output} output`,
    `  Wait: ${formatGenerationPlanningDuration(estimate.planning.timeSeconds.min)}-${formatGenerationPlanningDuration(estimate.planning.timeSeconds.max)}`,
    `  Current concurrency: job=${estimate.concurrent.job} request=${estimate.concurrent.request}`,
    ...formatQueuePerformanceHintLines(estimate.performanceHints),
  ];
}

function formatQueuePerformanceHintLines(
  hints: readonly GenerationPerformanceHint[],
): readonly string[] {
  if (hints.length === 0) {
    return [];
  }

  return [
    "Performance hints:",
    ...hints.flatMap((hint) => [
      `  ${hint.message}`,
      `  Command: ${hint.command}`,
    ]),
  ];
}

function tryStartQueueWorker(): void {
  if (process.env.WIKIGRAPH_QUEUE_DISABLE_AUTOSTART === "1") {
    return;
  }

  const entryPath = fileURLToPath(
    new URL("../queue-worker.js", import.meta.url),
  );

  const child = spawn(process.execPath, [entryPath], {
    detached: true,
    env: {
      ...process.env,
      WIKIGRAPH_INTERNAL_WORKER: "queue-v1",
    },
    stdio: "ignore",
  });

  child.unref();
}

function formatArchiveName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

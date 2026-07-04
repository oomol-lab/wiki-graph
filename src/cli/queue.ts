import { spawn } from "child_process";

import { SpineDigestScope } from "../common/llm-scope.js";
import { withLoggingContext } from "../common/logging.js";
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
  generateChapterKnowledgeGraphArtifact,
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
  snapshotChapterSummaryInput,
  updateBuildJobTarget,
  type BuildJob,
  type BuildJobEvent,
  type BuildJobExecutionContext,
  type BuildJobProgressCounter,
  type BuildJobProgressReporter,
  type BuildJobState,
} from "../facade/index.js";
import { SpineDigestFile } from "../wikg/index.js";
import type {
  GuaranteedRequest,
  GuaranteedRequestController,
} from "../guaranteed/index.js";
import type { LLMessage } from "../llm/index.js";

import type { CLIQueueArguments } from "./args.js";
import { loadCLIConfig } from "./config.js";
import { writeTextToStdout } from "./io.js";
import { formatCLIJSON } from "./json.js";
import {
  ProgressOutputWriter,
  type ProgressCounter,
  type ProgressTokens,
} from "./progress-output.js";
import {
  createStageLLM,
  loadRequiredStageConfig,
  resolveExtractionPrompt,
  resolveKnowledgeGraphRecallPrompt,
} from "./stage-runtime.js";

const TERMINAL_STATES = new Set<BuildJobState>([
  "succeeded",
  "failed",
  "canceled",
]);
const DEFAULT_QUEUE_CONCURRENCY = 3;
const PROGRESS_OUTPUT_INTERVAL_MS = 6_000;

export async function runQueueCommand(args: CLIQueueArguments): Promise<void> {
  switch (args.action) {
    case "add": {
      if (args.chapterId !== undefined) {
        await assertQueueAddReady(args);
      }
      assertBuildCostAccepted(args);
      await loadRequiredStageConfig({
        ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      });

      if (args.chapterId === undefined) {
        await addArchiveJobs(args);
      } else {
        await writeJobSummary(await addChapterJob(args, args.chapterId));
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
    case "worker":
      await runQueueWorker();
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

async function addArchiveJobs(args: CLIQueueArguments): Promise<void> {
  const created: BuildJob[] = [];
  const skipped: Array<{
    readonly chapterId: number;
    readonly reason: string;
  }> = [];

  await new SpineDigestFile(args.archivePath!).readDocument(
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
          created.push(await addChapterJob(args, chapter.chapterId));
        } catch (error) {
          skipped.push({
            chapterId: chapter.chapterId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );

  await writeArchiveAddSummary({ created, skipped });
}

async function assertQueueAddReady(args: CLIQueueArguments): Promise<void> {
  await new SpineDigestFile(args.archivePath!).read(async (digest) => {
    if ((await digest.readChapterStage(args.chapterId!)) === "planned") {
      throw new Error(
        `Chapter ${args.chapterId!} is planned. Set source before queueing a build job.`,
      );
    }
  });
}

function assertBuildCostAccepted(args: CLIQueueArguments): void {
  if (args.acceptCost === true) {
    return;
  }

  throw new Error(
    "Generation tasks can call an LLM, consume tokens, incur provider charges, and run for minutes to hours on large archives. Run `wikigraph <archive-uri> estimate --stage reading-summary`, then rerun `wikigraph wikg://local/job add` with --accept-cost if the cost and wait time are acceptable.",
  );
}

async function runQueueWorker(): Promise<void> {
  const config = await loadCLIConfig();

  await runBuildJobWorker({
    concurrency: config.concurrent?.job ?? DEFAULT_QUEUE_CONCURRENCY,
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
      scope: SpineDigestScope.ReaderExtraction,
      signal: context.signal,
    });
  request.lazy = async <T>(
    operation: (request: GuaranteedRequest) => Promise<T>,
  ): Promise<T> => await llm.request(async () => await operation(request));

  const buildInput = await new SpineDigestFile(job.archivePath).readDocument(
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
    await reporter.stepStarted("knowledge-graph");
    const artifact = await new SpineDigestFile(job.archivePath).readDocument(
      async (document) =>
        await generateChapterKnowledgeGraphArtifact(document, job.chapterId, {
          policyPrompt: knowledgeGraphRecallPrompt,
          progressTracker: reporter,
          request,
          workspacePath: job.workspacePath,
        }),
    );

    await reporter.updatePhase({
      done: 0,
      phase: "committing",
      total: 1,
      unit: "item",
    });
    await new SpineDigestFile(job.archivePath).write(async (document) => {
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
    details = await new SpineDigestFile(job.archivePath).write(
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
    const nextBuildInput = await new SpineDigestFile(
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
    ({ details } = await new SpineDigestFile(job.archivePath).readDocument(
      async (document) => await readChapterBuildInput(document, job.chapterId),
    ));
  }
  if (details.stage !== "graphed") {
    throw new Error(
      `Chapter ${job.chapterId} is ${details.stage}. Cannot generate summary.`,
    );
  }

  await reporter.stepStarted("reading-summary");
  const summaryInput = await new SpineDigestFile(job.archivePath).readDocument(
    async (document) => {
      await assertCurrentBuildInputRevision(job, document);
      return await snapshotChapterSummaryInput(
        document,
        job.chapterId,
        job.workspacePath,
      );
    },
  );
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
  details = await new SpineDigestFile(job.archivePath).write(
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
      const tokens = formatProgressTokens(event.tokens);
      return {
        counters: event.counters.map(formatProgressCounter),
        json: event,
        kind: "status" as const,
        phase: event.phase ?? event.step ?? "status",
        ...(tokens === undefined ? {} : { tokens }),
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

function formatProgressTokens(
  tokens: Extract<
    BuildJobEvent,
    { readonly type: "status_snapshot" }
  >["tokens"],
): ProgressTokens | undefined {
  if (tokens === undefined) {
    return undefined;
  }

  return {
    ...(tokens.cacheReadTokens === undefined
      ? {}
      : { cache: tokens.cacheReadTokens }),
    ...(tokens.inputTokens === undefined ? {} : { input: tokens.inputTokens }),
    ...(tokens.outputTokens === undefined
      ? {}
      : { output: tokens.outputTokens }),
  };
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

function formatJobJSON(job: BuildJob): unknown {
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
    ...(job.llmJSON === undefined ? {} : { llmJSON: job.llmJSON }),
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

async function writeJobSummary(job: BuildJob): Promise<void> {
  await writeTextToStdout(
    `Job ${job.jobId} ${job.state} ${job.target} chapter ${job.chapterId} ${job.archivePath}\n`,
  );
}

async function writeArchiveAddSummary(input: {
  readonly created: readonly BuildJob[];
  readonly skipped: readonly {
    readonly chapterId: number;
    readonly reason: string;
  }[];
}): Promise<void> {
  const lines = [
    `Created: ${input.created.length}`,
    `Skipped: ${input.skipped.length}`,
  ];

  for (const job of input.created) {
    lines.push(
      `Job ${job.jobId} ${job.state} ${job.target} chapter ${job.chapterId}`,
    );
  }
  for (const skipped of input.skipped) {
    lines.push(`Skipped chapter ${skipped.chapterId}: ${skipped.reason}`);
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function tryStartQueueWorker(): void {
  if (process.env.WIKIGRAPH_QUEUE_DISABLE_AUTOSTART === "1") {
    return;
  }

  const entryPath = process.argv[1];

  if (entryPath === undefined) {
    return;
  }

  const child = spawn(process.execPath, [entryPath, "__queue-worker"], {
    detached: true,
    env: process.env,
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

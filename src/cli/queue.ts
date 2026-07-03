import { spawn } from "child_process";

import { SpineDigestScope } from "../common/llm-scope.js";
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
import { formatCLIJSON, formatCLIJSONLine } from "./json.js";
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

export async function runQueueCommand(args: CLIQueueArguments): Promise<void> {
  switch (args.action) {
    case "add": {
      await assertQueueAddReady(args);
      assertBuildCostAccepted(args);
      await loadRequiredStageConfig({
        ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      });

      const job = await addBuildJob({
        archivePath: args.archivePath!,
        boost: args.boost ?? false,
        chapterId: args.chapterId!,
        ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
        ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
        target: args.target ?? "reading-summary",
      });

      await writeJobSummary(job);
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
    "Queue generation tasks can call an LLM, consume tokens, incur provider charges, and run for minutes to hours on large archives. Run `wikigraph <archive-uri> estimate --stage reading-summary`, then rerun `queue add` with --accept-cost if the cost and wait time are acceptable.",
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
  const config = await loadRequiredStageConfig({
    ...(job.llmJSON === undefined ? {} : { llmJSON: job.llmJSON }),
  });
  const llm = createStageLLM(config, {
    onStreamProgress: async (event) => {
      await reporter.addOutputCharacters(event.outputCharacters);
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

    await new SpineDigestFile(job.archivePath).write(async (document) => {
      assertJobStillRunning(await getBuildJob(job.jobId));
      await assertCurrentBuildInputRevision(job, document);
      await commitChapterKnowledgeGraphArtifact(document, artifact);
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
    details = await new SpineDigestFile(job.archivePath).write(
      async (document) => {
        assertJobStillRunning(await getBuildJob(job.jobId));
        await assertCurrentBuildInputRevision(job, document);
        return await commitChapterGraphArtifact(document, artifact);
      },
    );
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
      await writeWatchEvent(event, options.jsonl);
    }

    if (TERMINAL_STATES.has(job.state)) {
      return;
    }

    await delay(1_000);
  }
}

async function writeWatchEvent(
  event: BuildJobEvent,
  jsonl: boolean,
): Promise<void> {
  if (jsonl) {
    await writeTextToStdout(formatCLIJSONLine(formatWatchEventJSONL(event)));
    return;
  }

  switch (event.type) {
    case "progress_snapshot":
      await writeTextToStdout(`${formatProgressSnapshot(event)}\n`);
      return;
    case "target_changed":
      await writeTextToStdout(`target ${event.from} -> ${event.to}\n`);
      return;
    case "step_started":
    case "step_completed":
      await writeTextToStdout(`${event.type} ${event.step}\n`);
      return;
    default:
      await writeTextToStdout(`${event.type}\n`);
  }
}

function formatWatchEventJSONL(event: BuildJobEvent): unknown {
  if (event.type !== "progress_snapshot") {
    return event;
  }

  const progress = getProgressWords(event);

  return {
    at: event.at,
    jobId: event.jobId,
    outputTokens: event.outputTokens,
    ...(event.phase === undefined
      ? {}
      : {
          phase: event.phase,
          ...(event.phaseDetail === undefined
            ? {}
            : { phaseDetail: event.phaseDetail }),
          phaseDone: event.phaseDone ?? 0,
          phaseTotal: event.phaseTotal ?? 0,
          phaseUnit: event.phaseUnit,
        }),
    seq: event.seq,
    ...(event.step === undefined ? {} : { step: event.step }),
    totalWords: progress.totalWords,
    type: event.type,
    words: clampWords(progress.words, progress.totalWords),
  };
}

function formatProgressSnapshot(
  event: Extract<BuildJobEvent, { readonly type: "progress_snapshot" }>,
): string {
  const step = event.step ?? "-";
  const output = `output ~${event.outputTokens} tokens`;

  switch (event.step) {
    case "reading-graph":
      return `progress reading-graph ${formatWords(getProgressWords(event))} ${output}`;
    case "knowledge-graph":
      return `progress knowledge-graph${formatPhaseProgress(event)} ${output}`;
    case "reading-summary":
      return `progress reading-summary ${formatWords(getProgressWords(event))} ${output}`;
    case undefined:
      return `progress ${step} ${output}`;
  }

  return `progress ${step} ${output}`;
}

function formatPhaseProgress(
  event: Extract<BuildJobEvent, { readonly type: "progress_snapshot" }>,
): string {
  if (event.phase === undefined) {
    return "";
  }

  return ` ${event.phase}${event.phaseDetail === undefined ? "" : ` ${event.phaseDetail}`} ${event.phaseDone ?? 0}/${event.phaseTotal ?? 0} ${formatProgressUnit(event.phaseUnit)}`;
}

function formatProgressUnit(unit: string | undefined): string {
  switch (unit) {
    case "candidate":
      return "candidates";
    case "page":
      return "pages";
    case "qid":
      return "qids";
    case "record":
      return "records";
    case "sentence":
      return "sentences";
    case "window":
      return "windows";
    case undefined:
      return "items";
    default:
      return unit;
  }
}

function getProgressWords(
  event: Extract<BuildJobEvent, { readonly type: "progress_snapshot" }>,
): { readonly totalWords: number; readonly words: number } {
  const legacyEvent = event as Extract<
    BuildJobEvent,
    { readonly type: "progress_snapshot" }
  > & {
    readonly totalWords?: number;
    readonly words?: number;
  };

  if (
    typeof legacyEvent.words === "number" &&
    typeof legacyEvent.totalWords === "number"
  ) {
    return {
      totalWords: legacyEvent.totalWords,
      words: legacyEvent.words,
    };
  }

  switch (event.step) {
    case "reading-graph":
      return {
        totalWords: event.totalGraphWords,
        words: event.graphWords,
      };
    case "knowledge-graph":
      return {
        totalWords: event.totalGraphWords,
        words: event.graphWords,
      };
    case "reading-summary":
      return {
        totalWords: event.totalReadingSummaryWords,
        words: event.readingSummaryWords,
      };
    case undefined:
      return {
        totalWords: 0,
        words: 0,
      };
  }

  return {
    totalWords: 0,
    words: 0,
  };
}

function formatWords(input: {
  readonly totalWords: number;
  readonly words: number;
}): string {
  return `${clampWords(input.words, input.totalWords)}/${input.totalWords}`;
}

function clampWords(words: number, totalWords: number): number {
  if (totalWords <= 0) {
    return Math.max(0, words);
  }

  return Math.min(totalWords, Math.max(0, words));
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
      ...(job.errorJSON === undefined ? [] : [`Error: ${job.errorJSON}`]),
    ].join("\n") + "\n",
  );
}

function formatJobJSON(job: BuildJob): unknown {
  return {
    archiveKey: job.archiveKey,
    archivePath: job.archivePath,
    chapterId: job.chapterId,
    createdAt: job.createdAt,
    ...(job.currentStep === undefined ? {} : { currentStep: job.currentStep }),
    ...(job.errorJSON === undefined ? {} : { errorJSON: job.errorJSON }),
    eventsPath: job.eventsPath,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    jobId: job.jobId,
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

function tryStartQueueWorker(): void {
  if (process.env.WIKIGRAPH_QUEUE_DISABLE_AUTOSTART === "1") {
    return;
  }

  const entryPath = process.argv[1];

  if (entryPath === undefined) {
    return;
  }

  const child = spawn(process.execPath, [entryPath, "queue", "worker"], {
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

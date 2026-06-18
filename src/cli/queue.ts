import { spawn } from "child_process";

import {
  addBuildJob,
  assertNoActiveBuildJobs,
  boostBuildJob,
  cancelBuildJob,
  cleanBuildJobs,
  generateChapterGraph,
  generateChapterSummary,
  getBuildJob,
  getChapterDetails,
  listBuildJobs,
  pauseBuildJob,
  readBuildJobEvents,
  resumeBuildJob,
  resolveBuildJobId,
  runBuildJobWorker,
  updateBuildJobTarget,
  type BuildJob,
  type BuildJobEvent,
  type BuildJobProgressReporter,
  type BuildJobState,
} from "../facade/index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";

import type { CLIQueueArguments } from "./args.js";
import { loadCLIConfig } from "./config.js";
import { writeTextToStdout } from "./io.js";
import {
  createStageLLM,
  loadRequiredStageConfig,
  resolveExtractionPrompt,
} from "./stage-runtime.js";

const TERMINAL_STATES = new Set<BuildJobState>([
  "succeeded",
  "failed",
  "canceled",
]);

export async function runQueueCommand(args: CLIQueueArguments): Promise<void> {
  switch (args.action) {
    case "add": {
      await assertQueueAddReady(args);
      assertBuildCostAccepted(args);

      const job = await addBuildJob({
        archivePath: args.archivePath!,
        boost: args.boost ?? false,
        chapterId: args.chapterId!,
        ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
        ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
        target: args.target ?? "summary",
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
      );
      return;
    case "status":
      await writeJobStatus(await getBuildJob(await resolveQueueJobId(args)));
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
          args.target ?? "summary",
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
  await new SpineDigestFile(args.archivePath!).openSession(async (digest) => {
    if ((await digest.readChapterStage(args.chapterId!)) === "planned") {
      throw new Error(
        `Chapter ${args.chapterId!} is planned. Set source before queueing a build job.`,
      );
    }
  });
  await assertNoActiveBuildJobs({
    archivePath: args.archivePath!,
    chapterIds: [args.chapterId!],
    operation: "Queueing build job",
  });
}

function assertBuildCostAccepted(args: CLIQueueArguments): void {
  if (args.acceptCost === true) {
    return;
  }

  throw new Error(
    "Queue graph and summary jobs can call an LLM, consume tokens, incur provider charges, and run for minutes to hours on large archives. Run `spinedigest estimate <archive.sdpub> --stage summary`, then rerun `queue add` with --accept-cost if the cost and wait time are acceptable.",
  );
}

async function runQueueWorker(): Promise<void> {
  const config = await loadCLIConfig();

  await runBuildJobWorker({
    concurrency: config.request?.concurrent ?? 1,
    executeJob: async (job, reporter) => {
      await executeBuildJob(job, reporter);
    },
  });
}

async function executeBuildJob(
  job: BuildJob,
  reporter: BuildJobProgressReporter,
): Promise<void> {
  const config = await loadRequiredStageConfig({
    ...(job.llmJSON === undefined ? {} : { llmJSON: job.llmJSON }),
  });
  const llm = createStageLLM(config, {
    onStreamProgress: async (event) => {
      await reporter.addOutputCharacters(event.outputCharacters);
    },
  });
  const prompt = resolveExtractionPrompt(job.prompt ?? config.prompt);

  await new SpineDigestFile(job.archivePath).openEditableSession(
    async (document) => {
      let details = await getChapterDetails(document, job.chapterId);

      await reporter.setTotals({
        totalGraphWords: details.stage === "sourced" ? details.words : 0,
        totalSummaryWords:
          details.stage === "sourced" || details.stage === "graphed"
            ? details.words
            : 0,
      });

      if (details.stage === "planned") {
        throw new Error(
          `Chapter ${job.chapterId} is planned. Set source before queueing a build job.`,
        );
      }
      if (details.stage === "sourced") {
        let graphWords = 0;

        await reporter.stepStarted("graph");
        details = await generateChapterGraph(document, job.chapterId, {
          extractionPrompt: prompt,
          llm,
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
        await reporter.updateWords({ graphWords: details.words });
        await reporter.stepCompleted("graph");
      }

      const latestJob = await getBuildJob(job.jobId);

      assertJobStillRunning(latestJob);
      if (latestJob.target === "graph" || details.stage === "summarized") {
        return;
      }
      if (details.stage !== "graphed") {
        details = await getChapterDetails(document, job.chapterId);
      }
      if (details.stage !== "graphed") {
        throw new Error(
          `Chapter ${job.chapterId} is ${details.stage}. Cannot generate summary.`,
        );
      }

      await reporter.stepStarted("summary");
      details = await generateChapterSummary(document, job.chapterId, {
        llm,
      });
      await reporter.updateWords({ summaryWords: details.words });
      await reporter.stepCompleted("summary");
      assertJobStillRunning(await getBuildJob(job.jobId));
    },
  );
}

function assertJobStillRunning(job: BuildJob): void {
  if (job.state !== "running") {
    throw new Error(`Job ${job.jobId} is ${job.state}. Stop before flushing.`);
  }
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
    await writeTextToStdout(
      `${JSON.stringify(formatWatchEventJSONL(event))}\n`,
    );
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
    case "graph":
      return `progress graph ${formatWords(getProgressWords(event))} ${output}`;
    case "summary":
      return `progress summary ${formatWords(getProgressWords(event))} ${output}`;
    case undefined:
      return `progress ${step} ${output}`;
  }

  return `progress ${step} ${output}`;
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
    case "graph":
      return {
        totalWords: event.totalGraphWords,
        words: event.graphWords,
      };
    case "summary":
      return {
        totalWords: event.totalSummaryWords,
        words: event.summaryWords,
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

async function writeJobList(jobs: readonly BuildJob[]): Promise<void> {
  if (jobs.length === 0) {
    await writeTextToStdout("No jobs.\n");
    return;
  }

  await writeTextToStdout(
    `${jobs
      .map(
        (job) =>
          `${job.jobId.slice(0, 8)} ${job.state.padEnd(9)} ${(job.currentStep ?? "-").padEnd(7)} ${job.target.padEnd(7)} ${job.chapterId.toString().padStart(5)} ${formatArchiveName(job.archivePath)}`,
      )
      .join("\n")}\n`,
  );
}

async function writeJobStatus(job: BuildJob): Promise<void> {
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

async function writeJobSummary(job: BuildJob): Promise<void> {
  await writeTextToStdout(
    `Job ${job.jobId} ${job.state} ${job.target} chapter ${job.chapterId} ${job.archivePath}\n`,
  );
}

function tryStartQueueWorker(): void {
  if (process.env.SPINEDIGEST_QUEUE_DISABLE_AUTOSTART === "1") {
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

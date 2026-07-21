import { WikiGraphScope } from "wiki-graph-core";
import { withLoggingContext } from "wiki-graph-core";
import {
  assertBuildJobInputRevision,
  buildChapterGraphArtifact,
  buildChapterSummaryArtifactFromSnapshot,
  commitChapterGraphArtifact,
  commitChapterKnowledgeGraphArtifact,
  commitChapterSummaryArtifact,
  generateChapterKnowledgeGraphArtifactFromSnapshot,
  getBuildJob,
  readChapterBuildInput,
  recordBuildJobInputRevision,
  runBuildJobWorker,
  snapshotChapterKnowledgeGraphInput,
  snapshotChapterSummaryInput,
  type BuildJob,
  type BuildJobExecutionContext,
  type BuildJobProgressReporter,
} from "wiki-graph-core";
import { WikiGraphArchiveFile } from "wiki-graph-core";
import type {
  GuaranteedRequest,
  GuaranteedRequestController,
} from "wiki-graph-core";
import type { LLMessage } from "wiki-graph-core";

import { loadCLIConfig, type CLIConfig } from "../../config.js";
import {
  createStageLLM,
  DEFAULT_GENERATION_JOB_CONCURRENCY,
  loadRequiredStageConfig,
  resolveExtractionPrompt,
  resolveKnowledgeGraphRecallPrompt,
} from "../../runtime/index.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../../support/index.js";

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

export function requireKnowledgeGraphWikispineConfig(
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

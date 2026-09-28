import {
  getBuildJob,
  getChapterDetails,
  openWikimediaResolver,
  recordBuildJobInputRevision,
  runBuildJobWorker,
  WikiGraphArchiveFile,
  WikiGraphScope,
  withLoggingContext,
  type BuildJob,
  type BuildJobExecutionContext,
  type BuildJobProgressReporter,
  type Directory,
  type GuaranteedRequest,
  type GuaranteedRequestController,
  type LLMessage,
} from "wiki-graph-core";
import {
  applyChapterJobArtifactFile,
  createLocalChapterJobFileExecutor,
  createRemoteChapterJobFileExecutor,
  writeChapterJobInputFile,
  type ChapterJobFileExecutor,
  type ChapterJobInputOptions,
  type ChapterJobKind,
} from "wiki-graph-core/worker";

import { buildSearchIndexEmbeddingProvider } from "../../runtime/embedding.js";
import { loadCLIConfig, type CLIConfig } from "../../runtime/config.js";
import {
  createStageLLM,
  DEFAULT_GENERATION_JOB_CONCURRENCY,
  loadRequiredStageConfig,
  resolveExtractionPrompt,
  resolveKnowledgeGraphRecallPrompt,
} from "../../runtime/index.js";
import { nodeWikispineCommandRunner } from "../../runtime/wikispine.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../../support/index.js";

export async function runQueueWorker(): Promise<void> {
  const config = await loadCLIConfig();
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runBuildJobWorker({
      concurrency: config.concurrent?.job ?? DEFAULT_GENERATION_JOB_CONCURRENCY,
      executeJob: async (job, reporter, context) => {
        await withLoggingContext(
          { logDirectory: job.log, operation: "build-job" },
          async () => await executeBuildJob(job, reporter, context),
        );
      },
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

async function executeBuildJob(
  job: BuildJob,
  reporter: BuildJobProgressReporter,
  context: BuildJobExecutionContext,
): Promise<void> {
  const config = await loadCLIConfig({
    ...(job.llmJSON === undefined ? {} : { llmJSON: job.llmJSON }),
  });
  const execution = await openJobExecutor(
    job,
    config,
    context.signal,
    reporter,
  );
  try {
    if (job.target === "reading-summary") {
      let stage = await readChapterStage(job);
      if (stage === "sourced") {
        await executeStep(job, "reading-graph", execution, reporter, context, {
          ...(execution.extractionPrompt === undefined
            ? {}
            : { extractionPrompt: execution.extractionPrompt }),
        });
        stage = await readChapterStage(job);
      }
      if (stage === "summarized") return;
      if (stage !== "graphed") {
        throw new Error(
          `Chapter ${job.chapterId} is ${stage}. Cannot generate summary.`,
        );
      }
      await executeStep(job, "reading-summary", execution, reporter, context, {
        ...(job.prompt === undefined ? {} : { prompt: job.prompt }),
      });
      return;
    }

    if (job.target === "reading-graph") {
      const stage = await readChapterStage(job);
      if (stage === "graphed" || stage === "summarized") return;
      if (stage !== "sourced") {
        throw new Error(
          `Chapter ${job.chapterId} is ${stage}. Cannot generate Reading Graph.`,
        );
      }
    }
    if (job.target === "knowledge-graph") {
      const stage = await readChapterStage(job);
      if (stage === "planned") {
        throw new Error(
          `Chapter ${job.chapterId} is planned. Set source before generating Knowledge Graph.`,
        );
      }
    }

    await executeStep(job, job.target, execution, reporter, context, {
      ...(job.target === "reading-graph"
        ? { extractionPrompt: execution.extractionPrompt }
        : {}),
      ...(job.target === "knowledge-graph"
        ? { policyPrompt: execution.knowledgeGraphPrompt }
        : {}),
    });
  } finally {
    await execution.close();
  }
}

async function executeStep(
  job: BuildJob,
  kind: ChapterJobKind,
  execution: OpenedExecutor,
  reporter: BuildJobProgressReporter,
  context: BuildJobExecutionContext,
  inputOptions: ChapterJobInputOptions,
): Promise<void> {
  await reporter.throwIfStopped();
  await reporter.stepStarted(kind);
  if (kind === "reading-graph" || kind === "knowledge-graph") {
    await assertCurrentFtsArtifact(job);
  }

  const stepWorkspace = await resetStepWorkspace(job.workspace, kind);
  const inputFile = await stepWorkspace.createFile("input.jsonl");
  const outputWorkspace = await stepWorkspace.createDirectory("output");
  const revision = await new WikiGraphArchiveFile(job.archive).readDocument(
    async (document) => {
      await getChapterDetails(document, job.chapterId);
      return await writeChapterJobInputFile(
        document,
        job.chapterId,
        kind,
        inputFile,
        inputOptions,
      );
    },
  );
  await recordBuildJobInputRevision({
    currentRevision: revision,
    jobId: job.jobId,
    ownerId: requireRunningJobOwnerId(job),
  });
  await reporter.updatePhase({
    done: 0,
    phase: kind.startsWith("index-") ? "indexing" : "grounding",
    total: 1,
    unit: "item",
  });

  const result = await execution.executor({
    inputFile,
    kind,
    progress: reporter,
    revision,
    signal: context.signal,
    workspace: outputWorkspace,
  });
  if (result.revision !== revision) {
    throw new Error(
      `Chapter job returned revision ${result.revision}; expected ${revision}.`,
    );
  }
  await reporter.updatePhase({
    done: 0,
    phase: "committing",
    total: 1,
    unit: "item",
  });
  await new WikiGraphArchiveFile(job.archive).write(async (document) => {
    assertJobStillRunning(await getBuildJob(job.jobId));
    await applyChapterJobArtifactFile(
      document,
      job.chapterId,
      kind,
      revision,
      result.artifactFile,
    );
  });
  await reporter.updatePhase({
    done: 1,
    phase: "committing",
    total: 1,
    unit: "item",
  });
  await reporter.stepCompleted(kind);
  assertJobStillRunning(await getBuildJob(job.jobId));
}

interface OpenedExecutor {
  readonly close: () => Promise<void>;
  readonly executor: ChapterJobFileExecutor;
  readonly extractionPrompt?: string;
  readonly knowledgeGraphPrompt?: string;
}

async function openJobExecutor(
  job: BuildJob,
  config: CLIConfig,
  signal: AbortSignal,
  reporter: BuildJobProgressReporter,
): Promise<OpenedExecutor> {
  if (config.job !== undefined) {
    return {
      async close() {},
      executor: createRemoteChapterJobFileExecutor({
        baseUrl: config.job.endpoint,
        ...(config.job.token === undefined ? {} : { token: config.job.token }),
      }),
      ...(job.prompt === undefined ? {} : { extractionPrompt: job.prompt }),
      ...(job.prompt === undefined ? {} : { knowledgeGraphPrompt: job.prompt }),
    };
  }

  const generation = !job.target.startsWith("index-");
  const stageConfig = generation
    ? await loadRequiredStageConfig({
        ...(job.llmJSON === undefined ? {} : { llmJSON: job.llmJSON }),
      })
    : undefined;
  const llm =
    stageConfig === undefined
      ? undefined
      : createStageLLM(stageConfig, {
          cacheDirectory: job.cache,
          logDirectory: job.log,
          onTokenUsage: async (usage) => {
            await reporter.addTokenUsage(usage);
          },
        });
  const promptSource = job.prompt ?? stageConfig?.prompt;
  const wikispine =
    job.target === "knowledge-graph"
      ? requireKnowledgeGraphWikispineConfig(config)
      : undefined;
  const request: GuaranteedRequestController | undefined =
    llm === undefined
      ? undefined
      : async (
          messages: readonly LLMessage[],
          index: number,
          maxRetries: number,
        ) =>
          await llm.request(messages, {
            retryIndex: index,
            retryMax: maxRetries,
            scope: WikiGraphScope.ReaderExtraction,
            signal,
          });
  if (request !== undefined && llm !== undefined) {
    request.lazy = async <T>(
      operation: (request: GuaranteedRequest) => Promise<T>,
    ): Promise<T> => await llm.request(async () => await operation(request));
  }
  const wikimediaResolver =
    job.target !== "knowledge-graph"
      ? undefined
      : await openWikimediaResolver(
          config.wikimedia === undefined
            ? {
                kind: "local",
                llmRequest: requireValue(
                  request,
                  "Local Wikimedia resolution requires an LLM.",
                ),
              }
            : {
                endpoint: config.wikimedia.endpoint,
                kind: "remote",
                ...(config.wikimedia.token === undefined
                  ? {}
                  : { token: config.wikimedia.token }),
              },
        );
  const embeddingProvider =
    job.target === "index-embedding-source" ||
    job.target === "index-embedding-summary"
      ? buildSearchIndexEmbeddingProvider(requireEmbeddingConfig(config))
      : undefined;

  return {
    async close() {
      await wikimediaResolver?.close();
    },
    executor: createLocalChapterJobFileExecutor({
      ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
      ...(llm === undefined ? {} : { llm }),
      ...(wikimediaResolver === undefined ? {} : { wikimediaResolver }),
      ...(wikispine === undefined
        ? {}
        : {
            wikispine: {
              ...wikispine,
              ...(wikispine.provider === "cli"
                ? { commandRunner: nodeWikispineCommandRunner }
                : {}),
            },
          }),
    }),
    ...(promptSource === undefined
      ? {}
      : { extractionPrompt: resolveExtractionPrompt(promptSource) }),
    ...(promptSource === undefined
      ? {}
      : {
          knowledgeGraphPrompt: resolveKnowledgeGraphRecallPrompt(promptSource),
        }),
  };
}

async function resetStepWorkspace(
  workspace: Directory,
  kind: ChapterJobKind,
): Promise<Directory> {
  const name = `chapter-job-${kind}`;
  if ((await workspace.getDirectory(name)) !== undefined) {
    await workspace.remove(name, { recursive: true });
  }
  return await workspace.createDirectory(name);
}

async function readChapterStage(job: BuildJob) {
  return await new WikiGraphArchiveFile(job.archive).readDocument(
    async (document) =>
      (await getChapterDetails(document, job.chapterId)).stage,
  );
}

async function assertCurrentFtsArtifact(job: BuildJob): Promise<void> {
  await new WikiGraphArchiveFile(job.archive).readDocument(async (document) => {
    const revision = await document.serials.getRevision(job.chapterId);
    const artifact = await document.indexArtifacts.get(job.chapterId, "fts");
    if (artifact?.sourceRevision !== revision) {
      throw new Error(
        `Chapter ${job.chapterId} needs a current FTS index artifact before running ${job.target}.`,
      );
    }
  });
}

function requireEmbeddingConfig(config: CLIConfig) {
  if (config.embedding !== undefined) return config.embedding;
  throw new Error(
    withHelpRoute(
      "Missing embeddings configuration. Configure `wikg://local/config/embeddings` before building embedding index artifacts.",
      CLI_HELP_ROUTES.config,
    ),
  );
}

export function requireKnowledgeGraphWikispineConfig(
  config: CLIConfig,
): NonNullable<CLIConfig["wikispine"]> {
  if (config.wikispine?.provider !== undefined) return config.wikispine;
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

function requireRunningJobOwnerId(job: BuildJob): string {
  if (job.ownerId === undefined) {
    throw new Error(`Build job ${job.jobId} has no running owner.`);
  }
  return job.ownerId;
}

function assertJobStillRunning(job: BuildJob): void {
  if (job.state !== "running") {
    throw new Error(`Job ${job.jobId} is ${job.state}. Stop before flushing.`);
  }
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

import { WikiGraphScope } from "wiki-graph-core";
import { HttpWikimediaResolver } from "wiki-graph-wikimedia";
import { withLoggingContext } from "wiki-graph-core";
import {
  assertBuildJobInputRevision,
  buildChapterGraphArtifact,
  buildChapterSummaryArtifactFromSnapshot,
  commitChapterGraphArtifact,
  commitChapterKnowledgeGraphArtifact,
  commitChapterSummaryArtifact,
  createEmbeddingIndexArtifactInput,
  createFtsIndexArtifactInput,
  generateChapterKnowledgeGraphArtifactFromSnapshot,
  getBuildJob,
  readIndexArtifactOutput,
  readChapterBuildInput,
  recordBuildJobInputRevision,
  runBuildJobWorker,
  snapshotChapterKnowledgeGraphInput,
  snapshotChapterSummaryInput,
  type BuildJob,
  type BuildJobExecutionContext,
  type BuildJobProgressReporter,
  type IndexArtifactOutput,
  type File,
  type SentenceRecord,
  writeIndexArtifactOutput,
  ensureRelativeFile,
} from "wiki-graph-core";
import { WikiGraphArchiveFile } from "wiki-graph-core";
import type {
  GuaranteedRequest,
  GuaranteedRequestController,
  ReadonlyDocument,
} from "wiki-graph-core";
import type { LLMessage } from "wiki-graph-core";

import { loadCLIConfig, type CLIConfig } from "../../runtime/config.js";
import {
  createStageLLM,
  DEFAULT_GENERATION_JOB_CONCURRENCY,
  loadRequiredStageConfig,
  resolveExtractionPrompt,
  resolveKnowledgeGraphRecallPrompt,
} from "../../runtime/index.js";
import { buildSearchIndexEmbeddingProvider } from "../../runtime/embedding.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../../support/index.js";
import { nodeWikispineCommandRunner } from "../../runtime/wikispine.js";

interface IndexArtifactJobChunkSnapshot {
  readonly content: string;
  readonly id: number;
  readonly label: string;
  readonly wordsCount: number;
}

interface IndexArtifactJobMentionSnapshot {
  readonly id: string;
  readonly qid: string;
  readonly surface: string;
}

interface IndexArtifactJobTocItemSnapshot {
  readonly children: readonly IndexArtifactJobTocItemSnapshot[];
  readonly serialId?: number | undefined;
  readonly title?: string | null | undefined;
}

interface IndexArtifactJobSnapshot {
  readonly chapterTitles: readonly {
    readonly id: number;
    readonly title: string;
  }[];
  readonly chunks: readonly IndexArtifactJobChunkSnapshot[];
  readonly mentions: readonly IndexArtifactJobMentionSnapshot[];
  readonly revision: number;
  readonly sentences: readonly SentenceRecord[];
  readonly summarySentences: readonly SentenceRecord[];
}

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
        await executeBuildJob(job, reporter, context);
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
  await withLoggingContext(
    {
      logDirectory: job.log,
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
  if (isIndexArtifactBuildTarget(job.target)) {
    await executeIndexArtifactBuildJob(job, reporter, context);
    return;
  }

  await executeGenerationBuildJob(job, reporter, context);
}

async function executeGenerationBuildJob(
  job: BuildJob,
  reporter: BuildJobProgressReporter,
  context: BuildJobExecutionContext,
): Promise<void> {
  const config = await loadRequiredStageConfig({
    ...(job.llmJSON === undefined ? {} : { llmJSON: job.llmJSON }),
  });
  const llm = createStageLLM(config, {
    cacheDirectory: job.cache,
    logDirectory: job.log,
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

  const buildInput = await new WikiGraphArchiveFile(job.archive).readDocument(
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
  if (job.target === "knowledge-graph" || job.target === "reading-graph") {
    await new WikiGraphArchiveFile(job.archive).readDocument(
      async (document) => {
        const artifact = await document.indexArtifacts.get(
          job.chapterId,
          "fts",
        );
        if (artifact?.sourceRevision !== buildInput.revision) {
          throw new Error(
            `Chapter ${job.chapterId} needs a current FTS index artifact before running ${job.target}.`,
          );
        }
      },
    );
  }
  if (job.target === "knowledge-graph") {
    const wikispine = requireKnowledgeGraphWikispineConfig(config);
    const wikimedia = requireKnowledgeGraphWikimediaConfig(config);

    await reporter.stepStarted("knowledge-graph");
    const knowledgeGraphInput = await new WikiGraphArchiveFile(
      job.archive,
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
        wikimediaResolver: new HttpWikimediaResolver(
          wikimedia.endpoint,
          wikimedia.token,
        ),
        wikispine: {
          ...wikispine,
          ...(wikispine.provider === "cli"
            ? { commandRunner: nodeWikispineCommandRunner }
            : {}),
        },
        workspace: job.workspace,
      },
    );

    await reporter.updatePhase({
      done: 0,
      phase: "committing",
      total: 1,
      unit: "item",
    });
    await new WikiGraphArchiveFile(job.archive).write(async (document) => {
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
      workspace: job.workspace,
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
    details = await new WikiGraphArchiveFile(job.archive).write(
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
      job.archive,
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
    ({ details } = await new WikiGraphArchiveFile(job.archive).readDocument(
      async (document) => await readChapterBuildInput(document, job.chapterId),
    ));
  }
  if (details.stage !== "graphed") {
    throw new Error(
      `Chapter ${job.chapterId} is ${details.stage}. Cannot generate summary.`,
    );
  }

  await reporter.stepStarted("reading-summary");
  const summaryInput = await new WikiGraphArchiveFile(job.archive).readDocument(
    async (document) => {
      await assertCurrentBuildInputRevision(job, document);
      return await snapshotChapterSummaryInput(
        document,
        job.chapterId,
        job.workspace,
      );
    },
  );
  const summary = await buildChapterSummaryArtifactFromSnapshot(job.chapterId, {
    llm,
    snapshotFile: summaryInput.file,
    workspace: job.workspace,
  });
  await reporter.updatePhase({
    done: 0,
    phase: "committing",
    total: 1,
    unit: "item",
  });
  details = await new WikiGraphArchiveFile(job.archive).write(
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

async function executeIndexArtifactBuildJob(
  job: BuildJob,
  reporter: BuildJobProgressReporter,
  context: BuildJobExecutionContext,
): Promise<void> {
  await reporter.stepStarted(job.target);
  const snapshot = await readIndexArtifactJobSnapshot(job);
  await recordBuildJobInputRevision({
    currentRevision: snapshot.revision,
    jobId: job.jobId,
    ownerId: requireRunningJobOwnerId(job),
  });
  await reporter.updatePhase({
    done: 0,
    phase: "indexing",
    total: 1,
    unit: "item",
  });

  if (job.target === "index-fts") {
    const outputFile = await resolveIndexArtifactOutputFile(job);
    await writeIndexArtifactOutput(
      outputFile,
      createFtsIndexArtifactInput({
        chapterTitles: snapshot.chapterTitles,
        chunks: snapshot.chunks,
        mentions: snapshot.mentions,
        sentences: snapshot.sentences,
        serialId: job.chapterId,
        sourceRevision: snapshot.revision,
        summarySentences: snapshot.summarySentences,
      }),
    );
    const artifact = await readIndexArtifactOutput(outputFile);

    assertIndexArtifactOutputMatchesJob(job, snapshot.revision, artifact);
    if (!("lexicalRows" in artifact)) {
      throw new Error("Index artifact output is not an FTS artifact.");
    }
    await new WikiGraphArchiveFile(job.archive).write(async (document) => {
      assertJobStillRunning(await getBuildJob(job.jobId));
      await assertJobChapterExists(document, job.chapterId);
      await assertCurrentBuildInputRevision(job, document);
      await document.indexArtifacts.replaceFts(artifact);
    });
    await completeIndexArtifactStep(job, reporter);
    return;
  }

  const config = await loadCLIConfig();
  if (config.embedding === undefined) {
    throw new Error(
      withHelpRoute(
        "Missing embeddings configuration. Configure `wikg://local/config/embeddings` before building embedding index artifacts.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }
  const outputFile = await resolveIndexArtifactOutputFile(job);
  const artifact = await createEmbeddingIndexArtifactInput({
    embeddingProvider: buildSearchIndexEmbeddingProvider(config.embedding),
    kind:
      job.target === "index-embedding-source"
        ? "embedding-source"
        : "embedding-summary",
    sentences: snapshot.sentences,
    serialId: job.chapterId,
    signal: context.signal,
    sourceRevision: snapshot.revision,
  });
  await writeIndexArtifactOutput(outputFile, artifact);
  const output = await readIndexArtifactOutput(outputFile);

  assertIndexArtifactOutputMatchesJob(job, snapshot.revision, output);
  if ("lexicalRows" in output) {
    throw new Error("Index artifact output is not an embedding artifact.");
  }

  await new WikiGraphArchiveFile(job.archive).write(async (document) => {
    assertJobStillRunning(await getBuildJob(job.jobId));
    await assertJobChapterExists(document, job.chapterId);
    await assertCurrentBuildInputRevision(job, document);
    await document.indexArtifacts.replaceEmbedding(output);
  });
  await completeIndexArtifactStep(job, reporter);
}

async function completeIndexArtifactStep(
  job: BuildJob,
  reporter: BuildJobProgressReporter,
): Promise<void> {
  await reporter.updatePhase({
    done: 1,
    phase: "indexing",
    total: 1,
    unit: "item",
  });
  await reporter.stepCompleted(job.target);
  assertJobStillRunning(await getBuildJob(job.jobId));
}

async function readIndexArtifactJobSnapshot(
  job: BuildJob,
): Promise<IndexArtifactJobSnapshot> {
  return await new WikiGraphArchiveFile(job.archive).readDocument(
    async (document) => {
      await assertJobChapterExists(document, job.chapterId);
      const revision = await document.serials.getRevision(job.chapterId);
      const stream =
        job.target === "index-embedding-summary"
          ? document.getSummaryFragments(job.chapterId)
          : document.getSerialFragments(job.chapterId);
      if (job.target === "index-embedding-summary") {
        const summary = await document.readSummary(job.chapterId);
        if (summary === undefined || summary.trim() === "") {
          throw new Error(
            `Chapter ${job.chapterId} has no summary. Build a reading summary before building a summary embedding index artifact.`,
          );
        }
      }

      if (stream.listSentences === undefined) {
        throw new Error("Text stream does not expose sentence listing.");
      }

      const sentences = await stream.listSentences();
      if (job.target !== "index-fts") {
        return {
          chapterTitles: [],
          chunks: [],
          mentions: [],
          revision,
          sentences,
          summarySentences: [],
        };
      }

      return {
        chapterTitles: await readChapterTitles(document, job.chapterId),
        chunks: await document.chunks.listBySerial(job.chapterId),
        mentions: await document.mentions.listByChapter(job.chapterId),
        revision,
        sentences,
        summarySentences: await listTextStreamSentences(
          document.getSummaryFragments(job.chapterId),
        ),
      };
    },
  );
}

async function listTextStreamSentences(stream: {
  readonly listSentences?: () => Promise<readonly SentenceRecord[]>;
}): Promise<readonly SentenceRecord[]> {
  if (stream.listSentences === undefined) {
    throw new Error("Text stream does not expose sentence listing.");
  }

  return await stream.listSentences();
}

async function readChapterTitles(
  document: ReadonlyDocument,
  serialId: number,
): Promise<readonly { readonly id: number; readonly title: string }[]> {
  const reader = document as ReadonlyDocument & {
    readonly readToc?: () => Promise<
      { readonly items: readonly IndexArtifactJobTocItemSnapshot[] } | undefined
    >;
  };
  const toc = await reader.readToc?.();
  if (toc === undefined) {
    return [];
  }

  const chapter = collectTocItems(toc.items).find(
    (item) => item.serialId === serialId,
  );
  if (chapter === undefined || typeof chapter.title !== "string") {
    return [];
  }

  return [{ id: serialId, title: chapter.title }];
}

function collectTocItems(
  items: readonly IndexArtifactJobTocItemSnapshot[],
): readonly IndexArtifactJobTocItemSnapshot[] {
  return items.flatMap((item) => [item, ...collectTocItems(item.children)]);
}

async function resolveIndexArtifactOutputFile(job: BuildJob): Promise<File> {
  return await ensureRelativeFile(job.workspace, "index-artifact-output.jsonl");
}

function assertIndexArtifactOutputMatchesJob(
  job: BuildJob,
  inputRevision: number,
  artifact: IndexArtifactOutput,
): void {
  if (artifact.serialId !== job.chapterId) {
    throw new Error(
      `Index artifact output targets chapter ${artifact.serialId}, expected chapter ${job.chapterId}.`,
    );
  }
  if (artifact.sourceRevision !== inputRevision) {
    throw new Error(
      `Index artifact output targets input revision ${artifact.sourceRevision}, expected revision ${inputRevision}.`,
    );
  }

  if (job.target === "index-fts") {
    if ("lexicalRows" in artifact) {
      return;
    }

    throw new Error("Index artifact output is not an FTS artifact.");
  }
  if ("lexicalRows" in artifact) {
    throw new Error("Index artifact output is not an embedding artifact.");
  }

  const expectedKind =
    job.target === "index-embedding-source"
      ? "embedding-source"
      : "embedding-summary";

  if (artifact.kind === expectedKind) {
    return;
  }

  throw new Error(
    `Index artifact output kind ${artifact.kind} does not match ${job.target}.`,
  );
}

async function assertJobChapterExists(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<void> {
  if ((await document.serials.getById(chapterId)) !== undefined) {
    return;
  }

  throw new Error(
    `Chapter ${chapterId} no longer exists. Queue a new build job for an existing chapter.`,
  );
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

export function requireKnowledgeGraphWikimediaConfig(
  config: CLIConfig,
): NonNullable<CLIConfig["wikimedia"]> {
  if (config.wikimedia !== undefined) {
    return config.wikimedia;
  }

  throw new Error(
    withHelpRoute(
      [
        "Knowledge Graph requires wg-wikimedia.",
        "Configure `wikg://local/config/wikimedia` with the service endpoint.",
      ].join(" "),
      CLI_HELP_ROUTES.config,
    ),
  );
}

function isIndexArtifactBuildTarget(target: BuildJob["target"]): boolean {
  return (
    target === "index-fts" ||
    target === "index-embedding-source" ||
    target === "index-embedding-summary"
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

import type { ChapterJobKind } from "./contracts.js";
import type {
  ChapterJobArtifactRecord,
  ChapterJobFileResult,
  JobEmbeddingSegmentRecord,
} from "./file-contracts.js";
import {
  createFtsRowsForInputRecord,
  streamEmbeddingSegments,
} from "./index-build.js";
import { readChapterJobInput, writeChapterJobArtifact } from "./jsonl.js";
import { validateChapterJobInputFile } from "./file-validation.js";
import type { JobDirectory, JobFile } from "./platform.js";
import type { JobEmbeddingProvider } from "./ports.js";
import type {
  JobLlm,
  JobProgressSink,
  JobWikimediaResolver,
  JobWikispineMatcher,
} from "./ports.js";
import { buildKnowledgeGraphRecords } from "./knowledge-graph.js";
import { buildReadingGraphRecords } from "./reading-graph.js";
import { buildReadingSummaryRecords } from "./reading-summary.js";

export interface ChapterJobFileExecutionOptions {
  readonly inputFile: JobFile;
  readonly embeddingProvider?: JobEmbeddingProvider;
  readonly kind: ChapterJobKind;
  readonly language?: string;
  readonly llm?: JobLlm;
  readonly prompt?: string;
  readonly progress?: JobProgressSink;
  readonly revision: number;
  readonly signal?: AbortSignal;
  readonly wikimedia?: JobWikimediaResolver;
  readonly wikispine?: JobWikispineMatcher;
  readonly workspace: JobDirectory;
}

export type ChapterJobFileExecutor = (
  options: ChapterJobFileExecutionOptions,
) => Promise<ChapterJobFileResult>;

export async function executeChapterJobFile(
  options: ChapterJobFileExecutionOptions,
): Promise<ChapterJobFileResult> {
  if ((await options.workspace.list()).length !== 0) {
    throw new Error("Chapter job workspace must be empty.");
  }
  await validateChapterJobInputFile(options.kind, options.inputFile);
  validateGenerationOptions(options);
  const artifactFile = await options.workspace.createFile("artifact.jsonl");
  try {
    switch (options.kind) {
      case "index-fts":
        await writeChapterJobArtifact(
          artifactFile,
          buildFtsRecords(options.inputFile, options.progress),
        );
        break;
      case "index-embedding-source":
      case "index-embedding-summary":
        await writeChapterJobArtifact(
          artifactFile,
          buildEmbeddingRecords(
            options.inputFile,
            requireEmbeddingProvider(options.embeddingProvider),
            options.kind === "index-embedding-source" ? "source" : "summary",
            options.progress,
            options.signal,
          ),
        );
        break;
      case "reading-graph":
        await writeChapterJobArtifact(
          artifactFile,
          buildReadingGraphRecords({
            inputFile: options.inputFile,
            ...(options.language === undefined
              ? {}
              : { language: options.language }),
            llm: requireCapability(options.llm, "LLM"),
            ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
            ...(options.progress === undefined
              ? {}
              : { progress: options.progress }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          }),
        );
        break;
      case "reading-summary":
        await writeChapterJobArtifact(
          artifactFile,
          buildReadingSummaryRecords({
            inputFile: options.inputFile,
            ...(options.language === undefined
              ? {}
              : { language: options.language }),
            llm: requireCapability(options.llm, "LLM"),
            ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
            ...(options.progress === undefined
              ? {}
              : { progress: options.progress }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          }),
        );
        break;
      case "knowledge-graph":
        await writeChapterJobArtifact(
          artifactFile,
          buildKnowledgeGraphRecords({
            inputFile: options.inputFile,
            ...(options.language === undefined
              ? {}
              : { language: options.language }),
            llm: requireCapability(options.llm, "LLM"),
            ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
            ...(options.progress === undefined
              ? {}
              : { progress: options.progress }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            wikimedia: requireCapability(
              options.wikimedia,
              "Wikimedia resolver",
            ),
            wikispine: requireCapability(
              options.wikispine,
              "WikiSpine matcher",
            ),
          }),
        );
        break;
    }
  } catch (error) {
    await options.workspace.remove(artifactFile.name);
    throw error;
  }
  return { artifactFile, revision: options.revision };
}

function validateGenerationOptions(options: ChapterJobFileExecutionOptions) {
  if (
    (options.language !== undefined || options.prompt !== undefined) &&
    options.kind !== "reading-graph" &&
    options.kind !== "reading-summary" &&
    options.kind !== "knowledge-graph"
  ) {
    throw new Error(
      `language and prompt are not supported for ${options.kind}.`,
    );
  }
}

function requireCapability<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required for this job.`);
  return value;
}

async function* buildFtsRecords(
  inputFile: JobFile,
  progress?: JobProgressSink,
) {
  if (progress === undefined) {
    for await (const record of readChapterJobInput(inputFile)) {
      yield* createFtsRowsForInputRecord(record);
    }
    return;
  }
  let total = 0;
  for await (const record of readChapterJobInput(inputFile)) {
    await progress.throwIfStopped?.();
    total += createFtsRowsForInputRecord(record).length;
  }
  await progress.updatePhase?.({
    done: 0,
    phase: "indexing",
    total,
    unit: "record",
  });
  let done = 0;
  let reported = 0;
  for await (const record of readChapterJobInput(inputFile)) {
    await progress.throwIfStopped?.();
    for (const row of createFtsRowsForInputRecord(record)) {
      yield row;
      done += 1;
      if (shouldReportProgress(done, reported, total)) {
        await progress.updatePhase?.({
          done,
          force: false,
          phase: "indexing",
          total,
          unit: "record",
        });
        reported = done;
      }
    }
  }
}

async function* buildEmbeddingRecords(
  inputFile: JobFile,
  provider: JobEmbeddingProvider,
  source: "source" | "summary",
  progress?: JobProgressSink,
  signal?: AbortSignal,
): AsyncIterable<ChapterJobArtifactRecord> {
  let total = 0;
  if (progress !== undefined) {
    for await (const _segment of streamEmbeddingSegments(
      readEmbeddingSentences(inputFile, source),
    )) {
      await progress.throwIfStopped?.();
      total += 1;
    }
    await progress.updatePhase?.({
      done: 0,
      phase: "indexing",
      total,
      unit: "record",
    });
  }
  const segments = streamEmbeddingSegments(
    readEmbeddingSentences(inputFile, source),
  );
  const iterator = segments[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) {
    if (source === "summary") {
      throw new Error(
        "Summary embedding job requires at least one summary sentence.",
      );
    }
    yield {
      dimensions: provider.dimensions ?? 0,
      ...(provider.identity === undefined
        ? {}
        : { identity: provider.identity }),
      model: provider.model,
      source,
      type: "embedding-metadata",
      version: 1,
    };
    return;
  }

  let done = 0;
  let reported = 0;
  await progress?.throwIfStopped?.();
  let batch = [first.value, ...(await takeSegments(iterator, 15))];
  let records = await embedSegments(batch, provider, signal);
  const firstRecord = records[0]!;
  const dimensions = provider.dimensions ?? firstRecord.vector.length;
  if (dimensions <= 0)
    throw new Error("Embedding provider returned no dimensions.");
  assertDimensions(firstRecord, dimensions);
  yield {
    dimensions,
    ...(provider.identity === undefined ? {} : { identity: provider.identity }),
    model: provider.model,
    source,
    type: "embedding-metadata",
    version: 1,
  };
  for (const record of records) {
    assertDimensions(record, dimensions);
    yield record;
  }
  done += records.length;
  if (shouldReportProgress(done, reported, total)) {
    await progress?.updatePhase?.({
      done,
      force: false,
      phase: "indexing",
      total,
      unit: "record",
    });
    reported = done;
  }

  while (true) {
    await progress?.throwIfStopped?.();
    batch = await takeSegments(iterator, 16);
    if (batch.length === 0) return;
    records = await embedSegments(batch, provider, signal);
    for (const record of records) {
      assertDimensions(record, dimensions);
      yield record;
    }
    done += records.length;
    if (shouldReportProgress(done, reported, total)) {
      await progress?.updatePhase?.({
        done,
        force: false,
        phase: "indexing",
        total,
        unit: "record",
      });
      reported = done;
    }
  }
}

function shouldReportProgress(done: number, reported: number, total: number) {
  if (done >= total) return true;
  const denominator = Math.max(1, total);
  return (
    Math.floor((done * 100) / denominator) >
    Math.floor((reported * 100) / denominator)
  );
}

async function* readEmbeddingSentences(
  inputFile: JobFile,
  source: "source" | "summary",
) {
  const expectedType =
    source === "source" ? "source-sentence" : "summary-sentence";
  for await (const record of readChapterJobInput(inputFile)) {
    if (record.type === expectedType) yield record;
  }
}

async function embedSegments(
  segments: readonly Omit<JobEmbeddingSegmentRecord, "type" | "vector">[],
  provider: JobEmbeddingProvider,
  signal?: AbortSignal,
): Promise<readonly JobEmbeddingSegmentRecord[]> {
  const result = await provider.embedTexts(
    segments.map((segment) => segment.text),
    signal === undefined ? undefined : { signal },
  );
  if (result.embeddings.length !== segments.length) {
    throw new Error("Embedding provider must return one vector per segment.");
  }
  return segments.map((segment, index) => ({
    ...segment,
    type: "embedding-segment",
    vector: result.embeddings[index]!,
  }));
}

async function takeSegments<T>(
  iterator: AsyncIterator<T>,
  limit: number,
): Promise<T[]> {
  const output: T[] = [];
  while (output.length < limit) {
    const next = await iterator.next();
    if (next.done) break;
    output.push(next.value);
  }
  return output;
}

function assertDimensions(
  record: JobEmbeddingSegmentRecord,
  dimensions: number,
): void {
  if (record.vector.length !== dimensions) {
    throw new Error(
      `Embedding provider returned ${record.vector.length} dimensions; expected ${dimensions}.`,
    );
  }
}

function requireEmbeddingProvider(
  provider: JobEmbeddingProvider | undefined,
): JobEmbeddingProvider {
  if (provider === undefined) {
    throw new Error("Embedding provider is required for this job.");
  }
  return provider;
}

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
import type { JobDirectory, JobFile } from "./platform.js";
import type { JobEmbeddingProvider } from "./ports.js";

export interface ChapterJobFileExecutionOptions {
  readonly inputFile: JobFile;
  readonly embeddingProvider?: JobEmbeddingProvider;
  readonly kind: ChapterJobKind;
  readonly revision: number;
  readonly workspace: JobDirectory;
}

export async function executeChapterJobFile(
  options: ChapterJobFileExecutionOptions,
): Promise<ChapterJobFileResult> {
  if ((await options.workspace.list()).length !== 0) {
    throw new Error("Chapter job workspace must be empty.");
  }
  const artifactFile = await options.workspace.createFile("artifact.jsonl");
  try {
    switch (options.kind) {
      case "index-fts":
        await writeChapterJobArtifact(
          artifactFile,
          buildFtsRecords(options.inputFile),
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
          ),
        );
        break;
      default:
        throw new Error(`${options.kind} file execution is not implemented.`);
    }
  } catch (error) {
    await options.workspace.remove(artifactFile.name);
    throw error;
  }
  return { artifactFile, revision: options.revision };
}

async function* buildFtsRecords(inputFile: JobFile) {
  for await (const record of readChapterJobInput(inputFile)) {
    yield* createFtsRowsForInputRecord(record);
  }
}

async function* buildEmbeddingRecords(
  inputFile: JobFile,
  provider: JobEmbeddingProvider,
  source: "source" | "summary",
): AsyncIterable<ChapterJobArtifactRecord> {
  const segments = streamEmbeddingSegments(readEmbeddingSentences(inputFile, source));
  const iterator = segments[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) {
    yield {
      dimensions: provider.dimensions ?? 0,
      ...(provider.identity === undefined ? {} : { identity: provider.identity }),
      model: provider.model,
      source,
      type: "embedding-metadata",
      version: 1,
    };
    return;
  }

  const firstRecord = await embedSegment(first.value, provider);
  const dimensions = provider.dimensions ?? firstRecord.vector.length;
  if (dimensions <= 0) throw new Error("Embedding provider returned no dimensions.");
  assertDimensions(firstRecord, dimensions);
  yield {
    dimensions,
    ...(provider.identity === undefined ? {} : { identity: provider.identity }),
    model: provider.model,
    source,
    type: "embedding-metadata",
    version: 1,
  };
  yield firstRecord;

  while (true) {
    const next = await iterator.next();
    if (next.done) return;
    const record = await embedSegment(next.value, provider);
    assertDimensions(record, dimensions);
    yield record;
  }
}

async function* readEmbeddingSentences(
  inputFile: JobFile,
  source: "source" | "summary",
) {
  const expectedType = source === "source" ? "source-sentence" : "summary-sentence";
  for await (const record of readChapterJobInput(inputFile)) {
    if (record.type === expectedType) yield record;
  }
}

async function embedSegment(
  segment: Omit<JobEmbeddingSegmentRecord, "type" | "vector">,
  provider: JobEmbeddingProvider,
): Promise<JobEmbeddingSegmentRecord> {
  const result = await provider.embedTexts([segment.text]);
  const vector = result.embeddings[0];
  if (result.embeddings.length !== 1 || vector === undefined) {
    throw new Error("Embedding provider must return one vector per segment.");
  }
  return { ...segment, type: "embedding-segment", vector };
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

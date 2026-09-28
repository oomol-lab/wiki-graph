import { z } from "zod";

import type {
  ChapterJobArtifactRecord,
  ChapterJobInputRecord,
} from "./file-contracts.js";
import type { JobFile } from "./platform.js";

const nonNegativeInteger = z.number().int().nonnegative();
const sentenceFields = {
  sentenceIndex: nonNegativeInteger,
  text: z.string(),
  wordsCount: nonNegativeInteger,
};

const inputRecordSchema = z.discriminatedUnion("type", [
  z.object({
    extractionPrompt: z.string().optional(),
    language: z.string().optional(),
    policyPrompt: z.string().optional(),
    prompt: z.string().optional(),
    type: z.literal("job-options"),
  }),
  z.object({ text: z.string(), type: z.literal("source-text") }),
  z.object({
    fragmentId: nonNegativeInteger,
    summary: z.string(),
    type: z.literal("source-fragment"),
  }),
  z.object({
    ...sentenceFields,
    fragmentId: nonNegativeInteger.optional(),
    type: z.literal("source-sentence"),
  }),
  z.object({ ...sentenceFields, type: z.literal("summary-sentence") }),
  z.object({
    chapterId: z.number().int(),
    title: z.string(),
    type: z.literal("chapter-title"),
  }),
  readingChunkSchema(),
  readingEdgeSchema(),
  fragmentGroupSchema(),
  snakeSchema(),
  snakeChunkSchema(),
  snakeEdgeSchema(),
  mentionSchema(),
]);

const artifactRecordSchema = z.discriminatedUnion("type", [
  z.object({
    language: z.string().optional(),
    prompt: z.string(),
    scope: z.enum(["knowledge-graph", "reading-graph"]),
    type: z.literal("job-parameter"),
  }),
  readingChunkSchema(),
  readingEdgeSchema(),
  fragmentGroupSchema(),
  snakeSchema(),
  snakeChunkSchema(),
  snakeEdgeSchema(),
  mentionSchema(),
  mentionLinkSchema(),
  z.object({
    position: nonNegativeInteger,
    text: z.string(),
    type: z.literal("summary-part"),
  }),
  z.object({
    metadata: z.record(z.string(), z.unknown()),
    objectId: z.string(),
    objectKind: z.string(),
    rowId: z.string(),
    sentenceIndex: nonNegativeInteger.optional(),
    text: z.string(),
    tokens: z.array(z.string()),
    type: z.literal("lexical-row"),
  }),
  z.object({
    dimensions: nonNegativeInteger,
    identity: z.string().optional(),
    model: z.string(),
    source: z.enum(["source", "summary"]),
    type: z.literal("embedding-metadata"),
    version: z.literal(1),
  }),
  z.object({
    endSentenceIndex: nonNegativeInteger,
    segmentIndex: nonNegativeInteger,
    startSentenceIndex: nonNegativeInteger,
    text: z.string(),
    type: z.literal("embedding-segment"),
    vector: z.array(z.number()),
    wordsCount: nonNegativeInteger,
  }),
]);

export async function* readChapterJobInput(
  file: JobFile,
): AsyncIterable<ChapterJobInputRecord> {
  for await (const value of readJsonl(file)) {
    yield inputRecordSchema.parse(value) as ChapterJobInputRecord;
  }
}

export async function* readChapterJobArtifact(
  file: JobFile,
): AsyncIterable<ChapterJobArtifactRecord> {
  for await (const value of readJsonl(file)) {
    yield artifactRecordSchema.parse(value) as ChapterJobArtifactRecord;
  }
}

export async function writeChapterJobInput(
  file: JobFile,
  records: AsyncIterable<ChapterJobInputRecord> | Iterable<ChapterJobInputRecord>,
): Promise<void> {
  await writeJsonl(file, records, (record) => inputRecordSchema.parse(record));
}

export async function writeChapterJobArtifact(
  file: JobFile,
  records:
    | AsyncIterable<ChapterJobArtifactRecord>
    | Iterable<ChapterJobArtifactRecord>,
): Promise<void> {
  await writeJsonl(file, records, (record) => artifactRecordSchema.parse(record));
}

async function* readJsonl(file: JobFile): AsyncIterable<unknown> {
  const reader = await file.openReader();
  const decoder = new TextDecoder();
  let offset = 0;
  let pending = "";
  try {
    while (offset < reader.size) {
      const chunk = await reader.read(offset, Math.min(64 * 1024, reader.size - offset));
      if (chunk.byteLength === 0) throw new Error("Unexpected end of JSONL file.");
      offset += chunk.byteLength;
      pending += decoder.decode(chunk, { stream: offset < reader.size });
      while (true) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line !== "") yield parseLine(line);
      }
    }
    pending += decoder.decode();
    if (pending.trim() !== "") yield parseLine(pending.trim());
  } finally {
    await reader.close();
  }
}

async function writeJsonl<T>(
  file: JobFile,
  records: AsyncIterable<T> | Iterable<T>,
  parse: (record: T) => unknown,
): Promise<void> {
  const writer = await file.openWriter();
  try {
    for await (const record of records) {
      try {
        await writer.write(`${JSON.stringify(parse(record))}\n`);
      } catch (error) {
        throw new Error(
          `Invalid JSONL record${recordType(record)}: ${formatError(error)}`,
          { cause: error },
        );
      }
    }
    await writer.commit();
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

function recordType(record: unknown): string {
  return typeof record === "object" && record !== null && "type" in record
    ? ` of type ${String(record.type)}`
    : "";
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSONL record: ${formatError(error)}`);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readingChunkSchema(): z.ZodObject {
  return z.object({
    content: z.string(),
    generation: z.number().int(),
    id: z.string(),
    importance: z.enum(["critical", "helpful", "important"]).optional(),
    label: z.string(),
    retention: z.enum(["detailed", "focused", "relevant", "verbatim"]).optional(),
    sentenceIndex: nonNegativeInteger,
    sentenceIndexes: z.array(nonNegativeInteger),
    type: z.literal("reading-chunk"),
    weight: z.number(),
    wordsCount: nonNegativeInteger,
  });
}

function readingEdgeSchema(): z.ZodObject {
  return z.object({
    fromChunkId: z.string(),
    strength: z.string().optional(),
    toChunkId: z.string(),
    type: z.literal("reading-edge"),
    weight: z.number(),
  });
}

function fragmentGroupSchema(): z.ZodObject {
  return z.object({
    endSentenceIndex: nonNegativeInteger,
    groupId: nonNegativeInteger,
    startSentenceIndex: nonNegativeInteger,
    type: z.literal("fragment-group"),
  });
}

function snakeSchema(): z.ZodObject {
  return z.object({
    firstLabel: z.string(),
    groupId: nonNegativeInteger,
    id: z.string(),
    lastLabel: z.string(),
    localSnakeId: nonNegativeInteger,
    size: nonNegativeInteger,
    type: z.literal("snake"),
    weight: z.number(),
    wordsCount: nonNegativeInteger,
  });
}

function snakeChunkSchema(): z.ZodObject {
  return z.object({
    chunkId: z.string(),
    position: nonNegativeInteger,
    snakeId: z.string(),
    type: z.literal("snake-chunk"),
  });
}

function snakeEdgeSchema(): z.ZodObject {
  return z.object({
    fromSnakeId: z.string(),
    toSnakeId: z.string(),
    type: z.literal("snake-edge"),
    weight: z.number(),
  });
}

function mentionSchema(): z.ZodObject {
  return z.object({
    confidence: z.number().optional(),
    fragmentId: nonNegativeInteger.optional(),
    id: z.string(),
    note: z.string().optional(),
    qid: z.string(),
    rangeEnd: nonNegativeInteger,
    rangeStart: nonNegativeInteger,
    sentenceIndex: nonNegativeInteger.optional(),
    surface: z.string(),
    type: z.literal("mention"),
  });
}

function mentionLinkSchema(): z.ZodObject {
  return z.object({
    confidence: z.number().optional(),
    evidenceSentenceIndexes: z.array(nonNegativeInteger),
    id: z.string(),
    note: z.string().optional(),
    predicate: z.string(),
    sourceMentionId: z.string(),
    targetMentionId: z.string(),
    type: z.literal("mention-link"),
  });
}

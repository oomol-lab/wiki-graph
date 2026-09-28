import { z } from "zod";

import type {
  ChapterJobArtifactRecord,
  JobOptionsRecord,
  JobSourceTextRecord,
} from "./file-contracts.js";
import { readChapterJobInput } from "./jsonl.js";
import { requestJobJson } from "./llm-json.js";
import type { JobFile } from "./platform.js";
import type { JobLlm } from "./ports.js";

const WINDOW_SENTENCES = 24;

const responseSchema = z.object({
  chunks: z.array(
    z.object({
      content: z.string().min(1),
      importance: z.enum(["critical", "important", "helpful"]).optional(),
      label: z.string().min(1),
      retention: z
        .enum(["verbatim", "detailed", "focused", "relevant"])
        .optional(),
      sentenceIndexes: z.array(z.number().int().nonnegative()).min(1),
      tempId: z.string().min(1),
      weight: z.number().nonnegative().optional(),
    }),
  ),
  links: z.array(
    z.object({
      from: z.string().min(1),
      strength: z.string().optional(),
      to: z.string().min(1),
      weight: z.number().nonnegative().optional(),
    }),
  ),
});

export async function* buildReadingGraphRecords(options: {
  readonly inputFile: JobFile;
  readonly llm: JobLlm;
  readonly signal?: AbortSignal;
}): AsyncIterable<ChapterJobArtifactRecord> {
  const jobOptions = await readOptions(options.inputFile);
  yield {
    ...(jobOptions.language === undefined
      ? {}
      : { language: jobOptions.language }),
    prompt: jobOptions.extractionPrompt ?? "",
    scope: "reading-graph",
    type: "job-parameter",
  };

  let window: JobSourceTextRecord[] = [];
  let generation = 0;
  let nextChunkId = 1;
  let nextGroupId = 0;
  let nextSnakeId = 1;
  for await (const record of readChapterJobInput(options.inputFile)) {
    if (record.type !== "source-text") continue;
    window.push(record);
    if (window.length < WINDOW_SENTENCES) continue;
    const result = await extractWindow(
      window,
      generation,
      nextChunkId,
      options,
    );
    yield* result.records;
    nextChunkId = result.nextChunkId;
    yield* createTopologyRecords(
      result.chunkIds,
      window,
      nextGroupId,
      nextSnakeId,
    );
    nextGroupId += 1;
    nextSnakeId += result.chunkIds.length;
    generation += 1;
    window = [];
  }
  if (window.length > 0) {
    const result = await extractWindow(
      window,
      generation,
      nextChunkId,
      options,
    );
    yield* result.records;
    yield* createTopologyRecords(
      result.chunkIds,
      window,
      nextGroupId,
      nextSnakeId,
    );
  }
}

async function extractWindow(
  sentences: readonly JobSourceTextRecord[],
  generation: number,
  nextChunkId: number,
  options: {
    readonly llm: JobLlm;
    readonly signal?: AbortSignal;
  },
): Promise<{
  readonly chunkIds: readonly string[];
  readonly nextChunkId: number;
  readonly records: readonly ChapterJobArtifactRecord[];
}> {
  const allowedIndexes = new Set(
    sentences.map((sentence) => sentence.sentenceIndex),
  );
  const response = await requestJobJson({
    llm: options.llm,
    messages: [
      {
        content: [
          "Extract a Reading Graph from the numbered source sentences.",
          "Return JSON with chunks and links. Each chunk must have tempId, label, content and source sentenceIndexes.",
          "Use retention for reader-focused information and importance for connective information when appropriate.",
          "Links may only reference tempIds returned in the same response.",
        ].join(" "),
        role: "system",
      },
      {
        content: sentences
          .map((sentence) => `[${sentence.sentenceIndex}] ${sentence.text}`)
          .join("\n"),
        role: "user",
      },
    ],
    schema: responseSchema,
    scope: "reading-graph-extraction",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const ids = new Map<string, string>();
  const records: ChapterJobArtifactRecord[] = [];
  for (const chunk of response.chunks) {
    const sentenceIndexes = [...new Set(chunk.sentenceIndexes)]
      .filter((index) => allowedIndexes.has(index))
      .sort((left, right) => left - right);
    if (sentenceIndexes.length === 0 || ids.has(chunk.tempId)) continue;
    const id = `chunk-${nextChunkId}`;
    nextChunkId += 1;
    ids.set(chunk.tempId, id);
    records.push({
      content: chunk.content,
      generation,
      id,
      ...(chunk.importance === undefined
        ? {}
        : { importance: chunk.importance }),
      label: chunk.label,
      ...(chunk.retention === undefined ? {} : { retention: chunk.retention }),
      sentenceIndex: sentenceIndexes[0]!,
      sentenceIndexes,
      type: "reading-chunk",
      weight: chunk.weight ?? 1,
      wordsCount: sentences
        .filter((sentence) => sentenceIndexes.includes(sentence.sentenceIndex))
        .reduce((total, sentence) => total + sentence.wordsCount, 0),
    });
  }
  for (const link of response.links) {
    const fromChunkId = ids.get(link.from);
    const toChunkId = ids.get(link.to);
    if (fromChunkId === undefined || toChunkId === undefined) continue;
    records.push({
      fromChunkId,
      ...(link.strength === undefined ? {} : { strength: link.strength }),
      toChunkId,
      type: "reading-edge",
      weight: link.weight ?? 1,
    });
  }
  return { chunkIds: [...ids.values()], nextChunkId, records };
}

function* createTopologyRecords(
  chunkIds: readonly string[],
  sentences: readonly JobSourceTextRecord[],
  groupId: number,
  firstSnakeId: number,
): Iterable<ChapterJobArtifactRecord> {
  const first = sentences[0];
  const last = sentences.at(-1);
  if (first === undefined || last === undefined) return;
  yield {
    endSentenceIndex: last.sentenceIndex,
    groupId,
    startSentenceIndex: first.sentenceIndex,
    type: "fragment-group",
  };
  for (let index = 0; index < chunkIds.length; index += 1) {
    const chunkId = chunkIds[index]!;
    const snakeId = `snake-${firstSnakeId + index}`;
    yield {
      firstLabel: chunkId,
      groupId,
      id: snakeId,
      lastLabel: chunkId,
      localSnakeId: index,
      size: 1,
      type: "snake",
      weight: 1,
      wordsCount: 0,
    };
    yield { chunkId, position: 0, snakeId, type: "snake-chunk" };
  }
}

async function readOptions(file: JobFile): Promise<JobOptionsRecord> {
  for await (const record of readChapterJobInput(file)) {
    if (record.type === "job-options") return record;
  }
  return { type: "job-options" };
}

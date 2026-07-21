import { z } from "zod";

import type {
  ChunkRecord,
  FragmentRecord,
  ReadingEdgeRecord,
  SentenceGroupRecord,
  SentenceId,
  SerialRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "../../document/index.js";
import { ChunkImportance, ChunkRetention } from "../../document/types.js";

const sentenceIdSchema = z.tuple([
  z.number(),
  z.number(),
]) satisfies z.ZodType<SentenceId>;
const sentenceRecordSchema = z.object({
  text: z.string(),
  wordsCount: z.number(),
});
const fragmentRecordSchema = z.object({
  serialId: z.number(),
  fragmentId: z.number(),
  summary: z.string(),
  sentences: z.array(sentenceRecordSchema),
}) satisfies z.ZodType<FragmentRecord>;
const serialRecordSchema = z
  .object({
    documentOrder: z.number().optional(),
    id: z.number(),
    knowledgeGraphReady: z.boolean(),
    knowledgeGraphParameterHash: z.string().optional(),
    revision: z.number().optional(),
    topologyParameterHash: z.string().optional(),
    topologyReady: z.boolean(),
  })
  .transform((record) => ({
    documentOrder: record.documentOrder ?? record.id,
    id: record.id,
    knowledgeGraphReady: record.knowledgeGraphReady,
    ...(record.knowledgeGraphParameterHash === undefined
      ? {}
      : { knowledgeGraphParameterHash: record.knowledgeGraphParameterHash }),
    revision: record.revision ?? 0,
    topologyReady: record.topologyReady,
    ...(record.topologyParameterHash === undefined
      ? {}
      : { topologyParameterHash: record.topologyParameterHash }),
  })) satisfies z.ZodType<SerialRecord>;

export const chunkRecordSchema = z.object({
  id: z.number(),
  generation: z.number(),
  sentenceId: sentenceIdSchema,
  label: z.string(),
  content: z.string(),
  sentenceIds: z.array(sentenceIdSchema),
  retention: z.enum(ChunkRetention).optional(),
  importance: z.enum(ChunkImportance).optional(),
  wordsCount: z.number(),
  weight: z.number(),
});

export const knowledgeEdgeRecordSchema = z.object({
  fromId: z.number(),
  toId: z.number(),
  strength: z.string().optional(),
  weight: z.number(),
});

const snakeRecordSchema = z.object({
  id: z.number(),
  serialId: z.number(),
  groupId: z.number(),
  localSnakeId: z.number(),
  size: z.number(),
  firstLabel: z.string(),
  lastLabel: z.string(),
  wordsCount: z.number(),
  weight: z.number(),
}) satisfies z.ZodType<SnakeRecord>;
const snakeChunkRecordSchema = z.object({
  snakeId: z.number(),
  chunkId: z.number(),
  position: z.number(),
}) satisfies z.ZodType<SnakeChunkRecord>;
const snakeEdgeRecordSchema = z.object({
  fromSnakeId: z.number(),
  toSnakeId: z.number(),
  weight: z.number(),
}) satisfies z.ZodType<SnakeEdgeRecord>;
const fragmentGroupRecordSchema = z.object({
  serialId: z.number(),
  groupId: z.number(),
  startSentenceIndex: z.number(),
  endSentenceIndex: z.number(),
}) satisfies z.ZodType<SentenceGroupRecord>;

export const summaryInputSnapshotSchema = z.object({
  chunks: z.array(chunkRecordSchema),
  fragmentGroups: z.array(fragmentGroupRecordSchema),
  fragments: z.array(fragmentRecordSchema),
  readingEdges: z.array(knowledgeEdgeRecordSchema),
  serial: serialRecordSchema,
  snakeChunks: z.array(snakeChunkRecordSchema),
  snakeEdges: z.array(snakeEdgeRecordSchema),
  snakes: z.array(snakeRecordSchema),
});

export function toChunkRecord(
  record: z.infer<typeof chunkRecordSchema>,
): ChunkRecord {
  return {
    id: record.id,
    generation: record.generation,
    sentenceId: record.sentenceId,
    label: record.label,
    content: record.content,
    sentenceIds: record.sentenceIds,
    ...(record.retention === undefined ? {} : { retention: record.retention }),
    ...(record.importance === undefined
      ? {}
      : { importance: record.importance }),
    wordsCount: record.wordsCount,
    weight: record.weight,
  };
}

export function toReadingEdgeRecord(
  record: z.infer<typeof knowledgeEdgeRecordSchema>,
): ReadingEdgeRecord {
  return {
    fromId: record.fromId,
    toId: record.toId,
    ...(record.strength === undefined ? {} : { strength: record.strength }),
    weight: record.weight,
  };
}

import { z } from "zod";

import type { JobObject } from "./contracts.js";

const nonNegativeInteger = z.number().int().nonnegative();
const sentence = z
  .object({ text: z.string(), wordsCount: nonNegativeInteger })
  .strict();

const schema = z.discriminatedUnion("type", [
  z
    .object({
      chapterId: z.number().int(),
      schemaVersion: z.literal(1),
      stream: z.enum(["knowledge-graph", "reading-graph", "summary"]),
      type: z.literal("meta"),
    })
    .strict(),
  z
    .object({
      language: z.string().optional(),
      prompt: z.string(),
      scope: z.enum(["knowledge-graph", "reading-graph", "summary"]),
      type: z.literal("parameter"),
    })
    .strict(),
  z
    .object({
      fragmentId: nonNegativeInteger,
      sentences: z.array(sentence),
      summary: z.string(),
      type: z.literal("source-fragment"),
    })
    .strict(),
  z
    .object({
      content: z.string(),
      generation: z.number().int(),
      id: z.string().min(1),
      importance: z.enum(["critical", "important", "helpful"]).optional(),
      label: z.string(),
      retention: z
        .enum(["verbatim", "detailed", "focused", "relevant"])
        .optional(),
      sentenceIndex: nonNegativeInteger,
      sentenceIndexes: z.array(nonNegativeInteger).min(1),
      type: z.literal("reading-chunk"),
      weight: z.number(),
      wordsCount: nonNegativeInteger,
    })
    .strict(),
  z
    .object({
      fromChunkId: z.string().min(1),
      strength: z.string().optional(),
      toChunkId: z.string().min(1),
      type: z.literal("reading-edge"),
      weight: z.number(),
    })
    .strict(),
  z
    .object({
      endSentenceIndex: nonNegativeInteger,
      groupId: nonNegativeInteger,
      startSentenceIndex: nonNegativeInteger,
      type: z.literal("fragment-group"),
    })
    .strict(),
  z
    .object({
      firstLabel: z.string(),
      groupId: nonNegativeInteger,
      id: z.string().min(1),
      lastLabel: z.string(),
      localSnakeId: nonNegativeInteger,
      size: nonNegativeInteger,
      type: z.literal("snake"),
      weight: z.number(),
      wordsCount: nonNegativeInteger,
    })
    .strict(),
  z
    .object({
      chunkId: z.string().min(1),
      position: nonNegativeInteger,
      snakeId: z.string().min(1),
      type: z.literal("snake-chunk"),
    })
    .strict(),
  z
    .object({
      fromSnakeId: z.string().min(1),
      toSnakeId: z.string().min(1),
      type: z.literal("snake-edge"),
      weight: z.number(),
    })
    .strict(),
  z.object({ text: z.string(), type: z.literal("summary") }).strict(),
  z
    .object({
      confidence: z.number().min(0).max(1).optional(),
      fragmentId: nonNegativeInteger.optional(),
      id: z.string().min(1),
      note: z.string().optional(),
      qid: z.string().regex(/^Q[1-9][0-9]*$/u),
      rangeEnd: nonNegativeInteger,
      rangeStart: nonNegativeInteger,
      sentenceIndex: nonNegativeInteger.optional(),
      surface: z.string().min(1),
      type: z.literal("mention"),
    })
    .strict(),
  z
    .object({
      confidence: z.number().min(0).max(1).optional(),
      evidenceSentenceIndexes: z.array(nonNegativeInteger).min(1),
      id: z.string().min(1),
      note: z.string().optional(),
      predicate: z.string().min(1),
      sourceMentionId: z.string().min(1),
      targetMentionId: z.string().min(1),
      type: z.literal("mention-link"),
    })
    .strict(),
  z.object({ type: z.literal("end") }).strict(),
]);

export function parseJobObject(value: unknown): JobObject {
  return schema.parse(value) as JobObject;
}

export function encodeJobObject(object: JobObject): string {
  return JSON.stringify(parseJobObject(object));
}

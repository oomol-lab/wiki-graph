import { z } from "zod";

import type { ChapterJobArtifactRecord } from "./file-contracts.js";
import type { JobLlmUsage, JobProgressPhase } from "./ports.js";

const nonNegativeNumber = z.number().finite().nonnegative();
const progressPhaseSchema = z.enum([
  "committing",
  "enrichment",
  "grounding",
  "indexing",
  "matching",
  "narrowing",
  "relation-discovery",
  "reading-extraction",
  "screening",
  "summary-compression",
] satisfies readonly JobProgressPhase[]);
const progressUnitSchema = z.enum([
  "candidate",
  "char",
  "item",
  "page",
  "qid",
  "record",
  "sentence",
  "window",
]);
const tokenUsageSchema = z.object({
  cacheReadTokens: nonNegativeNumber.optional(),
  inputTokens: nonNegativeNumber.optional(),
  outputTokens: nonNegativeNumber.optional(),
});
const progressSchema = z.object({
  done: nonNegativeNumber,
  force: z.boolean().optional(),
  phase: progressPhaseSchema,
  phaseDetail: z.string().optional(),
  total: nonNegativeNumber,
  unit: progressUnitSchema,
});

export const CHAPTER_JOB_EVENT_STREAM_CONTENT_TYPE =
  "application/x-wiki-graph-job-events+jsonl; charset=utf-8";

export type ChapterJobStreamEvent =
  | {
      readonly characters: number;
      readonly event: "output-characters";
    }
  | {
      readonly event: "token-usage";
      readonly usage: JobLlmUsage;
    }
  | {
      readonly event: "progress";
      readonly progress: z.infer<typeof progressSchema>;
    }
  | {
      readonly event: "artifact";
      readonly record: ChapterJobArtifactRecord;
    }
  | {
      readonly event: "complete";
      readonly revision: number;
    }
  | {
      readonly event: "error";
      readonly message: string;
    };

const streamEventSchema = z.discriminatedUnion("event", [
  z.object({
    characters: nonNegativeNumber,
    event: z.literal("output-characters"),
  }),
  z.object({ event: z.literal("token-usage"), usage: tokenUsageSchema }),
  z.object({ event: z.literal("progress"), progress: progressSchema }),
  z.object({ event: z.literal("artifact"), record: z.unknown() }),
  z.object({
    event: z.literal("complete"),
    revision: z.number().int().nonnegative(),
  }),
  z.object({ event: z.literal("error"), message: z.string() }),
]);

export function parseChapterJobStreamEvent(
  value: unknown,
): ChapterJobStreamEvent {
  return streamEventSchema.parse(value) as ChapterJobStreamEvent;
}

import { z } from "zod";

import { ChunkImportance, ChunkRetention } from "../../../../document/index.js";
import type { RankedSentenceCandidate } from "../../../../graph/evidence-selection/index.js";
import type { LLMessage } from "../../../../external/llm/index.js";
import type { ChunkBatch } from "../types.js";

const chunkLinkSchema = z.object({
  from: z.union([z.number().int(), z.string()]),
  strength: z.string().optional(),
  to: z.union([z.number().int(), z.string()]),
});
const evidenceSelectionItemSchema = z
  .object({
    quote: z.string().optional(),
    sentence_id: z.string().optional(),
  })
  .passthrough();
const chunkEvidenceSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(evidenceSelectionItemSchema),
]);

const userFocusedChunkSchema = z
  .object({
    content: z.string(),
    evidence: chunkEvidenceSchema.nullish(),
    label: z.string(),
    retention: z.enum([
      ChunkRetention.Verbatim,
      ChunkRetention.Detailed,
      ChunkRetention.Focused,
      ChunkRetention.Relevant,
    ]),
    temp_id: z.string(),
  })
  .passthrough();

export const userFocusedResponseSchema = z.object({
  chunks: z.array(userFocusedChunkSchema),
  fragment_summary: z.string(),
  links: z.array(chunkLinkSchema),
});

const bookCoherenceChunkSchema = z
  .object({
    content: z.string(),
    evidence: chunkEvidenceSchema.nullish(),
    importance: z.enum([
      ChunkImportance.Critical,
      ChunkImportance.Important,
      ChunkImportance.Helpful,
    ]),
    label: z.string(),
    temp_id: z.string(),
  })
  .passthrough();

const importanceAnnotationSchema = z.object({
  chunk_id: z.number().int(),
  importance: z.enum([
    ChunkImportance.Critical,
    ChunkImportance.Important,
    ChunkImportance.Helpful,
  ]),
});

export const bookCoherenceResponseSchema = z.object({
  chunks: z.array(bookCoherenceChunkSchema),
  importance_annotations: z.array(importanceAnnotationSchema),
  links: z.array(chunkLinkSchema),
});

export const choiceResponseSchema = z.object({
  choice: z.string(),
});

export type UserFocusedChunkData = z.infer<typeof userFocusedChunkSchema>;
export type BookCoherenceChunkData = z.infer<typeof bookCoherenceChunkSchema>;
export type UserFocusedResponseData = z.infer<typeof userFocusedResponseSchema>;
export type BookCoherenceResponseData = z.infer<
  typeof bookCoherenceResponseSchema
>;
export type ExtractedChunkData = UserFocusedChunkData | BookCoherenceChunkData;
export type RawChunkLink = z.infer<typeof chunkLinkSchema>;
export type RawChunkEvidence = z.infer<typeof chunkEvidenceSchema>;
export type ChoiceFieldName = "evidence" | "start_anchor" | "end_anchor";

export enum ChunkMetadataField {
  Retention = "retention",
  Importance = "importance",
}

export interface ExtractChunksResult {
  readonly chunkBatch: ChunkBatch;
  readonly fragmentSummary?: string;
}

export interface ResolveChunkEvidenceInput {
  readonly data: ExtractedChunkData;
  readonly chunkIndex: number;
  readonly chunkLabel: string;
  readonly isLastGenerationAttempt: boolean;
}

export interface SelectAmbiguousCandidateInput {
  readonly candidates: readonly RankedSentenceCandidate[];
  readonly chunkData: ExtractedChunkData;
  readonly chunkIndex: number;
  readonly chunkLabel: string;
  readonly fieldName: ChoiceFieldName;
}

export type GuaranteedChoiceRequest = (
  messages: readonly LLMessage[],
  index: number,
  maxRetries: number,
) => Promise<string>;

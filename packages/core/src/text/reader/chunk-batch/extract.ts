import { ChunkExtractor } from "./extractor.js";
import type {
  ChunkBatch,
  ChunkBatchOptions,
  ExtractBookCoherenceInput,
  ExtractUserFocusedInput,
  ExtractUserFocusedResult,
} from "./types.js";

export async function extractUserFocusedChunkBatch<S extends string>(
  options: ChunkBatchOptions<S>,
  input: ExtractUserFocusedInput,
): Promise<ExtractUserFocusedResult> {
  const extractor = new ChunkExtractor(options);

  return await extractor.extractUserFocused(input);
}

export async function extractBookCoherenceChunkBatch<S extends string>(
  options: ChunkBatchOptions<S>,
  input: ExtractBookCoherenceInput,
): Promise<ChunkBatch> {
  const extractor = new ChunkExtractor(options);

  return await extractor.extractBookCoherence(input);
}

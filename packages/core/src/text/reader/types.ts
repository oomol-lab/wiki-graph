import type {
  ChunkGraphDelta as AttentionChunkGraphDelta,
  ChunkGraphEdge as AttentionChunkGraphEdge,
} from "./attention/core.js";
import type {
  ChunkBatchOptions,
  ChunkExtractionSentence,
  ChunkImportanceAnnotation,
  CognitiveChunk,
} from "./chunk-batch/types.js";
import type {
  SentenceStreamAdapter,
  SentenceStreamItem,
  TextStream,
} from "./segment/types.js";

export type ReaderTextStream = TextStream;

export type ReaderSegment = SentenceStreamItem;

export type ReaderSegmenter = SentenceStreamAdapter;

export type ReaderSentence = ChunkExtractionSentence;

export type ReaderChunk = CognitiveChunk;

export type ReaderGraphEdge = AttentionChunkGraphEdge;

export type ReaderImportanceAnnotation = ChunkImportanceAnnotation;

export type ReaderGraphDelta = AttentionChunkGraphDelta;

export interface ReaderOptions<S extends string> extends ChunkBatchOptions<S> {
  readonly attention: {
    readonly capacity: number;
    readonly generationDecayFactor: number;
    readonly idGenerator: () => Promise<number>;
  };
  readonly segmenter?: ReaderSegmenter;
}

import type {
  ChunkRecord,
  ReadingEdgeRecord,
} from "../../../document/index.js";

export interface DetectorGraph {
  readonly chunksById: Readonly<Record<string, ChunkRecord | undefined>>;
  readonly edgeByKey: Readonly<Record<string, ReadingEdgeRecord | undefined>>;
  readonly fingerprintEdgeWeightsByKey: Readonly<Record<string, number>>;
  readonly incomingEdgesByChunkId: Readonly<
    Record<string, readonly ReadingEdgeRecord[] | undefined>
  >;
  readonly outgoingEdgesByChunkId: Readonly<
    Record<string, readonly ReadingEdgeRecord[] | undefined>
  >;
  readonly sortedChunkIds: readonly number[];
  readonly undirectedAdjacentChunkIdsByChunkId: Readonly<
    Record<string, readonly number[] | undefined>
  >;
}

export interface EdgeQueueEntry {
  readonly leftClusterId: number;
  readonly rightClusterId: number;
  readonly value: number;
}

export interface MergeConfig {
  readonly enableBonus: boolean;
  readonly snakeWordsCount: number;
}

export type Fingerprints = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;

import type {
  ChunkRecord,
  ReadonlySerialFragments,
  SentenceGroupRecord,
} from "../reading/model.js";

export type {
  ChunkImportance,
  ChunkRecord,
  FragmentRecord,
  Language,
  ReadonlySerialFragments,
  ReadingLlm,
  SentenceGroupRecord,
} from "../reading/model.js";
export { ChunkRetention } from "../reading/model.js";

export interface SnakeRecord {
  readonly firstLabel: string;
  readonly groupId: number;
  readonly id: number;
  readonly lastLabel: string;
  readonly localSnakeId: number;
  readonly serialId: number;
  readonly size: number;
  readonly weight: number;
  readonly wordsCount: number;
}

export interface SummaryDocument {
  readonly chunks: {
    getById(chunkId: number): Promise<ChunkRecord | undefined>;
  };
  readonly fragmentGroups: {
    listBySerial(serialId: number): Promise<readonly SentenceGroupRecord[]>;
  };
  readonly snakeChunks: {
    listChunkIds(snakeId: number): Promise<readonly number[]>;
  };
  readonly snakes: {
    getById(snakeId: number): Promise<SnakeRecord | undefined>;
    listIdsByGroup(
      serialId: number,
      groupId: number,
    ): Promise<readonly number[]>;
  };
  getSerialFragments(serialId: number): ReadonlySerialFragments;
}

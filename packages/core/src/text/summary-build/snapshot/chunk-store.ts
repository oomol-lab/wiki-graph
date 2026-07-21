import type {
  ChunkRecord,
  FragmentRecord,
  ReadonlyChunkStore,
} from "../../../document/index.js";
import {
  compareChunkById,
  comparePair,
  createFragmentStartIndexesBySerialId,
  createSegmentRanges,
} from "./helpers.js";

export class SnapshotChunkStore implements ReadonlyChunkStore {
  readonly #chunks: readonly ChunkRecord[];
  readonly #chunksById: Map<number, ChunkRecord>;
  readonly #fragmentStartIndexesBySerialId: ReadonlyMap<
    number,
    readonly number[]
  >;

  public constructor(
    chunks: readonly ChunkRecord[],
    fragments: readonly FragmentRecord[],
  ) {
    this.#chunks = [...chunks].sort(compareChunkById);
    this.#chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    this.#fragmentStartIndexesBySerialId =
      createFragmentStartIndexesBySerialId(fragments);
  }

  public getById(chunkId: number): Promise<ChunkRecord | undefined> {
    return Promise.resolve(this.#chunksById.get(chunkId));
  }

  public countAll(): Promise<number> {
    return Promise.resolve(this.#chunks.length);
  }

  public listAll(): Promise<ChunkRecord[]> {
    return Promise.resolve([...this.#chunks]);
  }

  public listBySentenceStartIndexes(
    serialId: number,
    sentenceStartIndexes: readonly number[],
  ): Promise<ChunkRecord[]> {
    const segmentRanges = createSegmentRanges(
      this.#fragmentStartIndexesBySerialId.get(serialId) ?? [],
      sentenceStartIndexes,
    );

    return Promise.resolve(
      this.#chunks.filter(
        (chunk) =>
          chunk.sentenceId[0] === serialId &&
          segmentRanges.some(
            (range) =>
              chunk.sentenceId[1] >= range.startSentenceIndex &&
              chunk.sentenceId[1] <= range.endSentenceIndex,
          ),
      ),
    );
  }

  public listBySentenceRange(
    serialId: number,
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<ChunkRecord[]> {
    return Promise.resolve(
      this.#chunks.filter(
        (chunk) =>
          chunk.sentenceId[0] === serialId &&
          chunk.sentenceId[1] >= startSentenceIndex &&
          chunk.sentenceId[1] <= endSentenceIndex,
      ),
    );
  }

  public listBySerial(serialId: number): Promise<ChunkRecord[]> {
    return Promise.resolve(
      this.#chunks.filter((chunk) => chunk.sentenceId[0] === serialId),
    );
  }

  public getMaxId(): Promise<number> {
    return Promise.resolve(
      this.#chunks.reduce((maxId, chunk) => Math.max(maxId, chunk.id), 0),
    );
  }

  public listFragmentPairs(): Promise<
    ReadonlyArray<readonly [number, number]>
  > {
    const pairs = new Set<string>();

    for (const chunk of this.#chunks) {
      pairs.add(`${chunk.sentenceId[0]}:${chunk.sentenceId[1]}`);
    }

    return Promise.resolve(
      [...pairs]
        .map((pair) => pair.split(":").map(Number) as [number, number])
        .sort(comparePair)
        .map(([serialId, fragmentId]) => [serialId, fragmentId] as const),
    );
  }
}

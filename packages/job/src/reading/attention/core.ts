import { WaveReflection } from "./wave-reflection.js";
import { WorkingMemory } from "./working-memory.js";
import type {
  ChunkBatch,
  ChunkImportanceAnnotation,
  CognitiveChunk,
} from "../chunk-batch/types.js";

export interface ChunkBatchContext {
  readonly visibleChunkIds: readonly number[];
  readonly workingMemoryPrompt: string;
}

export interface ChunkGraphEdge {
  readonly fromId: number;
  readonly strength?: string;
  readonly toId: number;
}

export interface ChunkGraphDelta {
  readonly chunks: CognitiveChunk[];
  readonly edges: readonly ChunkGraphEdge[];
  readonly importanceAnnotations?: readonly ChunkImportanceAnnotation[];
}

export class Attention {
  readonly #idGenerator: () => Promise<number>;
  readonly #waveReflection: WaveReflection;
  readonly #workingMemory: WorkingMemory;

  public constructor(
    capacity: number,
    generationDecayFactor: number,
    idGenerator: () => Promise<number>,
  ) {
    this.#idGenerator = idGenerator;
    this.#waveReflection = new WaveReflection(generationDecayFactor);
    this.#workingMemory = new WorkingMemory(capacity);
  }

  public get capacity(): number {
    return this.#workingMemory.capacity;
  }

  public createChunkBatchContext(input?: {
    includeCurrentFragment?: boolean;
  }): ChunkBatchContext {
    const chunks = this.#workingMemory.getChunksForPrompt(
      input?.includeCurrentFragment ?? true,
    );

    return {
      visibleChunkIds: chunks.map((chunk) => chunk.id),
      workingMemoryPrompt: this.#workingMemory.formatForPrompt(
        input?.includeCurrentFragment ?? true,
      ),
    };
  }

  public async acceptChunkBatch(
    chunkBatch: ChunkBatch,
  ): Promise<ChunkGraphDelta> {
    const delta = await assembleChunkBatch({
      chunkBatch,
      generation: this.#workingMemory.generation,
      idGenerator: this.#idGenerator,
      visibleChunks: this.#workingMemory.getChunks(),
    });

    this.#workingMemory.addChunks(delta.chunks);

    return delta;
  }

  public completeFragment(input: {
    allChunks: readonly CognitiveChunk[];
    getSuccessorChunkIds: (chunkId: number) => readonly number[];
  }): void {
    const previousFragmentChunks = this.#workingMemory.getAllChunksForSaving();
    const latestChunkIds = previousFragmentChunks.map((chunk) => chunk.id);
    const extraChunks = this.#waveReflection.selectTopChunks({
      allChunks: input.allChunks,
      capacity: this.#workingMemory.capacity,
      getSuccessorChunkIds: input.getSuccessorChunkIds,
      latestChunkIds,
    });

    this.#workingMemory.setRetainedChunks({
      extraChunks,
      previousFragmentChunks,
    });
    this.#workingMemory.finalizeFragment();
  }

  public clear(): void {
    this.#workingMemory.clear();
  }
}

async function assembleChunkBatch(input: {
  chunkBatch: ChunkBatch;
  generation: number;
  idGenerator: () => Promise<number>;
  visibleChunks: readonly CognitiveChunk[];
}): Promise<ChunkGraphDelta> {
  const tempIdRecord: Record<string, CognitiveChunk> = Object.create(
    null,
  ) as Record<string, CognitiveChunk>;

  for (const [index, chunk] of input.chunkBatch.chunks.entries()) {
    chunk.id = await input.idGenerator();
    chunk.generation = input.generation;

    const tempId = input.chunkBatch.tempIds[index];

    if (tempId === undefined || tempId === "") {
      continue;
    }

    tempIdRecord[tempId] = chunk;
  }

  const visibleChunks = [...input.visibleChunks, ...input.chunkBatch.chunks];
  const edges: ChunkGraphEdge[] = [];

  for (const link of input.chunkBatch.links) {
    const fromChunk = resolveChunkReference(
      link.from,
      tempIdRecord,
      visibleChunks,
    );
    const toChunk = resolveChunkReference(link.to, tempIdRecord, visibleChunks);

    if (fromChunk === undefined || toChunk === undefined) {
      continue;
    }

    const [edgeFromId, edgeToId] =
      fromChunk.id > toChunk.id
        ? ([fromChunk.id, toChunk.id] as const)
        : ([toChunk.id, fromChunk.id] as const);

    attachLink(visibleChunks, edgeToId, edgeFromId);
    if (link.strength === undefined) {
      edges.push({
        fromId: edgeFromId,
        toId: edgeToId,
      });
      continue;
    }

    edges.push({
      fromId: edgeFromId,
      strength: link.strength,
      toId: edgeToId,
    });
  }

  return {
    chunks: input.chunkBatch.chunks,
    edges,
    ...(input.chunkBatch.importanceAnnotations === undefined
      ? {}
      : {
          importanceAnnotations: input.chunkBatch.importanceAnnotations,
        }),
  };
}

function resolveChunkReference(
  reference: number | string,
  tempIdRecord: Readonly<Record<string, CognitiveChunk>>,
  visibleChunks: readonly CognitiveChunk[],
): CognitiveChunk | undefined {
  if (typeof reference === "string") {
    return tempIdRecord[reference];
  }

  return visibleChunks.find((chunk) => chunk.id === reference);
}

function attachLink(
  visibleChunks: readonly CognitiveChunk[],
  targetChunkId: number,
  sourceChunkId: number,
): void {
  for (const chunk of visibleChunks) {
    if (chunk.id !== targetChunkId) {
      continue;
    }

    if (!chunk.links.includes(sourceChunkId)) {
      chunk.links.push(sourceChunkId);
    }

    return;
  }
}

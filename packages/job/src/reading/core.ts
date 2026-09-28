import { Attention } from "./attention/core.js";
import {
  extractBookCoherenceChunkBatch,
  extractUserFocusedChunkBatch,
} from "./chunk-batch/extract.js";
import type { ChunkBatchOptions } from "./chunk-batch/types.js";
import type {
  ReaderChunk,
  ReaderGraphDelta,
  ReaderOptions,
  ReaderSentence,
} from "./types.js";

export class Reader<S extends string> {
  readonly #attention: Attention;
  readonly #chunkBatchOptions: ChunkBatchOptions<S>;

  public constructor(options: ReaderOptions<S>) {
    this.#attention = new Attention(
      options.attention.capacity,
      options.attention.generationDecayFactor,
      options.attention.idGenerator,
    );
    this.#chunkBatchOptions = {
      extractionGuidance: options.extractionGuidance,
      llm: options.llm,
      scopes: options.scopes,
      sentenceTextSource: options.sentenceTextSource,
      ...(options.userLanguage === undefined
        ? {}
        : {
            userLanguage: options.userLanguage,
          }),
    };
  }

  public get capacity(): number {
    return this.#attention.capacity;
  }

  public async extractUserFocused(input: {
    readonly sentences: readonly ReaderSentence[];
    readonly text: string;
  }): Promise<{
    readonly delta: ReaderGraphDelta;
    readonly fragmentSummary: string;
  }> {
    const context = this.#attention.createChunkBatchContext();
    const result = await extractUserFocusedChunkBatch(this.#chunkBatchOptions, {
      sentences: input.sentences,
      text: input.text,
      visibleChunkIds: context.visibleChunkIds,
      workingMemoryPrompt: context.workingMemoryPrompt,
    });

    return {
      delta: await this.#attention.acceptChunkBatch(result.chunkBatch),
      fragmentSummary: result.fragmentSummary,
    };
  }

  public async extractBookCoherence(input: {
    readonly sentences: readonly ReaderSentence[];
    readonly text: string;
    readonly userFocusedChunks: readonly ReaderChunk[];
  }): Promise<ReaderGraphDelta> {
    const context = this.#attention.createChunkBatchContext({
      includeCurrentFragment: false,
    });
    const linkableChunkIds = [
      ...context.visibleChunkIds,
      ...input.userFocusedChunks.map((chunk) => chunk.id),
    ];
    const chunkBatch = await extractBookCoherenceChunkBatch(
      this.#chunkBatchOptions,
      {
        sentences: input.sentences,
        text: input.text,
        userFocusedChunks: input.userFocusedChunks,
        visibleChunkIds: linkableChunkIds,
        workingMemoryPrompt: context.workingMemoryPrompt,
      },
    );

    return await this.#attention.acceptChunkBatch(chunkBatch);
  }

  public completeFragment(input: {
    readonly allChunks: readonly ReaderChunk[];
    readonly getSuccessorChunkIds: (chunkId: number) => readonly number[];
  }): void {
    this.#attention.completeFragment(input);
  }

  public clear(): void {
    this.#attention.clear();
  }
}

import type { CognitiveChunk } from "../chunk-batch/types.js";

export class WorkingMemory {
  readonly #capacity: number;
  readonly #currentFragmentChunks: CognitiveChunk[] = [];
  readonly #previousFragmentChunks: CognitiveChunk[] = [];
  readonly #extraChunks: CognitiveChunk[] = [];
  #generation = 0;

  public constructor(capacity: number) {
    this.#capacity = capacity;
  }

  public get capacity(): number {
    return this.#capacity;
  }

  public get generation(): number {
    return this.#generation;
  }

  public addChunks(chunks: readonly CognitiveChunk[]): void {
    this.#currentFragmentChunks.push(...chunks);
  }

  public setRetainedChunks(input: {
    readonly extraChunks: readonly CognitiveChunk[];
    readonly previousFragmentChunks: readonly CognitiveChunk[];
  }): void {
    this.#previousFragmentChunks.splice(
      0,
      this.#previousFragmentChunks.length,
      ...input.previousFragmentChunks,
    );
    this.#extraChunks.splice(0, this.#extraChunks.length, ...input.extraChunks);
  }

  public finalizeFragment(): CognitiveChunk[] {
    const finishedChunks = [...this.#currentFragmentChunks];

    this.#currentFragmentChunks.splice(0, this.#currentFragmentChunks.length);
    this.#generation += 1;

    return finishedChunks;
  }

  public getChunks(): CognitiveChunk[] {
    return [
      ...this.#currentFragmentChunks,
      ...this.#previousFragmentChunks,
      ...this.#extraChunks,
    ];
  }

  public getAllChunksForSaving(): CognitiveChunk[] {
    return [...this.#currentFragmentChunks];
  }

  public getChunksForPrompt(includeCurrentFragment = true): CognitiveChunk[] {
    return includeCurrentFragment
      ? this.getChunks()
      : [...this.#previousFragmentChunks, ...this.#extraChunks];
  }

  public formatForPrompt(includeCurrentFragment = true): string {
    const chunks = this.getChunksForPrompt(includeCurrentFragment);

    if (chunks.length === 0) {
      return "(empty)";
    }

    return chunks
      .map((chunk) => `${chunk.id}. [${chunk.label}] - ${chunk.content}`)
      .join("\n");
  }

  public clear(): void {
    this.#currentFragmentChunks.splice(0, this.#currentFragmentChunks.length);
    this.#previousFragmentChunks.splice(0, this.#previousFragmentChunks.length);
    this.#extraChunks.splice(0, this.#extraChunks.length);
  }
}

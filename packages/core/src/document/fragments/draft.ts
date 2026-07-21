import type { FragmentRecord, SentenceId, SentenceRecord } from "../types.js";

export class FragmentDraft {
  #committed = false;
  readonly #serialId: number;
  readonly #discard: () => void;
  readonly #finalize: (
    fragmentId: number,
    startSentenceIndex: number,
    summary: string,
    sentences: readonly SentenceRecord[],
  ) => Promise<FragmentRecord | undefined>;
  readonly #fragmentId: number;
  readonly #sentences: SentenceRecord[] = [];
  #summary = "";
  readonly #startSentenceIndex: number;

  public constructor(
    serialId: number,
    fragmentId: number,
    startSentenceIndex: number,
    callbacks: {
      readonly discard: () => void;
      readonly finalize: (
        fragmentId: number,
        startSentenceIndex: number,
        summary: string,
        sentences: readonly SentenceRecord[],
      ) => Promise<FragmentRecord | undefined>;
    },
  ) {
    this.#serialId = serialId;
    this.#discard = callbacks.discard;
    this.#finalize = callbacks.finalize;
    this.#fragmentId = fragmentId;
    this.#startSentenceIndex = startSentenceIndex;
  }

  public addSentence(text: string, wordsCount: number): SentenceId {
    this.#assertActive();
    const sentenceIndex = this.#startSentenceIndex + this.#sentences.length;

    this.#sentences.push({
      text,
      wordsCount,
    });

    return [this.#serialId, sentenceIndex];
  }

  public async commit(): Promise<FragmentRecord | undefined> {
    this.#assertActive();
    this.#committed = true;

    return await this.#finalize(
      this.#fragmentId,
      this.#startSentenceIndex,
      this.#summary,
      this.#sentences,
    );
  }

  public discard(): void {
    this.#assertActive();
    this.#committed = true;
    this.#discard();
  }

  public setSummary(summary: string): void {
    this.#assertActive();
    this.#summary = summary;
  }

  public get fragmentId(): number {
    return this.#fragmentId;
  }

  #assertActive(): void {
    if (this.#committed) {
      throw new Error("Fragment draft is already finalized");
    }
  }
}

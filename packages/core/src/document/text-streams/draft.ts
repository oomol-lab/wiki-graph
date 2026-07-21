import {
  Sentence,
  type FragmentRecord,
  type SentenceId,
  type SentenceRecord,
} from "../types.js";

export class TextStreamDraft {
  #committed = false;
  readonly #discard: () => void;
  readonly #finalize: (
    startSentenceIndex: number,
    summary: string,
    sentences: readonly SentenceRecord[],
  ) => Promise<FragmentRecord | undefined>;
  readonly #sentences: SentenceRecord[] = [];
  readonly #serialId: number;
  readonly #startSentenceIndex: number;
  #summary = "";

  public constructor(
    serialId: number,
    startSentenceIndex: number,
    callbacks: {
      readonly discard: () => void;
      readonly finalize: (
        startSentenceIndex: number,
        summary: string,
        sentences: readonly SentenceRecord[],
      ) => Promise<FragmentRecord | undefined>;
    },
  ) {
    this.#discard = callbacks.discard;
    this.#finalize = callbacks.finalize;
    this.#serialId = serialId;
    this.#startSentenceIndex = startSentenceIndex;
  }

  public addSentence(
    text: string,
    wordsCount: number,
    location?: {
      readonly byteOffset: number;
      readonly byteLength: number;
    },
  ): SentenceId {
    this.#assertActive();
    const sentenceIndex = this.#startSentenceIndex + this.#sentences.length;
    const sentence = new Sentence(text, wordsCount);

    if (location !== undefined) {
      Object.assign(sentence, {
        byteLength: location.byteLength,
        byteOffset: location.byteOffset,
      });
    }

    this.#sentences.push(sentence);

    return [this.#serialId, sentenceIndex];
  }

  public async commit(): Promise<FragmentRecord | undefined> {
    this.#assertActive();
    this.#committed = true;

    return await this.#finalize(
      this.#startSentenceIndex,
      this.#summary,
      this.#sentences,
    );
  }

  public async commitWithText(
    text: string,
  ): Promise<FragmentRecord | undefined> {
    this.#assertActive();
    this.#committed = true;

    return await this.#finalize(
      this.#startSentenceIndex,
      text,
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
    return this.#startSentenceIndex;
  }

  #assertActive(): void {
    if (this.#committed) {
      throw new Error("Text stream draft is already finalized");
    }
  }
}

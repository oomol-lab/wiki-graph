import { createProgressReporter, type ProgressReporter } from "./reporter.js";
import type {
  SerialDiscoveryItem,
  SpineDigestOperation,
  SpineDigestProgressCallback,
} from "./types.js";

export interface CreateDigestProgressTrackerOptions {
  readonly onProgress?: SpineDigestProgressCallback;
  readonly operation: SpineDigestOperation;
}

export class DigestProgressTracker {
  readonly #reporter: ProgressReporter;
  #completedWords = 0;
  readonly #completedWordsBySerial = new Map<number, number>();
  #totalWords = 0;
  #discoverySettled = false;

  public constructor(options: CreateDigestProgressTrackerOptions) {
    this.#reporter = createProgressReporter(
      options.operation,
      options.onProgress,
    );
  }

  public createSerialTracker(input: {
    readonly id: number;
  }): SerialProgressTracker {
    return new SerialProgressTracker(this, input.id);
  }

  public async discoverSerials(
    serials: readonly SerialDiscoveryItem[],
  ): Promise<void> {
    this.#ensureDiscoveryOpen();
    this.#discoverySettled = true;
    this.#totalWords = serials.reduce((sum, serial) => sum + serial.words, 0);

    await this.#reporter.emit({
      available: true,
      serials,
      type: "serials-discovered",
    });
    await this.#emitDigestProgress();
  }

  public async markDiscoveryUnavailable(): Promise<void> {
    this.#ensureDiscoveryOpen();
    this.#discoverySettled = true;

    await this.#reporter.emit({
      available: false,
      serials: [],
      type: "serials-discovered",
    });
  }

  public async completeSerial(words: number): Promise<void> {
    const nextTotalWords = Math.max(
      this.#totalWords,
      this.#completedWords,
      words,
    );

    if (nextTotalWords === this.#totalWords) {
      return;
    }

    this.#totalWords = nextTotalWords;
    await this.#emitDigestProgress();
  }

  public async emitSerialProgress(input: {
    readonly completedFragments: number;
    readonly completedWords: number;
    readonly id: number;
  }): Promise<void> {
    const previousCompletedWords =
      this.#completedWordsBySerial.get(input.id) ?? 0;

    if (input.completedWords !== previousCompletedWords) {
      this.#completedWordsBySerial.set(input.id, input.completedWords);
      this.#completedWords += input.completedWords - previousCompletedWords;

      if (this.#completedWords > this.#totalWords) {
        this.#totalWords = this.#completedWords;
      }
    }

    await this.#reporter.emit({
      completedFragments: input.completedFragments,
      completedWords: input.completedWords,
      id: input.id,
      type: "serial-progress",
    });

    if (input.completedWords !== previousCompletedWords) {
      await this.#emitDigestProgress();
    }
  }

  async #emitDigestProgress(): Promise<void> {
    await this.#reporter.emit({
      completedWords: this.#completedWords,
      totalWords: this.#totalWords,
      type: "digest-progress",
    });
  }

  #ensureDiscoveryOpen(): void {
    if (this.#discoverySettled) {
      throw new Error("Serial discovery has already been reported");
    }
  }
}

export class SerialProgressTracker {
  #completedFragments = 0;
  readonly #digestTracker: DigestProgressTracker;
  #completedWords = 0;
  readonly #id: number;

  public constructor(digestTracker: DigestProgressTracker, id: number) {
    this.#digestTracker = digestTracker;
    this.#id = id;
  }

  public async begin(_input?: {
    readonly fragments: number;
    readonly words: number;
  }): Promise<void> {}

  public async advance(wordsCount: number): Promise<void> {
    this.#completedWords += wordsCount;
    this.#completedFragments += 1;
    await this.#digestTracker.emitSerialProgress({
      completedFragments: this.#completedFragments,
      completedWords: this.#completedWords,
      id: this.#id,
    });
  }

  public async complete(finalWordsCount = 0): Promise<void> {
    this.#completedWords += finalWordsCount;
    if (finalWordsCount > 0) {
      this.#completedFragments += 1;
    }

    await this.#digestTracker.emitSerialProgress({
      completedFragments: this.#completedFragments,
      completedWords: this.#completedWords,
      id: this.#id,
    });
    await this.#digestTracker.completeSerial(this.#completedWords);
  }
}

export function createDigestProgressTracker(
  options: CreateDigestProgressTrackerOptions,
): DigestProgressTracker {
  return new DigestProgressTracker(options);
}

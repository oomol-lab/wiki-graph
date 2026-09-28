import type { Clue } from "./clue.js";
import type { CompressionVersion, ReviewResult } from "./types.js";

export class CompressionLog {
  public constructor(
    _serialId: number,
    _groupId: number,
    _options: Readonly<Record<string, unknown>>,
  ) {}

  public initialize(_clues: readonly Clue[]): Promise<void> {
    return Promise.resolve();
  }

  public appendIterationHeader(
    _iteration: number,
    _feedback: string | undefined,
  ): Promise<void> {
    return Promise.resolve();
  }

  public appendCompressionResult(_input: {
    readonly compressedText: string;
    readonly thinkingText: string;
  }): Promise<void> {
    return Promise.resolve();
  }

  public appendLanguageMismatch(_input: {
    readonly detectedLanguageCode: string;
    readonly review: ReviewResult;
    readonly targetLanguageCode: string;
    readonly userLanguage: string | undefined;
  }): Promise<void> {
    return Promise.resolve();
  }

  public appendFinalSelection(
    _version: CompressionVersion,
    _originalLength: number,
  ): Promise<void> {
    return Promise.resolve();
  }
}

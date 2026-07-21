import type { Language } from "../../runtime/common/language.js";
import type { WikiGraphScope } from "../../runtime/common/llm-scope.js";
import type { Document } from "../../document/index.js";
import type { LLM } from "../../external/llm/index.js";
import type { ReaderSegmenter } from "../reader/index.js";

export const DEFAULT_COMPRESSION_RATIO = 0.2;
export const DEFAULT_FRAGMENT_WORDS_COUNT = 320;
export const DEFAULT_GENERATION_DECAY_FACTOR = 0.5;
export const DEFAULT_GROUP_WORDS_COUNT = 3840;
export const DEFAULT_MAX_CLUES = 10;
export const DEFAULT_MAX_ITERATIONS = 5;
export const DEFAULT_WORKING_MEMORY_CAPACITY = 7;

export interface GenerateSerialOptions {
  readonly extractionPrompt: string;
  readonly userLanguage?: Language;
}

export type BuildSerialTopologyOptions = GenerateSerialOptions;

export interface BuildSerialSummaryOptions {
  readonly userLanguage?: Language;
}

export interface WriteSerialSourceOptions {
  readonly segmenter?: ReaderSegmenter;
}

export interface SerialDiscovery {
  readonly fragments: number;
  readonly words: number;
}

export interface SerialProgressSink {
  begin?(input?: {
    readonly fragments: number;
    readonly words: number;
  }): Promise<void>;
  advance(wordsCount: number): Promise<void>;
  complete(finalWordsCount?: number): Promise<void>;
}

export type CreateSerialOptions = GenerateSerialOptions;

export interface SerialGenerationOptions {
  readonly document?: Document;
  readonly llm: LLM<WikiGraphScope>;
  readonly logDirPath?: string;
  readonly segmenter?: ReaderSegmenter;
  /** @deprecated Use `document` instead. */
  readonly workspace?: Document;
}

export type SerialHubOptions = SerialGenerationOptions;

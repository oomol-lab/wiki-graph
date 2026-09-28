import type { JobLlmMessage } from "../ports.js";
export type { JobLlmMessage } from "../ports.js";

export type SentenceId = readonly [number, number];
export const Language = {
  Arabic: "Arabic",
  Danish: "Danish",
  Dutch: "Dutch",
  English: "English",
  Finnish: "Finnish",
  French: "French",
  German: "German",
  Hindi: "Hindi",
  Indonesian: "Indonesian",
  Italian: "Italian",
  Japanese: "Japanese",
  Korean: "Korean",
  Norwegian: "Norwegian",
  Polish: "Polish",
  Portuguese: "Portuguese",
  Russian: "Russian",
  SimplifiedChinese: "Simplified Chinese",
  Spanish: "Spanish",
  Swedish: "Swedish",
  Thai: "Thai",
  TraditionalChinese: "Traditional Chinese",
  Turkish: "Turkish",
  Vietnamese: "Vietnamese",
} as const;
export type Language = string;

export enum ChunkRetention {
  Verbatim = "verbatim",
  Detailed = "detailed",
  Focused = "focused",
  Relevant = "relevant",
}

export enum ChunkImportance {
  Critical = "critical",
  Important = "important",
  Helpful = "helpful",
}

export function expectChunkRetention(value: string): ChunkRetention {
  if (Object.values(ChunkRetention).includes(value as ChunkRetention)) {
    return value as ChunkRetention;
  }
  throw new Error(`Unknown chunk retention ${value}.`);
}

export function expectChunkImportance(value: string): ChunkImportance {
  if (Object.values(ChunkImportance).includes(value as ChunkImportance)) {
    return value as ChunkImportance;
  }
  throw new Error(`Unknown chunk importance ${value}.`);
}

export interface ChunkRecord {
  readonly content: string;
  readonly generation: number;
  readonly id: number;
  readonly importance?: ChunkImportance;
  readonly label: string;
  readonly retention?: ChunkRetention;
  readonly sentenceId: SentenceId;
  readonly sentenceIds: readonly SentenceId[];
  readonly weight: number;
  readonly wordsCount: number;
}

export interface ReadingEdgeRecord {
  readonly fromId: number;
  readonly strength?: string;
  readonly toId: number;
  readonly weight: number;
}

export interface SentenceGroupRecord {
  readonly endSentenceIndex: number;
  readonly fragmentId?: number;
  readonly groupId: number;
  readonly serialId: number;
  readonly startSentenceIndex: number;
}

export interface FragmentRecord {
  readonly fragmentId: number;
  readonly sentences: readonly {
    readonly text: string;
    readonly wordsCount: number;
  }[];
  readonly serialId: number;
  readonly summary?: string;
}

export interface ReadonlySerialFragments {
  getFragment(fragmentId: number): Promise<FragmentRecord>;
  listFragmentIds(): Promise<readonly number[]>;
  listSentencesInRange?(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<readonly { readonly text: string; readonly wordsCount: number }[]>;
}

export interface ReadingLlmRequestOptions<S extends string> {
  readonly retryIndex?: number;
  readonly retryMax?: number;
  readonly scope?: S;
  readonly useCache?: boolean;
}

export interface ReadingLlm<S extends string> {
  loadSystemPrompt(
    templateName: string,
    context?: Readonly<Record<string, unknown>>,
  ): string;
  request(
    messages: readonly JobLlmMessage[],
    options?: ReadingLlmRequestOptions<S>,
  ): Promise<string>;
  withContext<T>(operation: (context: ReadingLlm<S>) => Promise<T>): Promise<T>;
}

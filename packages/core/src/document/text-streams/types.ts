import type { FragmentRecord, SentenceId, SentenceRecord } from "../types.js";

export const DEFAULT_FRAGMENT_WORDS_COUNT = 600;
export const TEXT_STREAM_KIND = {
  source: 1,
  summary: 2,
} as const;

export type TextStreamName = keyof typeof TEXT_STREAM_KIND;

export interface TextSentenceLocation {
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly sentenceIndex: number;
  readonly wordsCount: number;
}

export interface TextStreamDraftState {
  draftOpen: boolean;
  nextSentenceIndex?: number;
}

export interface TextStreamFileAccess {
  deleteTree(path: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
  listFiles(path: string): Promise<readonly string[]>;
  readFile(path: string): Promise<Uint8Array | undefined>;
  writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean },
  ): Promise<void>;
}

export interface TextStreamSentenceSegmenter {
  pipe(stream: Iterable<string>): AsyncIterable<{
    readonly offset: number;
    readonly text: string;
    readonly wordsCount: number;
  }>;
}

export interface WriteTextStreamOptions {
  readonly segmenter?: TextStreamSentenceSegmenter;
}
export interface ReadonlyTextStreams {
  getSentence(sentenceId: SentenceId): Promise<string>;
  getSerial(serialId: number): ReadonlySerialTextStream;
  getSummarySerial(serialId: number): ReadonlySerialTextStream;
}

export interface ReadonlySerialTextStream {
  getFragment(fragmentId: number): Promise<FragmentRecord>;
  getSentence?(sentenceIndex: number): Promise<SentenceRecord>;
  listSentencesInRange?(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<readonly SentenceRecord[]>;
  listFragmentIds(): Promise<readonly number[]>;
  listSentences?(): Promise<readonly SentenceRecord[]>;
  readText?(): Promise<string | undefined>;
  readTextInRange?(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<string | undefined>;
  readonly path: string;
  readonly serialId: number;
}

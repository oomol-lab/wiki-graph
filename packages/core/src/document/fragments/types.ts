import type { FragmentRecord, SentenceId, SentenceRecord } from "../types.js";

export const SERIAL_DIRECTORY_PREFIX = "serial-";
export const FRAGMENT_FILE_PATTERN = /^fragment_(\d+)\.json$/;
export const DEFAULT_FRAGMENT_WORDS_COUNT = 600;

export interface FragmentFileContent {
  readonly summary: string;
  readonly sentences: readonly SentenceRecord[];
}

export interface FragmentWriter {
  write(path: string, content: string): Promise<void>;
}

export interface FragmentFileAccess {
  ensureDirectory(path: string): Promise<void>;
  listFileContents?(path: string): Promise<ReadonlyMap<string, Uint8Array>>;
  listFiles(path: string): Promise<readonly string[]>;
  readFile(path: string): Promise<Uint8Array | undefined>;
}
export interface ReadonlyFragments {
  getSerial(serialId: number): ReadonlySerialFragments;
  getSummarySerial(serialId: number): ReadonlySerialFragments;
  getSentence(sentenceId: SentenceId): Promise<string>;
  getSummary(serialId: number, fragmentId: number): Promise<string>;
  getWordsCount(serialId: number, fragmentId: number): Promise<number>;
  readonly path: string;
}

export interface TextStreamWriteOptions {
  readonly maxWordsCount?: number;
}

export interface ReadonlySerialFragments {
  getFragment(fragmentId: number): Promise<FragmentRecord>;
  listFragmentIds(): Promise<readonly number[]>;
  readonly serialId: number;
  readonly path: string;
}

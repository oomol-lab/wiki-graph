export interface LegacyFragmentFile {
  readonly sentences: ReadonlyArray<{
    readonly text: string;
    readonly wordsCount: number;
  }>;
  readonly summary: string;
}

export interface LegacyFragmentRecord {
  readonly content: LegacyFragmentFile;
  readonly fragmentId: number;
  readonly path: string;
  readonly signature: string;
}

export interface SentenceIndexRemap {
  get(fragmentId: number, sentenceIndex: number): number | undefined;
  readonly serialId: number;
}

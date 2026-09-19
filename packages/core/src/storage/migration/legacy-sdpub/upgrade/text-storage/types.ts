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
  readonly signature: string;
}

export interface SentenceIndexRemap {
  locateAtCharacterOffset(
    fragmentId: number,
    offset: number,
  ):
    | {
        readonly sentenceIndex: number;
        readonly sentenceOffset: number;
      }
    | undefined;
  get(fragmentId: number, sentenceIndex: number): number | undefined;
  readonly serialId: number;
}

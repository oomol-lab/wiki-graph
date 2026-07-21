export type TextStream = AsyncIterable<string> | Iterable<string>;

export interface SentenceStreamItem {
  readonly offset: number;
  readonly text: string;
  readonly wordsCount: number;
}

export interface SentenceStreamAdapter {
  pipe(stream: TextStream): AsyncIterable<SentenceStreamItem>;
}

export interface SegmentTextStreamOptions {
  readonly adapter?: SentenceStreamAdapter;
}

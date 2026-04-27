export type SourceTextStream = AsyncIterable<string> | Iterable<string>;

export interface SourceAsset {
  readonly path: string;
  readonly mediaType: string;
  readonly data: Uint8Array;
}

export interface SourceSection {
  readonly hasContent: boolean;
  readonly id: string;
  readonly title?: string | undefined;
  readonly wordsCount?: number | undefined;
  readonly children: readonly SourceSection[];
  open(): Promise<SourceTextStream>;
}

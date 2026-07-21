import type { BookMeta, SourceFormat } from "./meta.js";
import type { SourceAsset, SourceSection } from "./types.js";

export interface SourceDocument {
  readMeta(): Promise<BookMeta>;
  readCover(): Promise<SourceAsset | undefined>;
  readSections(): Promise<readonly SourceSection[]>;
}

export interface SourceAdapter {
  readonly format: SourceFormat;
  openSession<T>(
    path: string,
    operation: (document: SourceDocument) => Promise<T>,
  ): Promise<T>;
}

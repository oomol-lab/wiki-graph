export {
  BOOK_META_VERSION,
  SOURCE_FORMATS,
  bookMetaSchema,
  sourceFormatSchema,
  type BookMeta,
  type SourceFormat,
} from "./meta.js";
export type { SourceAdapter, SourceDocument } from "./adapter.js";
export { SourceInputError } from "./error.js";
export { EpubSourceAdapter, EPUB_SOURCE_ADAPTER } from "./epub/index.js";
export { PcexSourceAdapter, type PcexSourceOptions } from "./pcex/index.js";
export {
  MARKDOWN_SOURCE_ADAPTER,
  PlainTextSourceAdapter,
  TXT_SOURCE_ADAPTER,
} from "./plain-text.js";
export {
  parseSourceTextJsonl,
  type ParsedSourceTextJsonl,
} from "./provenance.js";
export {
  TOC_FILE_VERSION,
  tocFileSchema,
  tocItemSchema,
  type TocFile,
  type TocItem,
} from "./toc.js";
export type {
  SourceAsset,
  SourceSection,
  SourceSectionContent,
  SourceTextStream,
} from "./types.js";

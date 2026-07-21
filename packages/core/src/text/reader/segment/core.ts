import { createDefaultSentenceStreamAdapter } from "./intl-segmenter.js";
import type {
  SegmentTextStreamOptions,
  SentenceStreamItem,
  TextStream,
} from "./types.js";

export function segmentTextStream(
  stream: TextStream,
  options?: SegmentTextStreamOptions,
): AsyncIterable<SentenceStreamItem> {
  const adapter = options?.adapter ?? createDefaultSentenceStreamAdapter();

  return adapter.pipe(stream);
}

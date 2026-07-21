import type {
  SentenceStreamAdapter,
  SentenceStreamItem,
  TextStream,
} from "./types.js";

const SENTENCE_BOUNDARY_PATTERN =
  /(?:[.!?。！？…]+|(?:\r?\n)\s*(?:\r?\n)?|[.!?。！？…]+["'”’」』】）》〉〕〗]*)$/u;

class IntlSegmenterSentenceStreamAdapter implements SentenceStreamAdapter {
  readonly #graphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  readonly #sentenceSegmenter = new Intl.Segmenter(undefined, {
    granularity: "sentence",
  });
  readonly #wordSegmenter = new Intl.Segmenter(undefined, {
    granularity: "word",
  });

  public async *pipe(stream: TextStream): AsyncIterable<SentenceStreamItem> {
    let buffer = "";
    let offset = 0;

    for await (const chunk of stream) {
      if (chunk === "") {
        continue;
      }

      buffer += chunk;

      const { remainder, sentences } = this.#drainSentences(buffer, false);
      buffer = remainder;

      for (const sentenceText of sentences) {
        yield {
          offset,
          text: sentenceText,
          wordsCount: this.#countWords(sentenceText),
        };
        offset += sentenceText.length;
      }
    }

    const { sentences } = this.#drainSentences(buffer, true);

    for (const sentenceText of sentences) {
      yield {
        offset,
        text: sentenceText,
        wordsCount: this.#countWords(sentenceText),
      };
      offset += sentenceText.length;
    }
  }

  #drainSentences(
    buffer: string,
    flushAll: boolean,
  ): {
    readonly remainder: string;
    readonly sentences: readonly string[];
  } {
    if (buffer.trim() === "") {
      return {
        remainder: "",
        sentences: [],
      };
    }

    const segments = Array.from(this.#sentenceSegmenter.segment(buffer));

    if (segments.length === 0) {
      return {
        remainder: buffer,
        sentences: [],
      };
    }

    if (flushAll || this.#endsWithSentenceBoundary(buffer)) {
      return {
        remainder: "",
        sentences: segments
          .map((segment) => segment.segment.trim())
          .filter((segment) => segment !== ""),
      };
    }

    const lastSegment = segments[segments.length - 1];

    if (lastSegment === undefined) {
      return {
        remainder: buffer,
        sentences: [],
      };
    }

    return {
      remainder: buffer.slice(lastSegment.index),
      sentences: segments
        .slice(0, -1)
        .map((segment) => segment.segment.trim())
        .filter((segment) => segment !== ""),
    };
  }

  #countWords(text: string): number {
    let wordsCount = 0;

    for (const segment of this.#wordSegmenter.segment(text)) {
      if ("isWordLike" in segment && segment.isWordLike) {
        wordsCount += 1;
      }
    }

    if (wordsCount > 0) {
      return wordsCount;
    }

    return this.#countGraphemes(text);
  }

  #countGraphemes(text: string): number {
    let unitCount = 0;

    for (const _segment of this.#graphemeSegmenter.segment(text)) {
      unitCount += 1;
    }

    return unitCount;
  }

  #endsWithSentenceBoundary(buffer: string): boolean {
    return SENTENCE_BOUNDARY_PATTERN.test(buffer.trimEnd());
  }
}

export function createDefaultSentenceStreamAdapter(): SentenceStreamAdapter {
  return new IntlSegmenterSentenceStreamAdapter();
}

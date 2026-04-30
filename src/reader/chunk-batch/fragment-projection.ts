import type { SentenceId } from "../../document/index.js";
import type { ChunkExtractionSentence } from "./types.js";

const SENTENCE_SEPARATOR = " ";

const STANDARDIZATION_MAP = {
  '"': "＂",
  "\\": "＼",
} as const;

export interface TextSpan {
  readonly length: number;
  readonly offset: number;
}

export interface ProjectedFragmentSentence {
  readonly endOffset: number;
  readonly projectedText: string;
  readonly rawText: string;
  readonly sentenceId: SentenceId;
  readonly startOffset: number;
  readonly wordsCount: number;
}

export class FragmentProjection {
  readonly #projectedText: string;
  readonly #rawText: string;
  readonly #sentences: readonly ProjectedFragmentSentence[];

  public constructor(sentences: readonly ChunkExtractionSentence[]) {
    const projectedSentences: ProjectedFragmentSentence[] = [];
    let rawText = "";
    let projectedText = "";
    let offset = 0;

    for (const [index, sentence] of sentences.entries()) {
      if (index > 0) {
        rawText += SENTENCE_SEPARATOR;
        projectedText += SENTENCE_SEPARATOR;
        offset += SENTENCE_SEPARATOR.length;
      }

      const projectedSentenceText = projectFragmentText(sentence.text);
      const startOffset = offset;
      const endOffset = startOffset + projectedSentenceText.length;

      rawText += sentence.text;
      projectedText += projectedSentenceText;
      projectedSentences.push({
        endOffset,
        projectedText: projectedSentenceText,
        rawText: sentence.text,
        sentenceId: sentence.sentenceId,
        startOffset,
        wordsCount: sentence.wordsCount,
      });
      offset = endOffset;
    }

    this.#rawText = rawText;
    this.#projectedText = projectedText;
    this.#sentences = projectedSentences;
  }

  public get projectedText(): string {
    return this.#projectedText;
  }

  public get rawText(): string {
    return this.#rawText;
  }

  public get sentences(): readonly ProjectedFragmentSentence[] {
    return this.#sentences;
  }

  public findExactMatches(text: string): readonly TextSpan[] {
    const query = projectFragmentText(text).trim();

    if (query === "") {
      return [];
    }

    const matches: TextSpan[] = [];
    let startIndex = 0;

    while (startIndex <= this.#projectedText.length - query.length) {
      const offset = this.#projectedText.indexOf(query, startIndex);

      if (offset === -1) {
        break;
      }

      matches.push({
        length: query.length,
        offset,
      });
      startIndex = offset + 1;
    }

    return matches;
  }

  public projectText(text: string): string {
    return projectFragmentText(text);
  }

  public resolveSentenceIds(span: TextSpan): SentenceId[] {
    if (span.length <= 0) {
      return [];
    }

    const rangeStart = span.offset;
    const rangeEnd = span.offset + span.length;

    return this.#sentences
      .filter(
        (sentence) =>
          sentence.endOffset > rangeStart && sentence.startOffset < rangeEnd,
      )
      .map((sentence) => sentence.sentenceId);
  }
}

export function projectFragmentText(text: string): string {
  let result = "";

  for (const char of text) {
    result +=
      STANDARDIZATION_MAP[char as keyof typeof STANDARDIZATION_MAP] ?? char;
  }

  return result;
}

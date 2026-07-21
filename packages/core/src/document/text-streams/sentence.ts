import { Sentence, type SentenceRecord } from "../types.js";
import type { TextStreamSentenceSegmenter } from "./types.js";

export async function splitTextIntoSentenceSpans(
  text: string,
  segmenter: TextStreamSentenceSegmenter | undefined,
): Promise<
  ReadonlyArray<
    SentenceRecord & {
      readonly byteOffset: number;
      readonly byteLength: number;
    }
  >
> {
  if (segmenter !== undefined) {
    return await splitTextIntoCustomSentenceSpans(text, segmenter);
  }

  const spans: Array<
    SentenceRecord & {
      readonly byteOffset: number;
      readonly byteLength: number;
    }
  > = [];

  for (const segment of createSentenceSegmenter().segment(text)) {
    const rawText = segment.segment;

    if (rawText.trim() === "") {
      continue;
    }
    const sentence = new Sentence(rawText, countWords(rawText));

    Object.assign(sentence, {
      byteLength: Buffer.byteLength(rawText, "utf8"),
      byteOffset: Buffer.byteLength(text.slice(0, segment.index), "utf8"),
    });
    spans.push(
      sentence as unknown as SentenceRecord & {
        readonly byteOffset: number;
        readonly byteLength: number;
      },
    );
  }

  return spans;
}

async function splitTextIntoCustomSentenceSpans(
  text: string,
  segmenter: TextStreamSentenceSegmenter,
): Promise<
  ReadonlyArray<
    SentenceRecord & {
      readonly byteOffset: number;
      readonly byteLength: number;
    }
  >
> {
  const spans: Array<
    SentenceRecord & {
      readonly byteOffset: number;
      readonly byteLength: number;
    }
  > = [];

  for await (const segment of segmenter.pipe([text])) {
    const rawText = text.slice(
      segment.offset,
      segment.offset + segment.text.length,
    );

    if (rawText.trim() === "") {
      continue;
    }
    const sentence = new Sentence(rawText, segment.wordsCount);

    Object.assign(sentence, {
      byteLength: Buffer.byteLength(rawText, "utf8"),
      byteOffset: Buffer.byteLength(text.slice(0, segment.offset), "utf8"),
    });
    spans.push(
      sentence as unknown as SentenceRecord & {
        readonly byteOffset: number;
        readonly byteLength: number;
      },
    );
  }

  return spans;
}

let SENTENCE_SEGMENTER: Intl.Segmenter | undefined;

function createSentenceSegmenter(): Intl.Segmenter {
  SENTENCE_SEGMENTER ??= new Intl.Segmenter(undefined, {
    granularity: "sentence",
  });

  return SENTENCE_SEGMENTER;
}

function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

export function getSentenceByteOffset(sentence: SentenceRecord): number {
  const value = (sentence as { readonly byteOffset?: unknown }).byteOffset;

  return typeof value === "number" ? value : 0;
}

export function hasSentenceByteOffset(sentence: SentenceRecord): boolean {
  return (
    typeof (sentence as { readonly byteOffset?: unknown }).byteOffset ===
    "number"
  );
}

export function getSentenceByteLength(sentence: SentenceRecord): number {
  const value = (sentence as { readonly byteLength?: unknown }).byteLength;

  return typeof value === "number"
    ? value
    : Buffer.byteLength(getSentenceRawText(sentence), "utf8");
}

export function getSentenceRawText(sentence: SentenceRecord): string {
  const value = (sentence as { readonly rawText?: unknown }).rawText;

  return typeof value === "string" ? value : sentence.text;
}

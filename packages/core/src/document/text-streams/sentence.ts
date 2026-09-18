import { countTextWords } from "../../utils/text-word-count.js";
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
      readonly characterOffset: number;
      readonly characterLength: number;
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
      readonly characterOffset: number;
      readonly characterLength: number;
    }
  > = [];
  let previousEnd = 0;
  let characterOffset = 0;

  for (const segment of createSentenceSegmenter().segment(text)) {
    const rawText = segment.segment;
    characterOffset += Array.from(
      text.slice(previousEnd, segment.index),
    ).length;
    const characterLength = Array.from(rawText).length;
    previousEnd = segment.index + rawText.length;

    if (rawText.trim() === "") {
      characterOffset += characterLength;
      continue;
    }
    const sentence = new Sentence(rawText, countTextWords(rawText));

    Object.assign(sentence, {
      byteLength: utf8ByteLength(rawText),
      byteOffset: utf8ByteLength(text.slice(0, segment.index)),
      characterLength,
      characterOffset,
    });
    spans.push(
      sentence as unknown as SentenceRecord & {
        readonly byteOffset: number;
        readonly byteLength: number;
        readonly characterOffset: number;
        readonly characterLength: number;
      },
    );
    characterOffset += characterLength;
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
      readonly characterOffset: number;
      readonly characterLength: number;
    }
  >
> {
  const spans: Array<
    SentenceRecord & {
      readonly byteOffset: number;
      readonly byteLength: number;
      readonly characterOffset: number;
      readonly characterLength: number;
    }
  > = [];
  let previousEnd = 0;
  let characterOffset = 0;

  for await (const segment of segmenter.pipe([text])) {
    const rawText = text.slice(
      segment.offset,
      segment.offset + segment.text.length,
    );
    characterOffset += Array.from(
      text.slice(previousEnd, segment.offset),
    ).length;
    const characterLength = Array.from(rawText).length;
    previousEnd = segment.offset + rawText.length;

    if (rawText.trim() === "") {
      characterOffset += characterLength;
      continue;
    }
    const sentence = new Sentence(rawText, segment.wordsCount);

    Object.assign(sentence, {
      byteLength: utf8ByteLength(rawText),
      byteOffset: utf8ByteLength(text.slice(0, segment.offset)),
      characterLength,
      characterOffset,
    });
    spans.push(
      sentence as unknown as SentenceRecord & {
        readonly byteOffset: number;
        readonly byteLength: number;
        readonly characterOffset: number;
        readonly characterLength: number;
      },
    );
    characterOffset += characterLength;
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
    : utf8ByteLength(getSentenceRawText(sentence));
}

export function getSentenceCharacterOffset(sentence: SentenceRecord): number {
  const value = (sentence as { readonly characterOffset?: unknown })
    .characterOffset;
  return typeof value === "number" ? value : 0;
}

export function hasSentenceCharacterOffset(sentence: SentenceRecord): boolean {
  return (
    typeof (sentence as { readonly characterOffset?: unknown })
      .characterOffset === "number"
  );
}

export function getSentenceCharacterLength(sentence: SentenceRecord): number {
  const value = (sentence as { readonly characterLength?: unknown })
    .characterLength;
  return typeof value === "number"
    ? value
    : Array.from(getSentenceRawText(sentence)).length;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function getSentenceRawText(sentence: SentenceRecord): string {
  const value = (sentence as { readonly rawText?: unknown }).rawText;

  return typeof value === "string" ? value : sentence.text;
}

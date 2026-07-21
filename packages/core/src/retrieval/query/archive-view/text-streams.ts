import type {
  ReadonlyDocument,
  ReadonlySerialTextStream,
} from "../../../document/index.js";

import { createSnippet } from "./helpers.js";
import {
  formatChapterId,
  formatFragmentId,
  formatTextStreamRangeUri,
} from "./references.js";
import type { WikiGraphReference } from "./references.js";
import type {
  ArchiveSourceFragment,
  ArchiveTextStreamIndex,
  ArchiveTextStreamKind,
  ArchiveTextStreamSentence,
  EvidenceReadContext,
} from "./types.js";

function createTextStreamReadContext(): EvidenceReadContext {
  return {
    chapters: new Map(),
    streamIndexes: new Map(),
  };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export async function readSourceFragment(
  document: ReadonlyDocument,
  serialId: number,
  fragmentId: number,
): Promise<ArchiveSourceFragment> {
  const fragment = await document
    .getSerialFragments(serialId)
    .getFragment(fragmentId);
  const text = fragment.sentences.map((sentence) => sentence.text).join("\n");

  return {
    fragmentId,
    id: formatFragmentId(serialId, fragmentId),
    preview: createSnippet(text),
    sentenceCount: fragment.sentences.length,
    text,
    wordsCount: fragment.sentences.reduce(
      (total, sentence) => total + sentence.wordsCount,
      0,
    ),
  };
}

export async function createTextStreamRangeFragment(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "text-stream" }>,
): Promise<ArchiveSourceFragment> {
  const range = await readTextStreamRange(
    document,
    reference.chapterId,
    reference.stream,
    reference.startSentenceIndex,
    reference.endSentenceIndex,
  );

  return {
    fragmentId: range.startSentenceIndex,
    id: range.id,
    preview: createSnippet(range.text),
    sentenceCount: range.endSentenceIndex - range.startSentenceIndex + 1,
    text: range.text,
    wordsCount: countWords(range.text),
  };
}

export async function readTextStreamRange(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  startSentenceIndex: number,
  endSentenceIndex: number,
  context: EvidenceReadContext = createTextStreamReadContext(),
): Promise<{
  readonly endSentenceIndex: number;
  readonly id: string;
  readonly startSentenceIndex: number;
  readonly text: string;
}> {
  const index = await getTextStreamIndex(document, chapterId, stream, context);
  if (index.sentences.length === 0) {
    throw new Error(
      `Chapter ${formatChapterId(chapterId)} has no ${stream} text.`,
    );
  }

  const lastSentenceIndex = index.sentences.length - 1;
  if (startSentenceIndex > lastSentenceIndex) {
    throw new Error(
      `${stream} range ${formatTextStreamRangeUri(chapterId, stream, startSentenceIndex, endSentenceIndex)} is out of bounds. Last sentence number is ${lastSentenceIndex + 1}.`,
    );
  }

  const start = clampInteger(startSentenceIndex, 0, lastSentenceIndex);
  const end = clampInteger(endSentenceIndex, start, lastSentenceIndex);
  const sentences = index.sentences.slice(start, end + 1);
  const text =
    normalizeRenderedTextStreamRange(
      await readTextStreamRawRange(document, chapterId, stream, start, end),
    ) ?? joinTextStreamSentences(sentences);

  return {
    endSentenceIndex: end,
    id: formatTextStreamRangeUri(chapterId, stream, start, end),
    startSentenceIndex: start,
    text,
  };
}

export async function readTextStreamText(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
): Promise<string> {
  const serial = getTextStreamSerial(document, chapterId, stream);
  const text = await serial.readText?.();

  if (text !== undefined) {
    return text;
  }

  const index = await createTextStreamIndex(document, chapterId, stream);

  return joinTextStreamSentences(index.sentences);
}

async function readTextStreamRawRange(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  startSentenceIndex: number,
  endSentenceIndex: number,
): Promise<string | undefined> {
  const serial = getTextStreamSerial(document, chapterId, stream);

  return await serial.readTextInRange?.(startSentenceIndex, endSentenceIndex);
}

function getTextStreamSerial(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
): ReadonlySerialTextStream {
  return stream === "summary"
    ? document.getSummaryFragments(chapterId)
    : document.getSerialFragments(chapterId);
}

function joinTextStreamSentences(
  sentences: readonly Pick<ArchiveTextStreamSentence, "text">[],
): string {
  return sentences.map((sentence) => sentence.text).join("");
}

function normalizeRenderedTextStreamRange(
  text: string | undefined,
): string | undefined {
  return text
    ?.replace(/^(?:[^\S\r\n]*(?:\r\n|\n|\r))+/u, "")
    .replace(/(?:(?:\r\n|\n|\r)[^\S\r\n]*)+$/u, "");
}

export async function getTextStreamIndex(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  context: EvidenceReadContext = createTextStreamReadContext(),
): Promise<ArchiveTextStreamIndex> {
  const key = `${chapterId}:${stream}`;
  let index = context.streamIndexes.get(key);

  if (index === undefined) {
    index = createTextStreamIndex(document, chapterId, stream);
    context.streamIndexes.set(key, index);
  }

  return await index;
}

export async function createTextStreamIndex(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
): Promise<ArchiveTextStreamIndex> {
  if (stream === "summary") {
    const fragments = document.getSummaryFragments(chapterId);
    const sentences: ArchiveTextStreamSentence[] = [];

    for (const fragmentId of await fragments.listFragmentIds()) {
      const fragment = await fragments.getFragment(fragmentId);

      for (let index = 0; index < fragment.sentences.length; index += 1) {
        const sentence = fragment.sentences[index];

        if (sentence === undefined) {
          continue;
        }

        sentences.push({
          fragmentId,
          globalIndex: sentences.length,
          localIndex: index,
          text: sentence.text,
          wordsCount: sentence.wordsCount,
        });
      }
    }

    return { sentences };
  }

  const fragments = document.getSerialFragments(chapterId);
  const sentences: ArchiveTextStreamSentence[] = [];

  for (const fragmentId of await fragments.listFragmentIds()) {
    const fragment = await fragments.getFragment(fragmentId);

    for (let index = 0; index < fragment.sentences.length; index += 1) {
      const sentence = fragment.sentences[index];

      if (sentence === undefined) {
        continue;
      }

      sentences.push({
        fragmentId,
        globalIndex: sentences.length,
        localIndex: index,
        text: sentence.text,
        wordsCount: sentence.wordsCount,
      });
    }
  }

  return { sentences };
}

export function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

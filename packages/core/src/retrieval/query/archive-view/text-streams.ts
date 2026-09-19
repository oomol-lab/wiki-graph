import type {
  ReadonlyDocument,
  ReadonlySerialTextStream,
} from "../../../document/index.js";
import {
  listChapters,
  type ChapterEntry,
} from "../../../document/chapter/index.js";
import { countTextWords } from "../../../utils/text-word-count.js";

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
): Promise<{
  readonly fragment: ArchiveSourceFragment;
}> {
  const range = await readTextStreamRange(
    document,
    reference.chapterId,
    reference.stream,
    reference.startSentenceIndex,
    reference.endSentenceIndex,
  );

  return {
    fragment: {
      fragmentId: range.startSentenceIndex,
      id: range.id,
      preview: createSnippet(range.text),
      sentenceCount: range.endSentenceIndex - range.startSentenceIndex + 1,
      text: range.text,
      wordsCount: countWords(range.text),
    },
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
  readonly sourceEnd?: number;
  readonly sourceStart?: number;
  readonly startSentenceIndex: number;
  readonly text: string;
}> {
  const chapter = await getTextStreamChapter(document, chapterId, context);
  const serial = getTextStreamSerial(document, chapterId, stream);
  const index =
    serial.getSentenceCount === undefined
      ? await getTextStreamIndex(document, chapterId, stream, context)
      : undefined;
  const sentenceCount =
    index?.sentences.length ?? (await serial.getSentenceCount?.()) ?? 0;
  if (sentenceCount === 0) {
    throw new Error(`Chapter ${chapter.uri} has no ${stream} text.`);
  }

  const lastSentenceIndex = sentenceCount - 1;
  if (startSentenceIndex > lastSentenceIndex) {
    throw new Error(
      `${stream} range ${formatTextStreamRangeUri(chapter.path, stream, startSentenceIndex, endSentenceIndex)} is out of bounds. Last sentence number is ${lastSentenceIndex + 1}.`,
    );
  }

  const start = clampInteger(startSentenceIndex, 0, lastSentenceIndex);
  const end = clampInteger(endSentenceIndex, start, lastSentenceIndex);
  const rawRange = await readTextStreamRawRange(
    document,
    chapterId,
    stream,
    start,
    end,
  );
  const normalizedRange = normalizeRenderedTextStreamRange(rawRange?.text);
  const text =
    normalizedRange?.text ??
    joinTextStreamSentences(
      serial.listSentencesInRange === undefined
        ? (index?.sentences.slice(start, end + 1) ?? [])
        : await serial.listSentencesInRange(start, end),
    );
  const sourceStart =
    rawRange?.sourceStart === undefined
      ? undefined
      : rawRange.sourceStart + (normalizedRange?.removedStart ?? 0);
  const sourceEnd =
    sourceStart === undefined
      ? undefined
      : sourceStart + Array.from(text).length;
  return {
    endSentenceIndex: end,
    id: formatTextStreamRangeUri(chapter.path, stream, start, end),
    ...(sourceEnd === undefined ? {} : { sourceEnd }),
    ...(sourceStart === undefined ? {} : { sourceStart }),
    startSentenceIndex: start,
    text,
  };
}

async function getTextStreamChapter(
  document: ReadonlyDocument,
  chapterId: number,
  context: EvidenceReadContext,
): Promise<ChapterEntry> {
  let chapter = context.chapters.get(chapterId);

  if (chapter === undefined) {
    chapter = listChapters(document).then((chapters) => {
      const matched = chapters.find((entry) => entry.chapterId === chapterId);

      if (matched === undefined) {
        throw new Error(
          `Chapter ${formatChapterId(chapterId)} does not exist.`,
        );
      }
      return matched;
    });
    context.chapters.set(chapterId, chapter);
  }

  return await chapter;
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
): Promise<
  | {
      readonly sourceEnd?: number;
      readonly sourceStart?: number;
      readonly text: string;
    }
  | undefined
> {
  const serial = getTextStreamSerial(document, chapterId, stream);
  const range = await serial.readTextInRangeWithOffsets?.(
    startSentenceIndex,
    endSentenceIndex,
  );

  if (range !== undefined) {
    return range;
  }

  const text = await serial.readTextInRange?.(
    startSentenceIndex,
    endSentenceIndex,
  );

  return text === undefined ? undefined : { text };
}

export function getTextStreamSerial(
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
): { readonly removedStart: number; readonly text: string } | undefined {
  if (text === undefined) return undefined;

  const leading = /^(?:[^\S\r\n]*(?:\r\n|\n|\r))+/u.exec(text)?.[0] ?? "";
  const withoutLeading = text.slice(leading.length);
  const trailing =
    /(?:(?:\r\n|\n|\r)[^\S\r\n]*)+$/u.exec(withoutLeading)?.[0] ?? "";

  return {
    removedStart: Array.from(leading).length,
    text: withoutLeading.slice(0, withoutLeading.length - trailing.length),
  };
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
  return countTextWords(text);
}

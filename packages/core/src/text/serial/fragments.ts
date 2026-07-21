import type { ReadonlySerialFragments } from "../../document/index.js";
import {
  segmentTextStream,
  type ReaderSegmenter,
  type ReaderTextStream,
} from "../reader/index.js";
import { DEFAULT_FRAGMENT_WORDS_COUNT } from "./options.js";
import type { SerialDiscovery } from "./options.js";

export async function discoverSerial(input: {
  readonly segmenter?: ReaderSegmenter;
  readonly stream: ReaderTextStream;
}): Promise<SerialDiscovery> {
  let fragments = 0;
  let words = 0;

  for await (const fragment of streamFragments({
    maxWordsCount: DEFAULT_FRAGMENT_WORDS_COUNT,
    stream: segmentTextStream(input.stream, {
      ...(input.segmenter === undefined ? {} : { adapter: input.segmenter }),
    }),
  })) {
    fragments += 1;
    words += countFragmentWords(fragment.sentences);
  }

  return {
    fragments,
    words,
  };
}

export async function* streamFragments(input: {
  maxWordsCount: number;
  stream: AsyncIterable<{
    readonly text: string;
    readonly wordsCount: number;
  }>;
}): AsyncIterable<{
  readonly sentences: ReadonlyArray<{
    readonly text: string;
    readonly wordsCount: number;
  }>;
}> {
  let currentSentences: Array<{
    readonly text: string;
    readonly wordsCount: number;
  }> = [];
  let currentWordsCount = 0;

  for await (const sentence of input.stream) {
    const sentenceText = sentence.text.trim();

    if (sentenceText === "") {
      continue;
    }
    if (
      currentSentences.length > 0 &&
      currentWordsCount + sentence.wordsCount > input.maxWordsCount
    ) {
      yield {
        sentences: currentSentences,
      };
      currentSentences = [];
      currentWordsCount = 0;
    }
    currentSentences.push({
      text: sentenceText,
      wordsCount: sentence.wordsCount,
    });
    currentWordsCount += sentence.wordsCount;
  }

  if (currentSentences.length > 0) {
    yield {
      sentences: currentSentences,
    };
  }
}

export async function listSerialProcessingFragments(
  fragments: ReadonlySerialFragments,
  maxWordsCount: number,
): Promise<
  ReadonlyArray<{
    readonly startSentenceIndex: number;
    readonly sentences: ReadonlyArray<{
      readonly text: string;
      readonly wordsCount: number;
    }>;
  }>
> {
  const sentences =
    fragments.listSentences === undefined
      ? await listFragmentSentences(fragments)
      : await fragments.listSentences();
  const batches: Array<{
    startSentenceIndex: number;
    sentences: Array<{
      readonly text: string;
      readonly wordsCount: number;
    }>;
  }> = [];
  let currentSentences: Array<{
    readonly text: string;
    readonly wordsCount: number;
  }> = [];
  let currentStartSentenceIndex = 0;
  let currentWordsCount = 0;

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];

    if (sentence === undefined || sentence.text.trim() === "") {
      continue;
    }
    if (
      currentSentences.length > 0 &&
      currentWordsCount + sentence.wordsCount > maxWordsCount
    ) {
      batches.push({
        startSentenceIndex: currentStartSentenceIndex,
        sentences: currentSentences,
      });
      currentSentences = [];
      currentWordsCount = 0;
    }
    if (currentSentences.length === 0) {
      currentStartSentenceIndex = index;
    }
    currentSentences.push(sentence);
    currentWordsCount += sentence.wordsCount;
  }

  if (currentSentences.length > 0) {
    batches.push({
      startSentenceIndex: currentStartSentenceIndex,
      sentences: currentSentences,
    });
  }

  return batches;
}

export async function collectTextStream(
  stream: ReaderTextStream,
): Promise<string> {
  const parts: string[] = [];

  for await (const chunk of stream) {
    parts.push(chunk);
  }

  return parts.join("");
}

export function countFragmentWords(
  sentences: ReadonlyArray<{
    readonly text: string;
    readonly wordsCount: number;
  }>,
): number {
  return sentences.reduce((sum, sentence) => sum + sentence.wordsCount, 0);
}

export async function readSerialPassthroughSummary(
  fragments: ReadonlySerialFragments,
  fragmentIds: readonly number[],
): Promise<string> {
  if (fragmentIds.length === 0) {
    return "";
  }

  const records = await Promise.all(
    fragmentIds.map(
      async (fragmentId) => await fragments.getFragment(fragmentId),
    ),
  );

  return records
    .flatMap((fragment: Awaited<ReturnType<typeof fragments.getFragment>>) =>
      fragment.sentences.map((sentence) => sentence.text),
    )
    .join(" ")
    .trim();
}

async function listFragmentSentences(
  fragments: ReadonlySerialFragments,
): Promise<
  ReadonlyArray<{
    readonly text: string;
    readonly wordsCount: number;
  }>
> {
  const records = await Promise.all(
    (await fragments.listFragmentIds()).map(
      async (fragmentId) => await fragments.getFragment(fragmentId),
    ),
  );

  return records
    .sort((left, right) => left.fragmentId - right.fragmentId)
    .flatMap((fragment) => fragment.sentences);
}

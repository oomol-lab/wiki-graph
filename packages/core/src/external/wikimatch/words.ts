export interface WordBoundary {
  readonly end: number;
  readonly start: number;
}

export function listWordBoundaries(text: string): readonly WordBoundary[] {
  const segmenter = new Intl.Segmenter(undefined, {
    granularity: "word",
  });
  const graphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  const words: WordBoundary[] = [];

  for (const segment of segmenter.segment(text)) {
    if ("isWordLike" in segment && segment.isWordLike) {
      words.push({
        end: segment.index + segment.segment.length,
        start: segment.index,
      });
    }
  }

  if (words.length > 0) {
    return words;
  }

  return [...graphemeSegmenter.segment(text)]
    .filter((segment) => segment.segment.trim() !== "")
    .map((segment) => ({
      end: segment.index + segment.segment.length,
      start: segment.index,
    }));
}

export function expandRangeByWords(input: {
  readonly rangeEnd: number;
  readonly rangeStart: number;
  readonly text: string;
  readonly words: number;
}): { readonly end: number; readonly start: number } {
  const wordBoundaries = listWordBoundaries(input.text);

  if (wordBoundaries.length === 0) {
    return {
      end: input.text.length,
      start: 0,
    };
  }

  const firstWordIndex = findWordIndexAtOrAfter(
    wordBoundaries,
    input.rangeStart,
  );
  const lastWordIndex = findWordIndexBeforeOrAt(wordBoundaries, input.rangeEnd);
  const halfBudget = Math.max(0, Math.floor(input.words / 2));
  const startIndex = Math.max(0, firstWordIndex - halfBudget);
  const endIndex = Math.min(
    wordBoundaries.length - 1,
    lastWordIndex + halfBudget,
  );

  return {
    end: wordBoundaries[endIndex]?.end ?? input.text.length,
    start: wordBoundaries[startIndex]?.start ?? 0,
  };
}

function findWordIndexAtOrAfter(
  words: readonly WordBoundary[],
  offset: number,
): number {
  const matched = words.findIndex((word) => word.end > offset);

  return matched === -1 ? words.length - 1 : matched;
}

function findWordIndexBeforeOrAt(
  words: readonly WordBoundary[],
  offset: number,
): number {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];

    if (word !== undefined && word.start < offset) {
      return index;
    }
  }

  return 0;
}

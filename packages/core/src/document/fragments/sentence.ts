import type { SentenceRecord } from "../types.js";

export function splitTextIntoSentences(
  text: string,
): readonly SentenceRecord[] {
  return text
    .split(/\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "")
    .map((sentence) => ({
      text: sentence,
      wordsCount: countWords(sentence),
    }));
}

function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

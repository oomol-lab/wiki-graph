const HYPHEN_FLAGS = new Set(["‐", "‑", "‒", "–", "—", "―"]);
const SENTENCE_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: "sentence",
});

export function splitTextIntoSentences(text: string): string[] {
  const stripped = text.trim();

  if (stripped === "") {
    return [];
  }

  return Array.from(SENTENCE_SEGMENTER.segment(stripped))
    .map((segment) => segment.segment.trim())
    .filter((segment) => segment !== "");
}

export function normalizeText(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  const chars = processSpacesAndHyphens(collapsed);
  let normalized = "";

  for (const char of chars) {
    if (isPunctuation(char)) {
      continue;
    }

    if (!isLatinLetter(char)) {
      normalized += char;
      continue;
    }

    normalized += char.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  }

  return normalized;
}

function processSpacesAndHyphens(text: string): string[] {
  const chars: string[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === undefined) {
      break;
    }

    if (char !== " ") {
      chars.push(char);
      index += 1;
      continue;
    }

    if (
      chars.length >= 2 &&
      HYPHEN_FLAGS.has(chars[chars.length - 1] ?? "") &&
      isLatinLetter(chars[chars.length - 2] ?? "") &&
      index < text.length - 1 &&
      isLatinLetter(text[index + 1] ?? "")
    ) {
      chars.pop();
      index += 1;
      continue;
    }

    const previousChar = chars[chars.length - 1] ?? "";
    const nextChar = text[index + 1] ?? "";
    const keepSpace =
      previousChar !== "" &&
      nextChar !== "" &&
      isLatinLetter(previousChar) &&
      isLatinLetter(nextChar);

    if (keepSpace) {
      chars.push(char);
    }

    index += 1;
  }

  return chars;
}

function isLatinLetter(char: string): boolean {
  return char !== "" && /\p{Script=Latin}/u.test(char) && /\p{L}/u.test(char);
}

function isPunctuation(char: string): boolean {
  return /[\p{P}\p{S}]/u.test(char);
}

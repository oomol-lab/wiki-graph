import type {
  BuildWikilinkEvidenceWindowsOptions,
  WikilinkEvidenceWindow,
  WikilinkMention,
} from "./types.js";

export function buildWikilinkEvidenceWindows(
  options: BuildWikilinkEvidenceWindowsOptions,
): readonly WikilinkEvidenceWindow[] {
  validateOptions(options);

  const mentions = normalizeMentions(options.mentions);

  if (mentions.length === 0 || options.text.length === 0) {
    return [];
  }

  const stride = options.windowLength - options.maxEvidenceDistance;
  const windows: WikilinkEvidenceWindow[] = [];

  for (
    let start = 0;
    start < options.text.length;
    start = nextWindowStart(start, stride, options.text.length)
  ) {
    const end = Math.min(start + options.windowLength, options.text.length);
    const windowMentions = mentions.filter(
      (mention) => mention.range.start >= start && mention.range.end <= end,
    );

    if (windowMentions.length >= 2) {
      windows.push({
        baseOffset: start,
        mentions: windowMentions,
        range: { end, start },
        text: options.text.slice(start, end),
      });
    }
    if (end >= options.text.length) {
      break;
    }
  }

  return windows;
}

function nextWindowStart(
  current: number,
  stride: number,
  textLength: number,
): number {
  return Math.min(current + stride, textLength);
}

function validateOptions(options: BuildWikilinkEvidenceWindowsOptions): void {
  if (!Number.isInteger(options.windowLength) || options.windowLength <= 0) {
    throw new Error("windowLength must be a positive integer.");
  }
  if (
    !Number.isInteger(options.maxEvidenceDistance) ||
    options.maxEvidenceDistance <= 0
  ) {
    throw new Error("maxEvidenceDistance must be a positive integer.");
  }
  if (options.windowLength <= options.maxEvidenceDistance) {
    throw new Error(
      "windowLength must be greater than maxEvidenceDistance so eligible mention pairs are guaranteed to share at least one evidence window.",
    );
  }
}

function normalizeMentions(
  mentions: readonly WikilinkMention[],
): readonly WikilinkMention[] {
  return mentions
    .filter((mention) => mention.range.start < mention.range.end)
    .sort(compareMention);
}

function compareMention(left: WikilinkMention, right: WikilinkMention): number {
  return (
    left.range.start - right.range.start ||
    left.range.end - right.range.end ||
    left.id.localeCompare(right.id)
  );
}

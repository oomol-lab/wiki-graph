import {
  normalizeEvidenceDisplayText,
  type EvidenceQuoteScore,
  scoreEvidenceQuote,
} from "./quote-score.js";
import type {
  EvidenceSelection,
  EvidenceSelectionCandidate,
  EvidenceSelectionFailure,
  EvidenceSelectionList,
  EvidenceSelectionResolution,
  EvidenceSelectionSentence,
} from "./types.js";

const DIRECT_ID_MIN_SCORE = 0.72;
const DIRECT_ID_SUBSTRING_MIN_SCORE = 0.95;
const AUTO_TOP_MIN_SCORE = 0.72;
const AUTO_TOP_MIN_GAP = 0.15;
const LOW_CONFIDENCE_MAX_SCORE = 0.45;
const MAX_CANDIDATES = 5;

export function resolveEvidenceSelection(input: {
  readonly evidence: EvidenceSelection;
  readonly sentences: readonly EvidenceSelectionSentence[];
}): readonly [
  resolution: EvidenceSelectionResolution | undefined,
  failure: EvidenceSelectionFailure | undefined,
] {
  const quote = normalizeQuote(input.evidence.quote);
  const sentenceId = normalizeSentenceId(input.evidence.sentence_id);

  if (quote === "") {
    return [
      undefined,
      {
        candidates: [],
        code: "invalid",
        message: "Evidence quote is missing or empty.",
      },
    ];
  }

  if (sentenceId !== undefined) {
    const directCandidate = rankEvidenceQuote(quote, input.sentences).find(
      (candidate) => candidate.occurrenceId === sentenceId,
    );

    if (
      directCandidate !== undefined &&
      isDirectCandidateTrusted(directCandidate)
    ) {
      return [
        {
          candidate: directCandidate,
          confidence: directCandidate.score,
          sentenceIds: [directCandidate.sentence.sentenceId],
          strategy: `sentence_id+${directCandidate.strategy}`,
        },
        undefined,
      ];
    }
  }

  const candidates = rankEvidenceQuote(quote, input.sentences);
  const topCandidate = candidates[0];

  if (topCandidate === undefined) {
    return [
      undefined,
      {
        candidates: [],
        code: "none",
        message:
          "Evidence quote could not be matched: no candidates available.",
      },
    ];
  }

  const secondScore = candidates[1]?.score ?? 0;
  const gap = topCandidate.score - secondScore;

  if (topCandidate.score < LOW_CONFIDENCE_MAX_SCORE) {
    return [
      undefined,
      {
        candidates: candidates.slice(0, MAX_CANDIDATES),
        code: "low_confidence",
        message:
          "Evidence quote could not be matched confidently. " +
          `Best candidate score=${topCandidate.score.toFixed(3)}.`,
      },
    ];
  }

  if (topCandidate.score >= AUTO_TOP_MIN_SCORE && gap >= AUTO_TOP_MIN_GAP) {
    return [
      {
        candidate: topCandidate,
        confidence: topCandidate.score,
        sentenceIds: [topCandidate.sentence.sentenceId],
        strategy: `quote_auto_top1:${topCandidate.strategy}`,
      },
      undefined,
    ];
  }

  return [
    undefined,
    {
      candidates: candidates.slice(0, MAX_CANDIDATES),
      code: "ambiguous",
      message:
        "Evidence quote is ambiguous. Choose one candidate occurrence ID.",
    },
  ];
}

export function resolveEvidenceSelectionList(input: {
  readonly evidence: EvidenceSelectionList;
  readonly sentences: readonly EvidenceSelectionSentence[];
}): readonly [
  resolution: EvidenceSelectionResolution | undefined,
  failure: EvidenceSelectionFailure | undefined,
] {
  const selections = Array.isArray(input.evidence)
    ? input.evidence
    : [input.evidence];

  if (selections.length === 0) {
    return [
      undefined,
      {
        candidates: [],
        code: "invalid",
        message: "Evidence selection list is empty.",
      },
    ];
  }

  const sentenceIds: EvidenceSelectionResolution["sentenceIds"][number][] = [];
  const strategies: string[] = [];
  let confidence = 1;
  let candidate: EvidenceSelectionCandidate | undefined;

  for (const selection of selections) {
    const [resolution, failure] = resolveEvidenceSelection({
      evidence: selection,
      sentences: input.sentences,
    });

    if (failure !== undefined) {
      return [undefined, failure];
    }

    if (resolution === undefined) {
      return [
        undefined,
        {
          candidates: [],
          code: "none",
          message: "Evidence selection could not be resolved.",
        },
      ];
    }

    candidate ??= resolution.candidate;
    confidence = Math.min(confidence, resolution.confidence);
    sentenceIds.push(...resolution.sentenceIds);
    strategies.push(resolution.strategy);
  }

  if (candidate === undefined) {
    return [
      undefined,
      {
        candidates: [],
        code: "none",
        message: "Evidence selection could not be resolved.",
      },
    ];
  }

  return [
    {
      candidate,
      confidence,
      sentenceIds: uniqueSentenceIds(sentenceIds),
      strategy: `list:${strategies.join(",")}`,
    },
    undefined,
  ];
}

export function rankEvidenceQuote(
  quote: string,
  sentences: readonly EvidenceSelectionSentence[],
): EvidenceSelectionCandidate[] {
  return sentences
    .map((sentence, index) => {
      const scored = scoreEvidenceQuote({
        quote,
        sentence: sentence.text,
      });

      return createCandidate({
        index,
        scored,
        sentence,
        sentences,
      });
    })
    .sort(compareCandidates);
}

function createCandidate(input: {
  readonly index: number;
  readonly scored: EvidenceQuoteScore;
  readonly sentence: EvidenceSelectionSentence;
  readonly sentences: readonly EvidenceSelectionSentence[];
}): EvidenceSelectionCandidate {
  return {
    exactNormalized: input.scored.exactNormalized,
    exactRaw: input.scored.exactRaw,
    exactSubstring: input.scored.exactSubstring,
    index: input.index,
    nextText: input.sentences[input.index + 1]?.text ?? "",
    occurrenceId: input.sentence.id,
    prevText: input.sentences[input.index - 1]?.text ?? "",
    score: input.scored.score,
    sentence: input.sentence,
    strategy: input.scored.strategy,
  };
}

function compareCandidates(
  left: EvidenceSelectionCandidate,
  right: EvidenceSelectionCandidate,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.exactRaw !== right.exactRaw) {
    return left.exactRaw ? -1 : 1;
  }
  if (left.exactSubstring !== right.exactSubstring) {
    return left.exactSubstring ? -1 : 1;
  }
  if (left.exactNormalized !== right.exactNormalized) {
    return left.exactNormalized ? -1 : 1;
  }

  return left.index - right.index;
}

function isDirectCandidateTrusted(
  candidate: EvidenceSelectionCandidate,
): boolean {
  return (
    candidate.score >= DIRECT_ID_MIN_SCORE ||
    (candidate.exactSubstring &&
      candidate.score >= DIRECT_ID_SUBSTRING_MIN_SCORE)
  );
}

function normalizeQuote(value: string | undefined): string {
  return normalizeEvidenceDisplayText(value ?? "");
}

function normalizeSentenceId(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === "" ? undefined : normalized;
}

function uniqueSentenceIds(
  sentenceIds: EvidenceSelectionResolution["sentenceIds"],
): EvidenceSelectionResolution["sentenceIds"] {
  const seen = new Set<string>();
  const unique: EvidenceSelectionResolution["sentenceIds"][number][] = [];

  for (const sentenceId of sentenceIds) {
    const key = sentenceId.join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(sentenceId);
  }

  return unique;
}

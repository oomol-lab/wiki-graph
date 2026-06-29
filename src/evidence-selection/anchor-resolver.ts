import type { SentenceId } from "../document/index.js";
import type {
  EvidenceResolutionFailure,
  EvidenceResolutionResult,
  RankedSentenceCandidate,
} from "./anchor-types.js";
import { normalizeText, splitTextIntoSentences } from "./text.js";

const MIN_AUTO_RESOLVE_GAP = 0.07;
const MIN_AUTO_RESOLVE_SCORE = 0.9;
const MIN_BOUNDARY_BONUS_LENGTH = 12;
const MIN_CANDIDATE_SCORE = 0.55;
const VERY_HIGH_CONFIDENCE_SCORE = 0.97;
const MAX_BOUNDARY_BONUS = 0.08;
const MAX_CANDIDATE_DISPLAY = 3;

interface AnchorSpec {
  readonly mode: "full" | "head_tail";
  readonly text?: string;
  readonly head?: string;
  readonly tail?: string;
}

interface TextMatchScore {
  readonly score: number;
  readonly exactRaw: boolean;
  readonly exactNormalized: boolean;
  readonly exactSubstring: boolean;
  readonly matchStart: number;
  readonly matchEnd: number;
}

export class EvidenceResolver {
  public resolve(
    evidence: Record<string, unknown>,
    candidateSentenceIds: readonly SentenceId[],
    candidateTexts: readonly string[],
  ): readonly [
    result: EvidenceResolutionResult | undefined,
    failure: EvidenceResolutionFailure | undefined,
  ] {
    const startValue = evidence.start_anchor ?? evidence.start;
    const endValue = evidence.end_anchor ?? evidence.end;

    const [startAnchor, startFailure] = this.parseAnchor(
      startValue,
      "start_anchor",
    );

    if (startFailure !== undefined) {
      return [undefined, startFailure];
    }

    let endAnchor: AnchorSpec | undefined;

    if (endValue !== undefined) {
      const [parsedEndAnchor, endFailure] = this.parseAnchor(
        endValue,
        "end_anchor",
      );

      if (endFailure !== undefined) {
        return [undefined, endFailure];
      }

      endAnchor = parsedEndAnchor;
    }

    const [startCandidate, startStrategy, startResolveFailure] =
      this.resolveAnchor({
        anchor: startAnchor,
        candidateSentenceIds,
        candidateTexts,
        label: "start_anchor",
      });

    if (startResolveFailure !== undefined) {
      return [undefined, startResolveFailure];
    }

    if (startCandidate === undefined) {
      return [
        undefined,
        {
          candidates: [],
          code: "none",
          fieldName: "start_anchor",
          message: "start_anchor could not be matched: no candidate selected",
        },
      ];
    }

    if (endAnchor === undefined) {
      return [
        {
          confidence: startCandidate.score,
          sentenceIds: [startCandidate.sentenceId],
          strategy: startStrategy,
        },
        undefined,
      ];
    }

    const [endCandidate, endStrategy, endResolveFailure] = this.resolveAnchor({
      anchor: endAnchor,
      candidateSentenceIds,
      candidateTexts,
      label: "end_anchor",
      minIndex: startCandidate.index,
    });

    if (endResolveFailure !== undefined) {
      return [undefined, endResolveFailure];
    }

    if (endCandidate === undefined) {
      return [
        undefined,
        {
          candidates: [],
          code: "none",
          fieldName: "end_anchor",
          message: "end_anchor could not be matched: no candidate selected",
        },
      ];
    }

    if (endCandidate.index < startCandidate.index) {
      return [
        undefined,
        {
          candidates: [],
          code: "invalid_range",
          fieldName: "end_anchor",
          message:
            "Invalid evidence range: end_anchor resolved before start_anchor " +
            `(${startCandidate.occurrenceId} -> ${endCandidate.occurrenceId}).`,
        },
      ];
    }

    return [
      {
        confidence: Math.min(startCandidate.score, endCandidate.score),
        sentenceIds: candidateSentenceIds.slice(
          startCandidate.index,
          endCandidate.index + 1,
        ),
        strategy: `${startStrategy}+${endStrategy}`,
      },
      undefined,
    ];
  }

  public resolveWithOverrides(input: {
    evidence: Record<string, unknown>;
    candidateSentenceIds: readonly SentenceId[];
    candidateTexts: readonly string[];
    overrides: Partial<
      Readonly<Record<"start_anchor" | "end_anchor", RankedSentenceCandidate>>
    >;
  }): readonly [
    result: EvidenceResolutionResult | undefined,
    failure: EvidenceResolutionFailure | undefined,
  ] {
    const startValue = input.evidence.start_anchor ?? input.evidence.start;
    const endValue = input.evidence.end_anchor ?? input.evidence.end;

    const [startAnchor, startFailure] = this.parseAnchor(
      startValue,
      "start_anchor",
    );

    if (startFailure !== undefined) {
      return [undefined, startFailure];
    }

    const startCandidateOverride = input.overrides.start_anchor;
    const [startCandidate, startStrategy, startResolveFailure] =
      startCandidateOverride === undefined
        ? this.resolveAnchor({
            anchor: startAnchor,
            candidateSentenceIds: input.candidateSentenceIds,
            candidateTexts: input.candidateTexts,
            label: "start_anchor",
          })
        : [startCandidateOverride, "choice_final", undefined];

    if (startResolveFailure !== undefined) {
      return [undefined, startResolveFailure];
    }

    if (startCandidate === undefined) {
      return [
        undefined,
        {
          candidates: [],
          code: "none",
          fieldName: "start_anchor",
          message: "start_anchor could not be matched: no candidate selected",
        },
      ];
    }

    if (endValue === undefined) {
      return [
        {
          confidence: startCandidate.score,
          sentenceIds: [startCandidate.sentenceId],
          strategy: startStrategy,
        },
        undefined,
      ];
    }

    const [endAnchor, endFailure] = this.parseAnchor(endValue, "end_anchor");

    if (endFailure !== undefined) {
      return [undefined, endFailure];
    }

    const endCandidateOverride = input.overrides.end_anchor;
    const [endCandidate, endStrategy, endResolveFailure] =
      endCandidateOverride === undefined
        ? this.resolveAnchor({
            anchor: endAnchor,
            candidateSentenceIds: input.candidateSentenceIds,
            candidateTexts: input.candidateTexts,
            label: "end_anchor",
            minIndex: startCandidate.index,
          })
        : [endCandidateOverride, "choice_final", undefined];

    if (endResolveFailure !== undefined) {
      return [undefined, endResolveFailure];
    }

    if (endCandidate === undefined) {
      return [
        undefined,
        {
          candidates: [],
          code: "none",
          fieldName: "end_anchor",
          message: "end_anchor could not be matched: no candidate selected",
        },
      ];
    }

    if (endCandidate.index < startCandidate.index) {
      return [
        undefined,
        {
          candidates: [],
          code: "invalid_range",
          fieldName: "end_anchor",
          message:
            "Invalid evidence range: end_anchor resolved before start_anchor " +
            `(${startCandidate.occurrenceId} -> ${endCandidate.occurrenceId}).`,
        },
      ];
    }

    return [
      {
        confidence: Math.min(startCandidate.score, endCandidate.score),
        sentenceIds: input.candidateSentenceIds.slice(
          startCandidate.index,
          endCandidate.index + 1,
        ),
        strategy: `${startStrategy}+${endStrategy}`,
      },
      undefined,
    ];
  }

  public parseAnchor(
    value: unknown,
    fieldName: string,
  ): readonly [
    anchor: AnchorSpec | undefined,
    failure: EvidenceResolutionFailure | undefined,
  ] {
    const [anchor, error] = this.#parseAnchor(value);

    if (error !== undefined) {
      return [
        undefined,
        {
          candidates: [],
          code: "invalid_anchor",
          fieldName,
          message: `Invalid evidence.${fieldName}: ${error}`,
        },
      ];
    }

    return [this.#normalizeAnchor(anchor, fieldName), undefined];
  }

  public resolveAnchor(input: {
    anchor: AnchorSpec | undefined;
    candidateSentenceIds: readonly SentenceId[];
    candidateTexts: readonly string[];
    label: string;
    minIndex?: number;
  }): readonly [
    candidate: RankedSentenceCandidate | undefined,
    strategy: string,
    failure: EvidenceResolutionFailure | undefined,
  ] {
    if (input.anchor === undefined) {
      return [
        undefined,
        "invalid",
        {
          candidates: [],
          code: "invalid",
          fieldName: input.label,
          message: `${input.label} is missing`,
        },
      ];
    }

    let candidates = this.rankAnchor(
      input.anchor,
      input.candidateSentenceIds,
      input.candidateTexts,
      input.label,
    );

    const minIndex = input.minIndex;

    if (minIndex !== undefined) {
      candidates = candidates.filter(
        (candidate) => candidate.index >= minIndex,
      );
    }

    if (candidates.length === 0) {
      return [
        undefined,
        "none",
        {
          candidates: [],
          code: "none",
          fieldName: input.label,
          message: `${input.label} could not be matched: no candidates available`,
        },
      ];
    }

    const exactRaw = candidates.filter((candidate) => candidate.exactRaw);

    if (exactRaw.length === 1) {
      return [exactRaw[0], "exact_raw", undefined];
    }

    if (exactRaw.length > 1) {
      return [
        undefined,
        "ambiguous_exact_raw",
        this.#buildAmbiguousFailure(
          input.label,
          "ambiguous_exact_raw",
          exactRaw,
        ),
      ];
    }

    const exactSubstring = candidates.filter(
      (candidate) => candidate.exactSubstring,
    );

    if (exactSubstring.length === 1 && this.#anchorLength(input.anchor) >= 8) {
      return [exactSubstring[0], "exact_substring", undefined];
    }

    if (exactSubstring.length > 1 && this.#anchorLength(input.anchor) >= 8) {
      const selected = this.#tryAutoSelectScoredDuplicates(exactSubstring);

      if (selected !== undefined) {
        return [selected, "exact_substring_scored", undefined];
      }

      return [
        undefined,
        "ambiguous_exact_substring",
        this.#buildAmbiguousFailure(
          input.label,
          "ambiguous_exact_substring",
          exactSubstring,
        ),
      ];
    }

    const exactNormalized = candidates.filter(
      (candidate) => candidate.exactNormalized,
    );

    if (exactNormalized.length === 1) {
      return [exactNormalized[0], "exact_normalized", undefined];
    }

    if (exactNormalized.length > 1) {
      const selected = this.#tryAutoSelectScoredDuplicates(exactNormalized);

      if (selected !== undefined) {
        return [selected, "exact_normalized_scored", undefined];
      }

      return [
        undefined,
        "ambiguous_exact_normalized",
        this.#buildAmbiguousFailure(
          input.label,
          "ambiguous_exact_normalized",
          exactNormalized,
        ),
      ];
    }

    const topCandidate = candidates[0];

    if (topCandidate === undefined) {
      return [
        undefined,
        "none",
        {
          candidates: [],
          code: "none",
          fieldName: input.label,
          message: `${input.label} could not be matched: no candidates available`,
        },
      ];
    }

    const secondScore = candidates[1]?.score ?? 0;
    const gap = topCandidate.score - secondScore;

    if (topCandidate.score < MIN_CANDIDATE_SCORE) {
      return [
        undefined,
        "low_confidence",
        {
          candidates: candidates.slice(0, MAX_CANDIDATE_DISPLAY),
          code: "low_confidence",
          fieldName: input.label,
          message:
            `${input.label} could not be matched confidently. ` +
            `Best candidate score=${topCandidate.score.toFixed(3)}.`,
        },
      ];
    }

    if (candidates.length === 1) {
      return [topCandidate, "auto_top1_single_candidate", undefined];
    }

    if (topCandidate.score >= VERY_HIGH_CONFIDENCE_SCORE) {
      return [topCandidate, "auto_top1_very_high", undefined];
    }

    if (
      topCandidate.score >= MIN_AUTO_RESOLVE_SCORE &&
      gap >= MIN_AUTO_RESOLVE_GAP
    ) {
      return [topCandidate, "auto_top1", undefined];
    }

    return [
      undefined,
      "ambiguous_ranked",
      this.#buildAmbiguousFailure(input.label, "ambiguous_ranked", candidates),
    ];
  }

  public rankAnchor(
    anchor: AnchorSpec,
    candidateSentenceIds: readonly SentenceId[],
    candidateTexts: readonly string[],
    label: string,
  ): RankedSentenceCandidate[] {
    const ranked: RankedSentenceCandidate[] = [];

    for (const [index, sentenceId] of candidateSentenceIds.entries()) {
      const text = candidateTexts[index] ?? "";
      const prevText = index > 0 ? (candidateTexts[index - 1] ?? "") : "";
      const nextText =
        index < candidateTexts.length - 1
          ? (candidateTexts[index + 1] ?? "")
          : "";
      const match = this.#scoreAnchor(anchor, text, label);

      ranked.push({
        exactNormalized: match.exactNormalized,
        exactRaw: match.exactRaw,
        exactSubstring: match.exactSubstring,
        index,
        nextText,
        occurrenceId: `S${index + 1}`,
        prevText,
        score: match.score,
        sentenceId,
        text,
      });
    }

    ranked.sort((left, right) => {
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
    });

    return ranked;
  }

  #scoreAnchor(
    anchor: AnchorSpec,
    candidateText: string,
    label: string,
  ): TextMatchScore {
    if (anchor.mode === "head_tail") {
      return this.#scoreHeadTail(anchor, candidateText);
    }

    return this.#scoreTextQuery(anchor.text ?? "", candidateText, label);
  }

  #scoreHeadTail(anchor: AnchorSpec, candidateText: string): TextMatchScore {
    const head = anchor.head ?? "";
    const tail = anchor.tail ?? "";
    const candidateNormalized = normalizeText(candidateText);
    const headNormalized = normalizeText(head);
    const tailNormalized = normalizeText(tail);

    if (headNormalized === "" || tailNormalized === "") {
      return createEmptyTextMatchScore();
    }

    const headPosition = candidateNormalized.indexOf(headNormalized);
    const tailPosition = candidateNormalized.lastIndexOf(tailNormalized);

    if (
      headPosition !== -1 &&
      tailPosition !== -1 &&
      headPosition <= tailPosition
    ) {
      const coveredChars = headNormalized.length + tailNormalized.length;
      const coverage = Math.min(
        1,
        coveredChars / Math.max(1, candidateNormalized.length),
      );

      return {
        exactNormalized: false,
        exactRaw: false,
        exactSubstring: true,
        matchEnd: tailPosition + tailNormalized.length,
        matchStart: headPosition,
        score: 0.82 + 0.18 * coverage,
      };
    }

    const headMatch = this.#scoreTextQuery(head, candidateText, "start_anchor");
    const tailMatch = this.#scoreTextQuery(tail, candidateText, "end_anchor");
    const ordered = headMatch.matchStart <= tailMatch.matchStart ? 1 : 0.85;

    return {
      exactNormalized: false,
      exactRaw: false,
      exactSubstring: false,
      matchEnd: Math.max(headMatch.matchEnd, tailMatch.matchEnd),
      matchStart: Math.min(headMatch.matchStart, tailMatch.matchStart),
      score: ((headMatch.score + tailMatch.score) / 2) * ordered,
    };
  }

  #scoreTextQuery(
    queryText: string,
    candidateText: string,
    label: string,
  ): TextMatchScore {
    const queryRaw = queryText.trim();
    const candidateRaw = candidateText.trim();
    const queryNormalized = normalizeText(queryRaw);
    const candidateNormalized = normalizeText(candidateRaw);

    if (queryNormalized === "" || candidateNormalized === "") {
      return createEmptyTextMatchScore();
    }

    if (queryRaw === candidateRaw) {
      return {
        exactNormalized: true,
        exactRaw: true,
        exactSubstring: true,
        matchEnd: candidateNormalized.length,
        matchStart: 0,
        score: 1,
      };
    }

    if (queryNormalized === candidateNormalized) {
      return {
        exactNormalized: true,
        exactRaw: false,
        exactSubstring: false,
        matchEnd: candidateNormalized.length,
        matchStart: 0,
        score: 0.995,
      };
    }

    if (candidateNormalized.includes(queryNormalized)) {
      const matchStart = candidateNormalized.indexOf(queryNormalized);
      const coverage =
        queryNormalized.length / Math.max(1, candidateNormalized.length);
      const boundaryBonus = this.#boundaryBonus({
        candidateNormalized,
        label,
        matchEnd: matchStart + queryNormalized.length,
        matchStart,
        queryNormalized,
      });

      return {
        exactNormalized: false,
        exactRaw: false,
        exactSubstring: true,
        matchEnd: matchStart + queryNormalized.length,
        matchStart,
        score: Math.min(1, 0.75 + 0.25 * coverage + boundaryBonus),
      };
    }

    if (queryNormalized.includes(candidateNormalized)) {
      const coverage =
        candidateNormalized.length / Math.max(1, queryNormalized.length);

      return {
        exactNormalized: false,
        exactRaw: false,
        exactSubstring: false,
        matchEnd: candidateNormalized.length,
        matchStart: 0,
        score: Math.min(0.92, 0.78 + 0.14 * coverage),
      };
    }

    let bestScore = 0;
    let bestStart = -1;
    let bestEnd = -1;
    const maxWindow = Math.min(
      candidateNormalized.length,
      Math.max(
        queryNormalized.length,
        Math.floor(queryNormalized.length * 1.2),
      ),
    );
    const minWindow = Math.min(
      maxWindow,
      Math.max(1, Math.floor(queryNormalized.length * 0.8)),
    );
    const queryChars = new Set(queryNormalized);

    for (let windowSize = minWindow; windowSize <= maxWindow; windowSize += 1) {
      for (
        let start = 0;
        start <= candidateNormalized.length - windowSize;
        start += 1
      ) {
        const window = candidateNormalized.slice(start, start + windowSize);
        const windowChars = new Set(window);
        const unionSize = new Set([...queryChars, ...windowChars]).size;
        const overlapSize = [...queryChars].filter((char) =>
          windowChars.has(char),
        ).length;
        const jaccard = unionSize === 0 ? 0 : overlapSize / unionSize;

        if (jaccard < 0.35) {
          continue;
        }

        const totalScore =
          0.35 * charNgramScore(queryNormalized, window) +
          0.35 * sequenceSimilarity(queryNormalized, window) +
          0.2 * levenshteinSimilarity(queryNormalized, window) +
          0.1 * lengthPenalty(queryNormalized, window) +
          this.#boundaryBonus({
            candidateNormalized,
            label,
            matchEnd: start + windowSize,
            matchStart: start,
            queryNormalized,
          });

        if (totalScore > bestScore) {
          bestScore = Math.min(1, totalScore);
          bestStart = start;
          bestEnd = start + windowSize;
        }
      }
    }

    return {
      exactNormalized: false,
      exactRaw: false,
      exactSubstring: false,
      matchEnd: bestEnd,
      matchStart: bestStart,
      score: bestScore,
    };
  }

  #parseAnchor(
    value: unknown,
  ): readonly [anchor: AnchorSpec | undefined, error: string | undefined] {
    if (value === undefined || value === null) {
      return [undefined, "anchor is required"];
    }

    if (typeof value === "string") {
      const stripped = value.trim();

      if (stripped === "") {
        return [undefined, "anchor string is empty"];
      }

      if (stripped.includes("...")) {
        const parts = stripped
          .split("...")
          .map((part) => part.trim())
          .filter((part) => part !== "");

        if (parts.length >= 2) {
          const head = parts[0];
          const tail = parts[parts.length - 1];

          if (head === undefined || tail === undefined) {
            return [undefined, "anchor string is empty"];
          }

          return [
            {
              head,
              mode: "head_tail",
              tail,
            },
            undefined,
          ];
        }
      }

      return [{ mode: "full", text: stripped }, undefined];
    }

    if (typeof value !== "object") {
      return [undefined, `expected string or object, got ${typeof value}`];
    }

    const rawValue = value as Record<string, unknown>;
    const mode =
      rawValue.mode === "head_tail" || rawValue.head !== undefined
        ? "head_tail"
        : "full";

    if (mode === "full") {
      const text =
        typeof rawValue.text === "string" ? rawValue.text.trim() : "";

      if (text === "") {
        return [undefined, "full anchor requires non-empty 'text'"];
      }

      return [{ mode: "full", text }, undefined];
    }

    const head = typeof rawValue.head === "string" ? rawValue.head.trim() : "";
    const tail = typeof rawValue.tail === "string" ? rawValue.tail.trim() : "";

    if (head !== "" && tail === "") {
      return [{ mode: "full", text: head }, undefined];
    }

    if (head === "" && tail !== "") {
      return [{ mode: "full", text: tail }, undefined];
    }

    if (head === "" || tail === "") {
      return [
        undefined,
        "head_tail anchor requires non-empty 'head' and 'tail'",
      ];
    }

    return [{ head, mode: "head_tail", tail }, undefined];
  }

  #normalizeAnchor(
    anchor: AnchorSpec | undefined,
    fieldName: string,
  ): AnchorSpec | undefined {
    if (anchor === undefined) {
      return undefined;
    }

    if (anchor.mode === "head_tail") {
      const boundaryText =
        fieldName === "end_anchor"
          ? this.#selectBoundarySentence(anchor.tail ?? "", "end_anchor")
          : this.#selectBoundarySentence(anchor.head ?? "", "start_anchor");

      return boundaryText === ""
        ? undefined
        : {
            mode: "full",
            text: boundaryText,
          };
    }

    const normalizedText = this.#selectBoundarySentence(
      anchor.text ?? "",
      fieldName,
    );

    return {
      mode: "full",
      text: normalizedText,
    };
  }

  #selectBoundarySentence(text: string, fieldName: string): string {
    const sentences = splitTextIntoSentences(text);

    if (sentences.length <= 1) {
      return text.trim();
    }

    return fieldName === "end_anchor"
      ? (sentences[sentences.length - 1] ?? text.trim())
      : (sentences[0] ?? text.trim());
  }

  #boundaryBonus(input: {
    label: string;
    queryNormalized: string;
    candidateNormalized: string;
    matchStart: number;
    matchEnd: number;
  }): number {
    if (input.matchStart < 0 || input.matchEnd < 0) {
      return 0;
    }

    if (input.queryNormalized.length < MIN_BOUNDARY_BONUS_LENGTH) {
      return 0;
    }

    if (input.label === "start_anchor" && input.matchStart !== 0) {
      return 0;
    }

    if (
      input.label === "end_anchor" &&
      input.matchEnd !== input.candidateNormalized.length
    ) {
      return 0;
    }

    const coverage =
      input.queryNormalized.length /
      Math.max(1, input.candidateNormalized.length);

    return MAX_BOUNDARY_BONUS * (0.5 + 0.5 * Math.min(1, coverage));
  }

  #tryAutoSelectScoredDuplicates(
    candidates: readonly RankedSentenceCandidate[],
  ): RankedSentenceCandidate | undefined {
    if (candidates.length === 0) {
      return undefined;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    const topCandidate = candidates[0];

    if (topCandidate === undefined) {
      return undefined;
    }

    const secondScore = candidates[1]?.score ?? 0;

    if (
      topCandidate.score >= MIN_AUTO_RESOLVE_SCORE &&
      topCandidate.score - secondScore >= MIN_AUTO_RESOLVE_GAP
    ) {
      return topCandidate;
    }

    return undefined;
  }

  #buildAmbiguousFailure(
    label: string,
    code: string,
    candidates: readonly RankedSentenceCandidate[],
  ): EvidenceResolutionFailure {
    const topCandidates = candidates.slice(0, MAX_CANDIDATE_DISPLAY);
    const formatted = topCandidates
      .map((candidate) => formatCandidate(candidate))
      .join("\n");

    return {
      candidates: topCandidates,
      code,
      fieldName: label,
      message:
        `${label} is ambiguous. Top candidates:\n${formatted}\n` +
        "Please provide a more specific anchor or surrounding context.",
    };
  }

  #anchorLength(anchor: AnchorSpec): number {
    if (anchor.mode === "head_tail") {
      return (
        normalizeText(anchor.head ?? "").length +
        normalizeText(anchor.tail ?? "").length
      );
    }

    return normalizeText(anchor.text ?? "").length;
  }
}

function createEmptyTextMatchScore(): TextMatchScore {
  return {
    exactNormalized: false,
    exactRaw: false,
    exactSubstring: false,
    matchEnd: -1,
    matchStart: -1,
    score: 0,
  };
}

function charNgramScore(left: string, right: string): number {
  const leftBigrams = charNgrams(left, 2);
  const rightBigrams = charNgrams(right, 2);
  const leftTrigrams = charNgrams(left, 3);
  const rightTrigrams = charNgrams(right, 3);

  return (
    (diceCoefficient(leftBigrams, rightBigrams) +
      diceCoefficient(leftTrigrams, rightTrigrams)) /
    2
  );
}

function charNgrams(text: string, size: number): Set<string> {
  if (text.length <= size) {
    return text === "" ? new Set() : new Set([text]);
  }

  const result = new Set<string>();

  for (let index = 0; index <= text.length - size; index += 1) {
    result.add(text.slice(index, index + size));
  }

  return result;
}

function diceCoefficient(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const value of left) {
    if (right.has(value)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (left.size + right.size);
}

function levenshteinSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (left === "" || right === "") {
    return 0;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1).fill(0);

  for (const [leftIndex, leftChar] of [...left].entries()) {
    current[0] = leftIndex + 1;

    for (const [rightIndex, rightChar] of [...right].entries()) {
      const insertCost = (current[rightIndex] ?? 0) + 1;
      const deleteCost = (previous[rightIndex + 1] ?? 0) + 1;
      const replaceCost =
        (previous[rightIndex] ?? 0) + (leftChar === rightChar ? 0 : 1);

      current[rightIndex + 1] = Math.min(insertCost, deleteCost, replaceCost);
    }

    [previous, current] = [current, previous];
  }

  const distance =
    previous[right.length] ?? Math.max(left.length, right.length);

  return 1 - distance / Math.max(left.length, right.length);
}

function lengthPenalty(left: string, right: string): number {
  return (
    1 -
    Math.abs(left.length - right.length) / Math.max(left.length, right.length)
  );
}

function sequenceSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  const leftLength = left.length;
  const rightLength = right.length;

  if (leftLength === 0 || rightLength === 0) {
    return 0;
  }

  const matrix = Array.from({ length: leftLength + 1 }, () =>
    new Array<number>(rightLength + 1).fill(0),
  );
  let longest = 0;

  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      if (left[leftIndex - 1] !== right[rightIndex - 1]) {
        continue;
      }

      const currentRow = matrix[leftIndex];

      if (currentRow === undefined) {
        continue;
      }

      currentRow[rightIndex] =
        (matrix[leftIndex - 1]?.[rightIndex - 1] ?? 0) + 1;
      longest = Math.max(longest, currentRow[rightIndex] ?? 0);
    }
  }

  return (2 * longest) / (leftLength + rightLength);
}

function formatCandidate(candidate: RankedSentenceCandidate): string {
  return (
    `  - ${candidate.occurrenceId} score=${candidate.score.toFixed(3)}\n` +
    `    prev: ${truncate(candidate.prevText)}\n` +
    `    text: ${truncate(candidate.text, 120)}\n` +
    `    next: ${truncate(candidate.nextText)}`
  );
}

function truncate(text: string, limit = 80): string {
  const stripped = text.replace(/\s+/gu, " ").trim();

  if (stripped === "") {
    return "(none)";
  }

  if (stripped.length <= limit) {
    return stripped;
  }

  return `${stripped.slice(0, limit - 3)}...`;
}

import type { SentenceId } from "../../../../document/index.js";
import type {
  EvidenceResolutionFailure,
  EvidenceResolutionResult,
  RankedSentenceCandidate,
} from "../types.js";
import { scoreAnchor } from "./matcher.js";
import { anchorLength, normalizeAnchor, parseRawAnchor } from "./parser.js";
import { formatCandidate } from "./scoring.js";
import {
  MAX_CANDIDATE_DISPLAY,
  MIN_AUTO_RESOLVE_GAP,
  MIN_AUTO_RESOLVE_SCORE,
  MIN_CANDIDATE_SCORE,
  VERY_HIGH_CONFIDENCE_SCORE,
} from "./types.js";
import type { AnchorSpec } from "./types.js";

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
    const [anchor, error] = parseRawAnchor(value);

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

    return [normalizeAnchor(anchor, fieldName), undefined];
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

    if (exactSubstring.length === 1 && anchorLength(input.anchor) >= 8) {
      return [exactSubstring[0], "exact_substring", undefined];
    }

    if (exactSubstring.length > 1 && anchorLength(input.anchor) >= 8) {
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
      const match = scoreAnchor(anchor, text, label);

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
}

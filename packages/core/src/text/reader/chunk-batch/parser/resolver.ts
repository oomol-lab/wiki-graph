import {
  ParsedJsonError,
  requestGuaranteedJson,
} from "../../../../external/guaranteed/index.js";
import type { LLMessage } from "../../../../external/llm/index.js";
import type { SentenceId } from "../../../../document/index.js";
import {
  resolveEvidenceSelectionList,
  EvidenceResolver,
  type EvidenceResolutionFailure,
  type RankedSentenceCandidate,
} from "../../../../graph/evidence-selection/index.js";
import type { FragmentProjection } from "../fragment-projection.js";
import {
  createEvidenceSelectionList,
  toEvidenceResolutionFailure,
} from "./evidence.js";
import {
  expectSingleSpan,
  formatChoiceCandidate,
  formatError,
  isParsedJsonValidationFailure,
  isRecord,
  toChoiceFieldName,
} from "./helpers.js";
import {
  choiceResponseSchema,
  type GuaranteedChoiceRequest,
  type ResolveChunkEvidenceInput,
  type SelectAmbiguousCandidateInput,
} from "./schema.js";

const MAX_CHOICE_RETRIES = 3;

export class ChunkEvidenceResolver {
  readonly #choiceSystemPrompt: string;
  readonly #evidenceResolver = new EvidenceResolver();
  readonly #projection: FragmentProjection;
  readonly #responseIntentClassifierPrompt: string;
  readonly #requestChoice: GuaranteedChoiceRequest;

  public constructor(input: {
    readonly choiceSystemPrompt: string;
    readonly projection: FragmentProjection;
    readonly responseIntentClassifierPrompt: string;
    readonly requestChoice: GuaranteedChoiceRequest;
  }) {
    this.#choiceSystemPrompt = input.choiceSystemPrompt;
    this.#projection = input.projection;
    this.#responseIntentClassifierPrompt = input.responseIntentClassifierPrompt;
    this.#requestChoice = input.requestChoice;
  }

  public async resolve(
    input: ResolveChunkEvidenceInput,
  ): Promise<
    readonly [
      sentenceIds: readonly SentenceId[],
      failure: EvidenceResolutionFailure | undefined,
    ]
  > {
    const evidence = input.data.evidence;

    if (evidence === undefined || evidence === null) {
      return [[], undefined];
    }

    if (!isRecord(evidence) && !Array.isArray(evidence)) {
      return [
        [],
        {
          candidates: [],
          code: "invalid_evidence",
          fieldName: "evidence",
          message: `Chunk #${input.chunkIndex} ("${input.chunkLabel}"): evidence must be an object or array`,
        },
      ];
    }

    const projectedSentences = this.#projection.sentences;
    const candidateSentenceIds = projectedSentences.map(
      (sentence) => sentence.sentenceId,
    );
    const selectionSentences = projectedSentences.map((sentence, index) => ({
      id: `S${index + 1}`,
      sentenceId: sentence.sentenceId,
      text: sentence.projectedText,
    }));
    const selectionEvidence = createEvidenceSelectionList(evidence);
    const [selectionResolution, selectionFailure] =
      selectionEvidence === undefined
        ? [undefined, undefined]
        : resolveEvidenceSelectionList({
            evidence: selectionEvidence,
            sentences: selectionSentences,
          });

    if (selectionResolution !== undefined) {
      return [selectionResolution.sentenceIds, undefined];
    }

    const exactMatchSentenceIds = Array.isArray(evidence)
      ? []
      : this.#resolveExactProjectionEvidence(evidence);

    if (exactMatchSentenceIds.length > 0) {
      return [exactMatchSentenceIds, undefined];
    }

    const candidateTexts = projectedSentences.map(
      (sentence) => sentence.projectedText,
    );
    const [resolution, failure] = Array.isArray(evidence)
      ? [undefined, undefined]
      : this.#evidenceResolver.resolve(
          evidence,
          candidateSentenceIds,
          candidateTexts,
        );

    if (resolution !== undefined) {
      return [resolution.sentenceIds, undefined];
    }

    const fallbackFailure =
      selectionFailure === undefined
        ? failure
        : toEvidenceResolutionFailure(selectionFailure, "evidence");

    if (fallbackFailure === undefined) {
      return [[], undefined];
    }

    const shouldUseChoice =
      fallbackFailure.code.startsWith("ambiguous") ||
      (fallbackFailure.code === "low_confidence" &&
        input.isLastGenerationAttempt &&
        fallbackFailure.candidates.length > 0);

    if (!shouldUseChoice) {
      return [[], fallbackFailure];
    }

    const choiceFieldName = toChoiceFieldName(fallbackFailure.fieldName);

    if (choiceFieldName === undefined) {
      return [[], fallbackFailure];
    }

    const [choiceCandidate, choiceFailure] =
      await this.#chooseAmbiguousCandidate({
        candidates: fallbackFailure.candidates,
        chunkData: input.data,
        chunkIndex: input.chunkIndex,
        chunkLabel: input.chunkLabel,
        fieldName: choiceFieldName,
      });

    if (choiceFailure !== undefined) {
      if (choiceFailure.code === "choice_parse_failed_full_fragment") {
        return [candidateSentenceIds, undefined];
      }

      return [[], choiceFailure];
    }

    if (choiceCandidate === undefined) {
      return [
        [],
        {
          candidates: fallbackFailure.candidates,
          code: "choice_failed",
          fieldName: fallbackFailure.fieldName,
          message: `Second-stage choice failed for ${fallbackFailure.fieldName}: no candidate returned.`,
        },
      ];
    }

    if (choiceFieldName === "evidence") {
      return [[choiceCandidate.sentenceId], undefined];
    }

    if (Array.isArray(evidence)) {
      return [[], fallbackFailure];
    }

    if (input.isLastGenerationAttempt) {
      const [resolved, resolveFailure] =
        this.#evidenceResolver.resolveWithOverrides({
          candidateSentenceIds,
          candidateTexts,
          evidence,
          overrides: {
            [choiceFieldName]: choiceCandidate,
          },
        });

      if (resolved !== undefined) {
        return [resolved.sentenceIds, undefined];
      }

      return [[], resolveFailure];
    }

    const repairedEvidence: Record<string, unknown> = {
      ...evidence,
      [choiceFieldName]: {
        mode: "full",
        text: choiceCandidate.text,
      },
    };
    const [resolved, resolveFailure] = this.#evidenceResolver.resolve(
      repairedEvidence,
      candidateSentenceIds,
      candidateTexts,
    );

    if (resolved !== undefined) {
      return [resolved.sentenceIds, undefined];
    }

    return [[], resolveFailure];
  }
  #resolveExactProjectionEvidence(
    evidence: Record<string, unknown>,
  ): SentenceId[] {
    const startValue = evidence.start_anchor ?? evidence.start;
    const [startAnchor, startFailure] = this.#evidenceResolver.parseAnchor(
      startValue,
      "start_anchor",
    );

    if (startFailure !== undefined || startAnchor?.text === undefined) {
      return [];
    }

    const startMatch = expectSingleSpan(
      this.#projection.findExactMatches(startAnchor.text),
    );

    if (startMatch === undefined) {
      return [];
    }

    const endValue = evidence.end_anchor ?? evidence.end;

    if (endValue === undefined) {
      return this.#projection.resolveSentenceIds(startMatch);
    }

    const [endAnchor, endFailure] = this.#evidenceResolver.parseAnchor(
      endValue,
      "end_anchor",
    );

    if (endFailure !== undefined || endAnchor?.text === undefined) {
      return [];
    }

    const endMatch = expectSingleSpan(
      this.#projection.findExactMatches(endAnchor.text),
    );

    if (endMatch === undefined || endMatch.offset < startMatch.offset) {
      return [];
    }

    return this.#projection.resolveSentenceIds({
      length: endMatch.offset + endMatch.length - startMatch.offset,
      offset: startMatch.offset,
    });
  }

  async #chooseAmbiguousCandidate(
    input: SelectAmbiguousCandidateInput,
  ): Promise<
    readonly [
      candidate: RankedSentenceCandidate | undefined,
      failure: EvidenceResolutionFailure | undefined,
    ]
  > {
    const messages = this.#buildChoiceMessages(input);
    const candidateIds = input.candidates.map(
      (candidate) => candidate.occurrenceId,
    );

    try {
      const choice = await requestGuaranteedJson({
        maxRetries: MAX_CHOICE_RETRIES,
        messages,
        parse: (data) => {
          const candidate = input.candidates.find(
            (item) => item.occurrenceId === data.choice,
          );

          if (candidate === undefined) {
            throw new ParsedJsonError([
              `Invalid choice "${data.choice}". Expected one of: ${candidateIds.join(", ")}`,
            ]);
          }

          return candidate;
        },
        responseIntentClassifierPrompt: this.#responseIntentClassifierPrompt,
        request: this.#requestChoice,
        schema: choiceResponseSchema,
      });

      return [choice, undefined];
    } catch (error) {
      if (isParsedJsonValidationFailure(error)) {
        return [
          undefined,
          {
            candidates: input.candidates,
            code: "choice_parse_failed_full_fragment",
            fieldName: input.fieldName,
            message:
              `Second-stage choice parse validation failed for ${input.fieldName}; ` +
              "falling back to the full fragment span.",
          },
        ];
      }

      return [
        undefined,
        {
          candidates: input.candidates,
          code: "choice_failed",
          fieldName: input.fieldName,
          message: `Second-stage choice failed for ${input.fieldName}: ${formatError(error)}`,
        },
      ];
    }
  }

  #buildChoiceMessages(input: SelectAmbiguousCandidateInput): LLMessage[] {
    return [
      {
        content: this.#choiceSystemPrompt,
        role: "system",
      },
      {
        content:
          `Previously generated chunk (do NOT rewrite it):\n` +
          `\`\`\`json\n${JSON.stringify(input.chunkData, null, 2)}\n\`\`\`\n\n` +
          `Resolve only this field: "${input.fieldName}" for chunk #${input.chunkIndex} [${input.chunkLabel}].\n` +
          "Choose exactly one candidate occurrence ID from the list below.\n\n" +
          input.candidates.map(formatChoiceCandidate).join("\n"),
        role: "user",
      },
    ];
  }
}

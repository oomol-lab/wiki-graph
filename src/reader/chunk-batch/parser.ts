import { z } from "zod";

import {
  GuaranteedParseValidationError,
  ParsedJsonError,
  requestGuaranteedJson,
} from "../../guaranteed/index.js";
import type { LLMessage } from "../../llm/index.js";
import {
  ChunkImportance,
  ChunkRetention,
  expectChunkImportance,
  expectChunkRetention,
  type SentenceId,
} from "../../document/index.js";
import {
  resolveEvidenceSelectionList,
  type EvidenceSelectionCandidate,
  type EvidenceSelectionList,
  EvidenceResolver,
  type EvidenceResolutionFailure,
  type RankedSentenceCandidate,
} from "../../evidence-selection/index.js";
import type {
  ChunkBatch,
  ChunkExtractionSentence,
  ChunkImportanceAnnotation,
  ChunkLink,
  CognitiveChunk,
  SentenceTextSource,
} from "./types.js";
import type { FragmentProjection, TextSpan } from "./fragment-projection.js";

const MAX_CHOICE_RETRIES = 3;

const chunkLinkSchema = z.object({
  from: z.union([z.number().int(), z.string()]),
  strength: z.string().optional(),
  to: z.union([z.number().int(), z.string()]),
});
const evidenceSelectionItemSchema = z
  .object({
    quote: z.string().optional(),
    sentence_id: z.string().optional(),
  })
  .passthrough();
const chunkEvidenceSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(evidenceSelectionItemSchema),
]);

const userFocusedChunkSchema = z
  .object({
    content: z.string(),
    evidence: chunkEvidenceSchema.nullish(),
    label: z.string(),
    retention: z.enum([
      ChunkRetention.Verbatim,
      ChunkRetention.Detailed,
      ChunkRetention.Focused,
      ChunkRetention.Relevant,
    ]),
    temp_id: z.string(),
  })
  .passthrough();

export const userFocusedResponseSchema = z.object({
  chunks: z.array(userFocusedChunkSchema),
  fragment_summary: z.string(),
  links: z.array(chunkLinkSchema),
});

const bookCoherenceChunkSchema = z
  .object({
    content: z.string(),
    evidence: chunkEvidenceSchema.nullish(),
    importance: z.enum([
      ChunkImportance.Critical,
      ChunkImportance.Important,
      ChunkImportance.Helpful,
    ]),
    label: z.string(),
    temp_id: z.string(),
  })
  .passthrough();

const importanceAnnotationSchema = z.object({
  chunk_id: z.number().int(),
  importance: z.enum([
    ChunkImportance.Critical,
    ChunkImportance.Important,
    ChunkImportance.Helpful,
  ]),
});

export const bookCoherenceResponseSchema = z.object({
  chunks: z.array(bookCoherenceChunkSchema),
  importance_annotations: z.array(importanceAnnotationSchema),
  links: z.array(chunkLinkSchema),
});

const choiceResponseSchema = z.object({
  choice: z.string(),
});

type UserFocusedChunkData = z.infer<typeof userFocusedChunkSchema>;
type BookCoherenceChunkData = z.infer<typeof bookCoherenceChunkSchema>;
export type UserFocusedResponseData = z.infer<typeof userFocusedResponseSchema>;
export type BookCoherenceResponseData = z.infer<
  typeof bookCoherenceResponseSchema
>;
type ExtractedChunkData = UserFocusedChunkData | BookCoherenceChunkData;
type RawChunkLink = z.infer<typeof chunkLinkSchema>;
type RawChunkEvidence = z.infer<typeof chunkEvidenceSchema>;
type ChoiceFieldName = "evidence" | "start_anchor" | "end_anchor";

export enum ChunkMetadataField {
  Retention = "retention",
  Importance = "importance",
}

export interface ExtractChunksResult {
  readonly chunkBatch: ChunkBatch;
  readonly fragmentSummary?: string;
}

interface ResolveChunkEvidenceInput {
  readonly data: ExtractedChunkData;
  readonly chunkIndex: number;
  readonly chunkLabel: string;
  readonly isLastGenerationAttempt: boolean;
}

interface SelectAmbiguousCandidateInput {
  readonly candidates: readonly RankedSentenceCandidate[];
  readonly chunkData: ExtractedChunkData;
  readonly chunkIndex: number;
  readonly chunkLabel: string;
  readonly fieldName: ChoiceFieldName;
}

type GuaranteedChoiceRequest = (
  messages: readonly LLMessage[],
  index: number,
  maxRetries: number,
) => Promise<string>;

export class ChunkBatchParser<
  TData extends UserFocusedResponseData | BookCoherenceResponseData,
> {
  readonly #choiceSystemPrompt: string;
  readonly #evidenceResolver = new EvidenceResolver();
  readonly #metadataField: ChunkMetadataField;
  readonly #projection: FragmentProjection;
  readonly #responseIntentClassifierPrompt: string;
  readonly #requestChoice: GuaranteedChoiceRequest;
  readonly #sentenceTextByKey: Readonly<Record<string, string>>;
  readonly #sentenceTextSource: SentenceTextSource;
  readonly #wordsCountByKey: Readonly<Record<string, number>>;
  readonly #validImportanceChunkIds: Readonly<Record<string, true>> | undefined;
  readonly #visibleChunkIds: readonly number[];

  public constructor(input: {
    choiceSystemPrompt: string;
    metadataField: ChunkMetadataField;
    projection: FragmentProjection;
    responseIntentClassifierPrompt: string;
    requestChoice: GuaranteedChoiceRequest;
    sentenceTextSource: SentenceTextSource;
    sentences: readonly ChunkExtractionSentence[];
    validImportanceChunkIds?: readonly number[];
    visibleChunkIds: readonly number[];
  }) {
    this.#choiceSystemPrompt = input.choiceSystemPrompt;
    this.#metadataField = input.metadataField;
    this.#projection = input.projection;
    this.#responseIntentClassifierPrompt = input.responseIntentClassifierPrompt;
    this.#requestChoice = input.requestChoice;
    this.#sentenceTextSource = input.sentenceTextSource;
    this.#visibleChunkIds = input.visibleChunkIds;

    this.#wordsCountByKey = createWordsCountRecord(
      input.projection.sentences.map((sentence) => ({
        sentenceId: sentence.sentenceId,
        wordsCount: sentence.wordsCount,
      })),
    );
    this.#sentenceTextByKey = createSentenceTextRecord(input.projection);
    this.#validImportanceChunkIds =
      input.validImportanceChunkIds === undefined
        ? undefined
        : createMembershipRecord(input.validImportanceChunkIds);
  }

  public async parse(
    parsedData: TData,
    input: {
      isLastGenerationAttempt: boolean;
    },
  ): Promise<ExtractChunksResult> {
    const issues: string[] = [];
    const chunks: ChunkBatch["chunks"] = [];
    const tempIds: string[] = [];
    const importanceAnnotations =
      "importance_annotations" in parsedData
        ? this.#validateImportanceAnnotations(
            parsedData.importance_annotations,
            issues,
          )
        : undefined;
    const fragmentSummary =
      "fragment_summary" in parsedData
        ? parsedData.fragment_summary
        : undefined;
    const links = normalizeChunkLinks(parsedData.links);

    for (const [index, data] of parsedData.chunks.entries()) {
      const chunkIndex = index + 1;
      const chunkIssues: string[] = [];
      const label = data.label.trim();
      const content = data.content.trim();

      if (label === "") {
        chunkIssues.push(
          `Chunk #${chunkIndex}: Missing or empty "label" field`,
        );
      }

      if (content === "") {
        chunkIssues.push(
          `Chunk #${chunkIndex}: Missing or empty "content" field`,
        );
      }

      const [matchedSentenceIds, evidenceFailure] =
        await this.#resolveChunkEvidence({
          chunkIndex,
          chunkLabel: label,
          data,
          isLastGenerationAttempt: input.isLastGenerationAttempt,
        });

      if (matchedSentenceIds.length === 0) {
        if (evidenceFailure !== undefined) {
          chunkIssues.push(
            `Chunk #${chunkIndex} ("${label}"): ${evidenceFailure.message}`,
          );
        } else {
          chunkIssues.push(
            `Chunk #${chunkIndex} ("${label}"): Missing evidence`,
          );
        }
      }

      if (chunkIssues.length > 0) {
        issues.push(...chunkIssues);
        continue;
      }

      const primarySentenceId = matchedSentenceIds[0];

      if (primarySentenceId === undefined) {
        issues.push(
          `Chunk #${chunkIndex} ("${label}"): Unable to resolve any sentence IDs`,
        );
        continue;
      }

      const totalWordsCount = matchedSentenceIds.reduce((sum, sentenceId) => {
        return (
          sum + (this.#wordsCountByKey[createSentenceKey(sentenceId)] ?? 0)
        );
      }, 0);

      if (this.#metadataField === ChunkMetadataField.Retention) {
        const chunkData = data as UserFocusedChunkData;

        chunks.push({
          content,
          generation: 0,
          id: 0,
          label,
          links: [],
          retention: expectChunkRetention(chunkData.retention),
          sentenceId: primarySentenceId,
          sentenceIds: [...matchedSentenceIds],
          wordsCount: totalWordsCount,
        });
      } else {
        const chunkData = data as BookCoherenceChunkData;

        chunks.push({
          content,
          generation: 0,
          id: 0,
          importance: expectChunkImportance(chunkData.importance),
          label,
          links: [],
          sentenceId: primarySentenceId,
          sentenceIds: [...matchedSentenceIds],
          wordsCount: totalWordsCount,
        });
      }

      tempIds.push(data.temp_id);
    }

    const validLinks = this.#filterAndValidateLinks({
      issues,
      links,
      tempIds,
      visibleChunkIds: this.#visibleChunkIds,
    });

    if (issues.length > 0) {
      throw new ParsedJsonError(issues);
    }

    return {
      chunkBatch: {
        chunks,
        links: validLinks,
        orderCorrect: true,
        tempIds,
        ...(importanceAnnotations === undefined
          ? {}
          : { importanceAnnotations }),
      },
      ...(fragmentSummary === undefined ? {} : { fragmentSummary }),
    };
  }

  public async getChunkSourceSentences(
    chunk: CognitiveChunk,
  ): Promise<string[]> {
    const sourceSentences: string[] = [];

    for (const sentenceId of chunk.sentenceIds) {
      const sentenceKey = createSentenceKey(sentenceId);
      const sentenceText = this.#sentenceTextByKey[sentenceKey];

      if (sentenceText !== undefined) {
        sourceSentences.push(sentenceText);
        continue;
      }

      sourceSentences.push(
        await this.#sentenceTextSource.getSentence(sentenceId),
      );
    }

    return sourceSentences;
  }

  async #resolveChunkEvidence(
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

  #validateImportanceAnnotations(
    annotations: readonly {
      readonly chunk_id: number;
      readonly importance: ChunkImportance;
    }[],
    issues: string[],
  ): ChunkImportanceAnnotation[] | undefined {
    if (annotations.length === 0) {
      return [];
    }

    if (this.#validImportanceChunkIds === undefined) {
      return annotations.map((annotation) => ({
        chunkId: annotation.chunk_id,
        importance: expectChunkImportance(annotation.importance),
      }));
    }

    const result: ChunkImportanceAnnotation[] = [];

    for (const annotation of annotations) {
      if (!hasMembership(this.#validImportanceChunkIds, annotation.chunk_id)) {
        issues.push(
          `importance_annotations references unknown chunk_id ${annotation.chunk_id}`,
        );
        continue;
      }

      result.push({
        chunkId: annotation.chunk_id,
        importance: expectChunkImportance(annotation.importance),
      });
    }

    return result;
  }

  #filterAndValidateLinks(input: {
    issues: string[];
    links: readonly ChunkLink[];
    tempIds: readonly string[];
    visibleChunkIds: readonly number[];
  }): ChunkLink[] {
    const validTempIds = createMembershipRecord(input.tempIds);
    const validChunkIds = createMembershipRecord(input.visibleChunkIds);
    const retainedLinks: ChunkLink[] = [];

    for (const [index, link] of input.links.entries()) {
      const fromValid = this.#validateLinkReference({
        fieldName: "from",
        index: index + 1,
        issues: input.issues,
        reference: link.from,
        validChunkIds,
        validTempIds,
      });
      const toValid = this.#validateLinkReference({
        fieldName: "to",
        index: index + 1,
        issues: input.issues,
        reference: link.to,
        validChunkIds,
        validTempIds,
      });

      if (fromValid && toValid) {
        retainedLinks.push(link);
      }
    }

    return retainedLinks;
  }

  #validateLinkReference(input: {
    fieldName: "from" | "to";
    index: number;
    issues: string[];
    reference: number | string;
    validChunkIds: Readonly<Record<string, true>>;
    validTempIds: Readonly<Record<string, true>>;
  }): boolean {
    if (typeof input.reference === "string") {
      return hasMembership(input.validTempIds, input.reference);
    }

    if (!hasMembership(input.validChunkIds, input.reference)) {
      input.issues.push(
        `Link #${input.index}: "${input.fieldName}" chunk_id ${input.reference} does not exist in visible chunks`,
      );

      return false;
    }

    return true;
  }
}

function createWordsCountRecord(
  sentences: readonly Pick<
    ChunkExtractionSentence,
    "sentenceId" | "wordsCount"
  >[],
): Readonly<Record<string, number>> {
  const wordsCountByKey = createEmptyRecord<number>();

  for (const sentence of sentences) {
    const sentenceKey = createSentenceKey(sentence.sentenceId);
    wordsCountByKey[sentenceKey] = sentence.wordsCount;
  }

  return wordsCountByKey;
}

function createSentenceTextRecord(
  projection: FragmentProjection,
): Readonly<Record<string, string>> {
  const record = createEmptyRecord<string>();

  for (const sentence of projection.sentences) {
    record[createSentenceKey(sentence.sentenceId)] = sentence.rawText;
  }

  return record;
}

function normalizeChunkLinks(links: readonly RawChunkLink[]): ChunkLink[] {
  return links.map((link) => {
    if (link.strength === undefined) {
      return {
        from: link.from,
        to: link.to,
      };
    }

    return {
      from: link.from,
      strength: link.strength,
      to: link.to,
    };
  });
}

function formatChoiceCandidate(candidate: RankedSentenceCandidate): string {
  return [
    candidate.occurrenceId,
    `prev: ${formatChoiceText(candidate.prevText)}`,
    `text: ${formatChoiceText(candidate.text)}`,
    `next: ${formatChoiceText(candidate.nextText)}`,
  ].join("\n");
}

function formatChoiceText(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();

  return collapsed === "" ? "(none)" : collapsed;
}

function toChoiceFieldName(value: string): ChoiceFieldName | undefined {
  return value === "evidence" ||
    value === "start_anchor" ||
    value === "end_anchor"
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isParsedJsonValidationFailure(error: unknown): boolean {
  return (
    error instanceof GuaranteedParseValidationError &&
    error.cause instanceof ParsedJsonError
  );
}

function createSentenceKey(sentenceId: SentenceId): string {
  return sentenceId.join(":");
}

function createMembershipRecord(
  values: readonly (number | string)[],
): Readonly<Record<string, true>> {
  const record = createEmptyRecord<true>();

  for (const value of values) {
    record[String(value)] = true;
  }

  return record;
}

function hasMembership(
  record: Readonly<Record<string, true>>,
  value: number | string,
): boolean {
  return hasIndexedValue(record, String(value));
}

function hasIndexedValue<TValue>(
  record: Readonly<Record<string, TValue>>,
  key: string,
): boolean {
  return Object.hasOwn(record, key);
}

function createEmptyRecord<TValue>(): Record<string, TValue> {
  return Object.create(null) as Record<string, TValue>;
}

function expectSingleSpan(spans: readonly TextSpan[]): TextSpan | undefined {
  return spans.length === 1 ? spans[0] : undefined;
}

function createEvidenceSelectionList(
  evidence: RawChunkEvidence,
): EvidenceSelectionList | undefined {
  if (Array.isArray(evidence)) {
    return evidence.map(createEvidenceSelection);
  }

  const hasSelectionEvidence =
    typeof evidence.quote === "string" ||
    typeof evidence.sentence_id === "string";

  return hasSelectionEvidence ? createEvidenceSelection(evidence) : undefined;
}

function createEvidenceSelection(evidence: {
  readonly quote?: unknown;
  readonly sentence_id?: unknown;
}): {
  readonly quote?: string;
  readonly sentence_id?: string;
} {
  return {
    ...(typeof evidence.quote === "string" ? { quote: evidence.quote } : {}),
    ...(typeof evidence.sentence_id === "string"
      ? { sentence_id: evidence.sentence_id }
      : {}),
  };
}

function toEvidenceResolutionFailure(
  failure: {
    readonly candidates: readonly EvidenceSelectionCandidate[];
    readonly code: string;
    readonly message: string;
  },
  fieldName: string,
): EvidenceResolutionFailure {
  return {
    candidates: failure.candidates.map(toRankedSentenceCandidate),
    code: failure.code,
    fieldName,
    message: failure.message,
  };
}

function toRankedSentenceCandidate(
  candidate: EvidenceSelectionCandidate,
): RankedSentenceCandidate {
  return {
    exactNormalized: candidate.exactNormalized,
    exactRaw: candidate.exactRaw,
    exactSubstring: candidate.exactSubstring,
    index: candidate.index,
    nextText: candidate.nextText,
    occurrenceId: candidate.occurrenceId,
    prevText: candidate.prevText,
    score: candidate.score,
    sentenceId: candidate.sentence.sentenceId,
    text: candidate.sentence.text,
  };
}

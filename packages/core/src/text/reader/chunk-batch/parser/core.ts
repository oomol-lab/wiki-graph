import { ParsedJsonError } from "../../../../external/guaranteed/index.js";
import {
  expectChunkImportance,
  expectChunkRetention,
} from "../../../../document/index.js";
import type {
  ChunkBatch,
  ChunkExtractionSentence,
  CognitiveChunk,
  SentenceTextSource,
} from "../types.js";
import type { FragmentProjection } from "../fragment-projection.js";
import { validateImportanceAnnotations } from "./annotations.js";
import {
  createMembershipRecord,
  createSentenceKey,
  createSentenceTextRecord,
  createWordsCountRecord,
  normalizeChunkLinks,
} from "./helpers.js";
import { filterAndValidateLinks } from "./links.js";
import { ChunkEvidenceResolver } from "./resolver.js";
import {
  ChunkMetadataField,
  type BookCoherenceChunkData,
  type BookCoherenceResponseData,
  type ExtractChunksResult,
  type GuaranteedChoiceRequest,
  type UserFocusedChunkData,
  type UserFocusedResponseData,
} from "./schema.js";

export class ChunkBatchParser<
  TData extends UserFocusedResponseData | BookCoherenceResponseData,
> {
  readonly #evidenceResolver: ChunkEvidenceResolver;
  readonly #metadataField: ChunkMetadataField;
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
    this.#evidenceResolver = new ChunkEvidenceResolver({
      choiceSystemPrompt: input.choiceSystemPrompt,
      projection: input.projection,
      requestChoice: input.requestChoice,
      responseIntentClassifierPrompt: input.responseIntentClassifierPrompt,
    });
    this.#metadataField = input.metadataField;
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
        ? validateImportanceAnnotations({
            annotations: parsedData.importance_annotations,
            issues,
            validImportanceChunkIds: this.#validImportanceChunkIds,
          })
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
        await this.#evidenceResolver.resolve({
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

    const validLinks = filterAndValidateLinks({
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
}

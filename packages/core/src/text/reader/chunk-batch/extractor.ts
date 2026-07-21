import { z, type ZodType } from "zod";

import {
  GuaranteedParseValidationError,
  GuaranteedRequestFailureError,
  ParsedJsonError,
  RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
  requestGuaranteedJson,
} from "../../../external/guaranteed/index.js";
import type { Language } from "../../../runtime/common/language.js";
import {
  EVIDENCE_SELECTION_PROMPT_FRAGMENT,
  normalizeEvidenceDisplayText,
} from "../../../graph/evidence-selection/index.js";
import type { LLMessage, LLM } from "../../../external/llm/index.js";
import {
  bookCoherenceResponseSchema,
  ChunkBatchParser,
  ChunkMetadataField,
  type BookCoherenceResponseData,
  type ExtractChunksResult,
  type UserFocusedResponseData,
  userFocusedResponseSchema,
} from "./parser/index.js";
import { FragmentProjection } from "./fragment-projection.js";
import { projectFragmentText } from "./fragment-projection.js";
import { needsTranslation } from "./language.js";
import {
  BOOK_COHERENCE_PROMPT_TEMPLATE,
  EVIDENCE_CHOICE_PROMPT_TEMPLATE,
  TRANSLATE_CHUNKS_PROMPT_TEMPLATE,
  USER_FOCUSED_PROMPT_TEMPLATE,
} from "./prompt-templates.js";
import type {
  ChunkBatch,
  ChunkBatchOptions,
  ChunkExtractionSentence,
  ChunkTranslationInput,
  ChunkTranslationOutput,
  ExtractBookCoherenceInput,
  ExtractUserFocusedInput,
  ExtractUserFocusedResult,
} from "./types.js";

const MAX_CHUNK_REGENERATIONS = 7;

interface ExtractChunksInput<
  TData extends UserFocusedResponseData | BookCoherenceResponseData,
> {
  readonly emptyChunkBatch: ChunkBatch;
  readonly messages: readonly LLMessage[];
  readonly metadataField: ChunkMetadataField;
  readonly projection: FragmentProjection;
  readonly schema: ZodType<TData>;
  readonly sentences: readonly ChunkExtractionSentence[];
  readonly validImportanceChunkIds?: readonly number[];
  readonly visibleChunkIds: readonly number[];
}

interface ExtractChunksOutput<
  TData extends UserFocusedResponseData | BookCoherenceResponseData,
> {
  readonly parser: ChunkBatchParser<TData>;
  readonly result: ExtractChunksResult;
}
const TRANSLATED_CHUNK_SCHEMA = z.object({
  content: z.string(),
  id: z.number(),
  label: z.string(),
});
const TRANSLATED_CHUNKS_SCHEMA = z.array(TRANSLATED_CHUNK_SCHEMA);
const MAX_TRANSLATION_RETRIES = 3;

export class ChunkExtractor<S extends string> {
  readonly #extractionGuidance: string;
  readonly #llm: LLM<S>;
  readonly #scopes: ChunkBatchOptions<S>["scopes"];
  readonly #sentenceTextSource: ChunkBatchOptions<S>["sentenceTextSource"];
  readonly #userLanguage: Language | undefined;

  public constructor(options: ChunkBatchOptions<S>) {
    this.#extractionGuidance = options.extractionGuidance;
    this.#llm = options.llm;
    this.#scopes = options.scopes;
    this.#sentenceTextSource = options.sentenceTextSource;
    this.#userLanguage = options.userLanguage;
  }

  public async extractUserFocused(
    input: ExtractUserFocusedInput,
  ): Promise<ExtractUserFocusedResult> {
    const projection = new FragmentProjection(input.sentences);
    const messages = this.#buildMessages({
      promptTemplateName: USER_FOCUSED_PROMPT_TEMPLATE,
      templateContext: {
        extraction_guidance: this.#extractionGuidance,
        evidence_selection_prompt: EVIDENCE_SELECTION_PROMPT_FRAGMENT,
        user_language: this.#userLanguage,
        working_memory: input.workingMemoryPrompt,
      },
      text: formatEvidenceSelectionSourceText(projection),
    });
    const extraction = await this.#extractChunks({
      emptyChunkBatch: {
        chunks: [],
        links: [],
        orderCorrect: true,
        tempIds: [],
      },
      messages,
      metadataField: ChunkMetadataField.Retention,
      projection,
      schema: userFocusedResponseSchema,
      sentences: input.sentences,
      visibleChunkIds: input.visibleChunkIds,
    });

    return {
      chunkBatch: await this.#ensureChunkBatchLanguage(
        extraction.result.chunkBatch,
        extraction.parser,
      ),
      fragmentSummary: extraction.result.fragmentSummary ?? "",
    };
  }

  public async extractBookCoherence(
    input: ExtractBookCoherenceInput,
  ): Promise<ChunkBatch> {
    const projection = new FragmentProjection(input.sentences);
    const messages = this.#buildMessages({
      promptTemplateName: BOOK_COHERENCE_PROMPT_TEMPLATE,
      templateContext: {
        user_focused_chunks: input.userFocusedChunks.map((chunk) => ({
          content: chunk.content,
          id: chunk.id,
          label: chunk.label,
        })),
        evidence_selection_prompt: EVIDENCE_SELECTION_PROMPT_FRAGMENT,
        user_language: this.#userLanguage,
        working_memory: input.workingMemoryPrompt,
      },
      text: formatEvidenceSelectionSourceText(projection),
    });
    const extraction = await this.#extractChunks({
      emptyChunkBatch: {
        chunks: [],
        importanceAnnotations: [],
        links: [],
        orderCorrect: true,
        tempIds: [],
      },
      messages,
      metadataField: ChunkMetadataField.Importance,
      projection,
      schema: bookCoherenceResponseSchema,
      sentences: input.sentences,
      validImportanceChunkIds: input.userFocusedChunks.map((chunk) => chunk.id),
      visibleChunkIds: input.visibleChunkIds,
    });

    return await this.#ensureChunkBatchLanguage(
      extraction.result.chunkBatch,
      extraction.parser,
    );
  }

  #buildMessages(input: {
    promptTemplateName: string;
    templateContext: Record<string, unknown>;
    text: string;
  }): LLMessage[] {
    return [
      {
        content: this.#llm.loadSystemPrompt(
          input.promptTemplateName,
          input.templateContext,
        ),
        role: "system",
      },
      {
        content: input.text,
        role: "user",
      },
    ];
  }

  async #extractChunks<
    TData extends UserFocusedResponseData | BookCoherenceResponseData,
  >(input: ExtractChunksInput<TData>): Promise<ExtractChunksOutput<TData>> {
    return await this.#llm.withContext(
      async (context): Promise<ExtractChunksOutput<TData>> => {
        const parser = new ChunkBatchParser<TData>({
          metadataField: input.metadataField,
          projection: input.projection,
          responseIntentClassifierPrompt: this.#llm.loadSystemPrompt(
            RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
          ),
          sentenceTextSource: this.#sentenceTextSource,
          sentences: input.sentences,
          visibleChunkIds: input.visibleChunkIds,
          choiceSystemPrompt: this.#llm.loadSystemPrompt(
            EVIDENCE_CHOICE_PROMPT_TEMPLATE,
            {
              extraction_guidance: this.#extractionGuidance,
              metadata_field: input.metadataField,
              user_language: this.#userLanguage,
            },
          ),
          requestChoice: async (messages, index, maxRetries) =>
            await context.request(messages, {
              retryIndex: index,
              retryMax: maxRetries,
              scope: this.#scopes.choice,
              useCache: false,
            }),
          ...(input.validImportanceChunkIds === undefined
            ? {}
            : {
                validImportanceChunkIds: input.validImportanceChunkIds,
              }),
        });

        try {
          const result = await requestGuaranteedJson({
            messages: input.messages,
            schema: input.schema,
            maxRetries: MAX_CHUNK_REGENERATIONS,
            parse: async (data, index, maxRetries) =>
              await parser.parse(data, {
                isLastGenerationAttempt: index >= maxRetries,
              }),
            responseIntentClassifierPrompt: this.#llm.loadSystemPrompt(
              RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
            ),
            request: async (messages, index, maxRetries) =>
              await context.request(messages, {
                retryIndex: index,
                retryMax: maxRetries,
                scope: this.#scopes.extraction,
              }),
          });

          return {
            parser,
            result,
          };
        } catch (error) {
          if (isRecoverableChunkExtractionFailure(error)) {
            return {
              parser,
              result: {
                chunkBatch: input.emptyChunkBatch,
              },
            };
          }
          throw error;
        }
      },
    );
  }

  /**
   * 对于 AI 来说，原本应该直接生成正确语言的文字和摘要，但因为
   * 强迫 AI 在不同语言之间切换非常困难，经常会出现语言不符合要求的情况。
   *
   * 所以我们的处理方案是：
   * 1. 通过程序找到那些与要求语言不一致的句子
   * 2. 直接再用 AI 把这些句子翻译过去
   *
   * 这是一个保底手段。
   */
  async #ensureChunkBatchLanguage(
    chunkBatch: ChunkBatch,
    parser: ChunkBatchParser<
      UserFocusedResponseData | BookCoherenceResponseData
    >,
  ): Promise<ChunkBatch> {
    if (this.#userLanguage === undefined || chunkBatch.chunks.length === 0) {
      return chunkBatch;
    }

    const translationInput: ChunkTranslationInput[] = [];

    for (const [index, chunk] of chunkBatch.chunks.entries()) {
      if (
        !needsTranslation({
          content: chunk.content,
          label: chunk.label,
          targetLanguage: this.#userLanguage,
        })
      ) {
        continue;
      }

      translationInput.push({
        content: chunk.content,
        id: index,
        label: chunk.label,
        sourceSentences: await parser.getChunkSourceSentences(chunk),
      });
    }

    if (translationInput.length === 0) {
      return chunkBatch;
    }

    try {
      const translatedChunks = await this.#translateChunks(
        translationInput,
        this.#userLanguage,
      );
      const translatedById = createTranslatedChunkRecord(translatedChunks);

      return {
        ...chunkBatch,
        chunks: chunkBatch.chunks.map((chunk, index) => {
          const translated = translatedById[String(index)];

          if (translated === undefined) {
            return chunk;
          }

          return {
            ...chunk,
            content: translated.content,
            label: translated.label,
          };
        }),
      };
    } catch {
      return chunkBatch;
    }
  }

  async #translateChunks(
    chunks: readonly ChunkTranslationInput[],
    userLanguage: Language,
  ): Promise<readonly ChunkTranslationOutput[]> {
    return await requestGuaranteedJson({
      messages: [
        {
          content: this.#llm.loadSystemPrompt(
            TRANSLATE_CHUNKS_PROMPT_TEMPLATE,
            {
              user_language: userLanguage,
            },
          ),
          role: "system",
        },
        {
          content: JSON.stringify(chunks, undefined, 2),
          role: "user",
        },
      ],
      schema: TRANSLATED_CHUNKS_SCHEMA,
      maxRetries: MAX_TRANSLATION_RETRIES,
      parse: (data) => {
        validateTranslatedChunks(chunks, data);
        return data;
      },
      responseIntentClassifierPrompt: this.#llm.loadSystemPrompt(
        RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
      ),
      request: async (messages, index, maxRetries) =>
        await this.#llm.request(messages, {
          retryIndex: index,
          retryMax: maxRetries,
          scope: this.#scopes.extraction,
        }),
    });
  }
}

function formatEvidenceSelectionSourceText(
  projection: FragmentProjection,
): string {
  return projection.sentences
    .map(
      (sentence, index) =>
        `S${index + 1}: ${projectFragmentText(
          normalizeEvidenceDisplayText(sentence.rawText),
        )}`,
    )
    .join("\n");
}

function isParsedJsonValidationFailure(error: unknown): boolean {
  return (
    error instanceof GuaranteedParseValidationError &&
    error.cause instanceof ParsedJsonError
  );
}

function isRecoverableChunkExtractionFailure(error: unknown): boolean {
  return (
    isParsedJsonValidationFailure(error) ||
    error instanceof GuaranteedRequestFailureError
  );
}

function createTranslatedChunkRecord(
  translatedChunks: readonly ChunkTranslationOutput[],
): Readonly<Record<string, ChunkTranslationOutput>> {
  const record = Object.create(null) as Record<string, ChunkTranslationOutput>;

  for (const chunk of translatedChunks) {
    record[String(chunk.id)] = chunk;
  }

  return record;
}

function validateTranslatedChunks(
  chunks: readonly ChunkTranslationInput[],
  translatedChunks: readonly ChunkTranslationOutput[],
): void {
  const issues: string[] = [];

  if (translatedChunks.length !== chunks.length) {
    issues.push(
      `Expected ${chunks.length} translated chunk(s), got ${translatedChunks.length}`,
    );
  }

  for (const [index, chunk] of chunks.entries()) {
    const translatedChunk = translatedChunks[index];

    if (translatedChunk === undefined) {
      issues.push(`Missing translated chunk at position ${index}`);
      continue;
    }

    if (translatedChunk.id !== chunk.id) {
      issues.push(
        `Translated chunk at position ${index} must keep id ${chunk.id}, got ${translatedChunk.id}`,
      );
    }
  }

  if (issues.length > 0) {
    throw new ParsedJsonError(issues);
  }
}

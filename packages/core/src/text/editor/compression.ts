import type { Language } from "../../runtime/common/language.js";
import type { LLM } from "../../external/llm/index.js";
import type {
  ChunkRecord,
  ReadonlyDocument,
  ReadonlySerialFragments,
} from "../../document/index.js";
import { extractCluesFromDocument, type Clue } from "./clue.js";
import { CompressionRequester } from "./compressor.js";
import {
  calculateScore,
  createRevisionFeedback,
  pickBestVersion,
} from "./feedback.js";
import { checkOutputLanguage } from "./language-review.js";
import { CompressionLog } from "./log.js";
import { formatChunksAsBook } from "./markup.js";
import {
  cleanChunkTags,
  extractCompressedText,
  extractThinkingText,
} from "./response.js";
import { CompressionReviewer, type ReviewerHistories } from "./review.js";
import type { CompressionVersion } from "./types.js";

export interface EditorScopes<S extends string> {
  readonly compress: S;
  readonly review: S;
  readonly reviewGuide: S;
}

export interface EditorOptions<S extends string> {
  readonly compressionRatio?: number;
  readonly document?: ReadonlyDocument;
  readonly groupId: number;
  readonly llm: LLM<S>;
  readonly logDirPath?: string;
  readonly maxClues?: number;
  readonly maxIterations?: number;
  readonly scopes: EditorScopes<S>;
  readonly serialId: number;
  readonly userLanguage?: Language;
  /** @deprecated Use `document` instead. */
  readonly workspace?: ReadonlyDocument;
}

export async function compressText<S extends string>(
  options: EditorOptions<S>,
): Promise<string> {
  return await new EditorOperation(options).run();
}

class EditorOperation<S extends string> {
  readonly #compressionRatio: number;
  readonly #groupId: number;
  readonly #llm: LLM<S>;
  readonly #log: CompressionLog;
  readonly #maxClues: number;
  readonly #maxIterations: number;
  readonly #compressor: CompressionRequester<S>;
  readonly #reviewer: CompressionReviewer<S>;
  readonly #reviewScope: EditorScopes<S>;
  readonly #serialFragments: ReadonlySerialFragments;
  readonly #serialId: number;
  readonly #userLanguage: Language | undefined;
  readonly #document: ReadonlyDocument;

  public constructor(options: EditorOptions<S>) {
    const document = resolveDocument(options);

    this.#compressionRatio = options.compressionRatio ?? 0.2;
    this.#groupId = options.groupId;
    this.#llm = options.llm;
    this.#maxClues = options.maxClues ?? 10;
    this.#maxIterations = options.maxIterations ?? 5;
    this.#reviewScope = options.scopes;
    this.#serialFragments = document.getSerialFragments(options.serialId);
    this.#serialId = options.serialId;
    this.#userLanguage = options.userLanguage;
    this.#document = document;
    this.#compressor = new CompressionRequester(
      this.#llm,
      options.scopes.compress,
      this.#compressionRatio,
      this.#userLanguage,
    );
    this.#log = new CompressionLog(this.#serialId, this.#groupId, {
      compressionRatio: this.#compressionRatio,
      maxIterations: this.#maxIterations,
      ...(options.logDirPath === undefined
        ? {}
        : {
            logDirPath: options.logDirPath,
          }),
    });
    this.#reviewer = new CompressionReviewer(
      this.#llm,
      this.#serialFragments,
      {
        review: this.#reviewScope.review,
        reviewGuide: this.#reviewScope.reviewGuide,
      },
      this.#userLanguage,
    );
  }

  public async run(): Promise<string> {
    const groups = await this.#listTargetGroups();
    const segmentStartIndexes = await this.#getGroupSegmentStartIndexes(groups);

    if (segmentStartIndexes.length === 0) {
      return "";
    }

    const clues = await extractCluesFromDocument({
      document: this.#document,
      groupId: this.#groupId,
      maxClues: this.#maxClues,
      serialId: this.#serialId,
    });
    const originalText = await this.#getFullText(groups);

    if (originalText.trim() === "") {
      return "";
    }

    await this.#log.initialize(clues);

    const markedOriginalText = await formatChunksAsBook({
      chunks: listClueChunks(clues),
      segmentStartIndexes,
      serialFragments: this.#serialFragments,
      wrapHighRetention: true,
    });
    const clueReviewers = await this.#reviewer.generateClueReviewers(clues);
    const targetLength = Math.floor(
      originalText.length * this.#compressionRatio,
    );
    const versions: CompressionVersion[] = [];
    const reviewerHistories = Object.create(null) as ReviewerHistories;
    let previousCompressedText: string | undefined;
    let revisionFeedback: string | undefined;

    for (let iteration = 1; iteration <= this.#maxIterations; iteration += 1) {
      await this.#log.appendIterationHeader(iteration, revisionFeedback);

      const fullResponse = await this.#compressor.request({
        markedText: markedOriginalText,
        targetLength,
        ...(previousCompressedText === undefined
          ? {}
          : {
              previousCompressedText,
            }),
        ...(revisionFeedback === undefined
          ? {}
          : {
              revisionFeedback,
            }),
      });
      const compressedText = cleanChunkTags(
        extractCompressedText(fullResponse),
      );
      const thinkingText = extractThinkingText(fullResponse);

      await this.#log.appendCompressionResult({
        compressedText,
        thinkingText,
      });

      const reviewOutput = await this.#reviewer.reviewCompression(
        compressedText,
        clueReviewers,
        reviewerHistories,
      );
      const reviews = [...reviewOutput.reviews];
      const languageReview = checkOutputLanguage({
        compressedText,
        ...(this.#userLanguage === undefined
          ? {}
          : {
              userLanguage: this.#userLanguage,
            }),
      });

      if (languageReview !== undefined) {
        reviews.push(languageReview.review);
        await this.#log.appendLanguageMismatch({
          detectedLanguageCode: languageReview.detectedLanguageCode,
          review: languageReview.review,
          targetLanguageCode: languageReview.targetLanguageCode,
          userLanguage: this.#userLanguage,
        });
      }

      const score = calculateScore(reviews);

      versions.push({
        iteration,
        reviews,
        score,
        text: compressedText,
      });

      if (score === 0) {
        break;
      }

      if (iteration >= this.#maxIterations) {
        continue;
      }

      revisionFeedback = createRevisionFeedback({
        llm: this.#llm,
        reviews,
      });
      previousCompressedText = compressedText;

      for (const clueId of Object.keys(reviewOutput.rawResponses)) {
        const rawResponse = reviewOutput.rawResponses[clueId];

        if (rawResponse === undefined) {
          continue;
        }

        reviewerHistories[clueId] = [compressedText, rawResponse];
      }
    }

    const bestVersion = pickBestVersion(versions);

    await this.#log.appendFinalSelection(bestVersion, originalText.length);

    return bestVersion.text;
  }

  async #listTargetGroups(): Promise<readonly SentenceGroup[]> {
    return (await this.#document.fragmentGroups.listBySerial(this.#serialId))
      .filter((record) => record.groupId === this.#groupId)
      .map((record) => ({
        endSentenceIndex: record.endSentenceIndex,
        startSentenceIndex: record.startSentenceIndex,
      }));
  }

  async #getGroupSegmentStartIndexes(
    groups: readonly SentenceGroup[],
  ): Promise<number[]> {
    const segmentStartIndexes = [
      ...(await this.#serialFragments.listFragmentIds()),
    ].sort(compareNumber);
    const coveredStartIndexes = new Set<number>();

    for (const group of groups) {
      for (let index = 0; index < segmentStartIndexes.length; index += 1) {
        const startSentenceIndex = segmentStartIndexes[index];

        if (startSentenceIndex === undefined) {
          continue;
        }

        const nextStartSentenceIndex = segmentStartIndexes[index + 1];
        const endSentenceIndex =
          nextStartSentenceIndex === undefined
            ? Infinity
            : nextStartSentenceIndex - 1;

        if (
          startSentenceIndex <= group.endSentenceIndex &&
          endSentenceIndex >= group.startSentenceIndex
        ) {
          coveredStartIndexes.add(startSentenceIndex);
        }
      }
    }

    return [...coveredStartIndexes].sort(compareNumber);
  }

  async #getFullText(groups: readonly SentenceGroup[]): Promise<string> {
    const fragments = await Promise.all(
      groups.map(async (group) => ({
        sentences: await this.#listGroupSentences(
          group.startSentenceIndex,
          group.endSentenceIndex,
        ),
      })),
    );

    return fragments
      .flatMap((fragment) =>
        fragment.sentences.map((sentence) => sentence.text),
      )
      .join(" ");
  }

  async #listGroupSentences(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<readonly { readonly text: string }[]> {
    if (this.#serialFragments.listSentencesInRange !== undefined) {
      return await this.#serialFragments.listSentencesInRange(
        startSentenceIndex,
        endSentenceIndex,
      );
    }

    const segmentStartIndexes = [
      ...(await this.#serialFragments.listFragmentIds()),
    ].sort(compareNumber);
    const fragments = await Promise.all(
      segmentStartIndexes
        .filter((segmentStartIndex, index) => {
          const nextStartSentenceIndex = segmentStartIndexes[index + 1];
          const segmentEndSentenceIndex =
            nextStartSentenceIndex === undefined
              ? Infinity
              : nextStartSentenceIndex - 1;

          return (
            segmentStartIndex <= endSentenceIndex &&
            segmentEndSentenceIndex >= startSentenceIndex
          );
        })
        .map(
          async (startSentenceIndex) =>
            await this.#serialFragments.getFragment(startSentenceIndex),
        ),
    );

    return fragments.flatMap((fragment) =>
      fragment.sentences.filter((_sentence, index) => {
        const sentenceIndex = fragment.fragmentId + index;

        return (
          sentenceIndex >= startSentenceIndex &&
          sentenceIndex <= endSentenceIndex
        );
      }),
    );
  }
}

interface SentenceGroup {
  readonly endSentenceIndex: number;
  readonly startSentenceIndex: number;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function listClueChunks(clues: readonly Clue[]): ChunkRecord[] {
  return clues.flatMap((clue) => clue.chunks);
}

function resolveDocument<S extends string>(
  options: EditorOptions<S>,
): ReadonlyDocument {
  const document = options.document ?? options.workspace;

  if (document === undefined) {
    throw new Error("Editor requires a document");
  }

  return document;
}

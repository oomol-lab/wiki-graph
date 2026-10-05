import {
  executeChapterJobFile,
  JOB_LLM_SCOPES,
  type ChapterJobFileExecutor,
  type JobEmbeddingProvider,
  type JobLlm,
  type JobWikispineMatcher,
} from "wiki-graph-job";

import type { LLM } from "../../external/llm/index.js";
import type { WikimediaResolver } from "../../external/wikipage/index.js";
import {
  matchWikispineSentenceCandidates,
  type MatchWikispineSentenceCandidatesOptions,
} from "../../external/wikimatch/index.js";
import { WikiGraphScope } from "../../runtime/common/llm-scope.js";

export interface LocalChapterJobFileExecutorOptions {
  readonly embeddingProvider?: JobEmbeddingProvider;
  readonly llm?: LLM<WikiGraphScope>;
  readonly wikimediaResolver?: WikimediaResolver;
  readonly wikispine?: Pick<
    MatchWikispineSentenceCandidatesOptions,
    | "command"
    | "commandRunner"
    | "dataDir"
    | "endpoint"
    | "fetch"
    | "provider"
    | "token"
  >;
}

export function createLocalChapterJobFileExecutor(
  options: LocalChapterJobFileExecutorOptions,
): ChapterJobFileExecutor {
  const coreLlm = options.llm;
  const llm: JobLlm | undefined =
    coreLlm === undefined
      ? undefined
      : {
          async request(messages, requestOptions) {
            return await coreLlm.request(messages, {
              ...(requestOptions.retryIndex === undefined
                ? {}
                : { retryIndex: requestOptions.retryIndex }),
              ...(requestOptions.retryMax === undefined
                ? {}
                : { retryMax: requestOptions.retryMax }),
              scope: mapJobLlmScope(requestOptions.scope),
              ...(requestOptions.signal === undefined
                ? {}
                : { signal: requestOptions.signal }),
            });
          },
        };
  const wikispine: JobWikispineMatcher = {
    async *match(input) {
      for await (const candidate of matchWikispineSentenceCandidates({
        ...(options.wikispine ?? {}),
        includeDisambiguation: input.includeDisambiguation,
        ...(input.onProgress === undefined
          ? {}
          : { onProgress: input.onProgress }),
        sentences: input.sentences,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })) {
        yield {
          end: candidate.range.end,
          qids: candidate.qidOptions.map((option) => ({
            disambiguation: option.isDisambiguation === true,
            qid: option.qid,
          })),
          start: candidate.range.start,
        };
      }
    },
  };
  return async (execution) =>
    await executeChapterJobFile({
      ...execution,
      ...(options.embeddingProvider === undefined
        ? {}
        : { embeddingProvider: options.embeddingProvider }),
      ...(llm === undefined ? {} : { llm }),
      ...(options.wikimediaResolver === undefined
        ? {}
        : { wikimedia: options.wikimediaResolver }),
      wikispine,
    });
}

function mapJobLlmScope(scope: string): WikiGraphScope {
  switch (scope) {
    case JOB_LLM_SCOPES.readingSummaryCompress:
      return WikiGraphScope.EditorCompress;
    case JOB_LLM_SCOPES.readingSummaryReview:
      return WikiGraphScope.EditorReview;
    case JOB_LLM_SCOPES.readingSummaryReviewGuide:
      return WikiGraphScope.EditorReviewGuide;
    case JOB_LLM_SCOPES.readingGraphEvidenceChoice:
      return WikiGraphScope.ReaderChoice;
    default:
      return WikiGraphScope.ReaderExtraction;
  }
}

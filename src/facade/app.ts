import type { LanguageModel } from "ai";

import { resolveDataDirPath } from "../common/data-dir.js";
import type { Language } from "../common/language.js";
import type { SpineDigestScope } from "../common/llm-scope.js";
import { withLoggingContext } from "../common/logging.js";
import { LLM } from "../llm/index.js";
import type {
  DigestProgressEvent,
  SerialDiscoveryItem,
  SerialsDiscoveredEvent,
  SerialProgressEvent,
  SpineDigestProgressCallback,
  SpineDigestProgressEvent,
  SpineDigestProgressEventType,
  SpineDigestOperation,
} from "../progress/index.js";

import {
  digestEpubSession,
  digestMarkdownSession,
  digestTextStreamSession,
  digestTxtSession,
  type DigestDocumentSessionOptions,
  type DigestSourceSessionOptions,
  type DigestTextStreamSessionOptions,
} from "./digest.js";
import { createDefaultSpineDigestSampling } from "./llm-sampling.js";
import { SpineDigestFile } from "./spine-digest-file.js";
import type { SpineDigest } from "./spine-digest.js";
import type { ChapterStage } from "./chapter.js";

const DATA_DIR_PATH = resolveDataDirPath();

const DEFAULT_EXTRACTION_PROMPT =
  "Focus on the main storyline and key character developments. Preserve important dialogues and critical plot points. Background descriptions and minor details can be compressed significantly.";

export interface SpineDigestLLMOptions {
  readonly cacheDirPath?: string;
  readonly concurrent?: number;
  readonly logDirPath?: string;
  readonly model: LanguageModel;
  readonly retryIntervalSeconds?: number;
  readonly retryTimes?: number;
  readonly stream?: boolean;
  readonly temperature?: number | readonly number[];
  readonly timeout?: number;
  readonly topP?: number | readonly number[];
}

export interface SpineDigestAppOptions {
  readonly debugLogDirPath?: string;
  readonly llm?: LanguageModel | SpineDigestLLMOptions;
  readonly verbose?: boolean;
}

export type SpineDigestOpenSessionOptions = DigestDocumentSessionOptions;

export interface SpineDigestSourceSessionOptions extends DigestDocumentSessionOptions {
  readonly extractionPrompt?: string;
  readonly onProgress?: SpineDigestProgressCallback;
  readonly path: string;
  readonly targetStage?: ChapterStage;
  readonly userLanguage?: Language;
}

export interface SpineDigestTextStreamSessionOptions extends DigestDocumentSessionOptions {
  readonly bookLanguage?: string | null;
  readonly extractionPrompt?: string;
  readonly onProgress?: SpineDigestProgressCallback;
  readonly sourceFormat?: "markdown" | "txt";
  readonly stream: AsyncIterable<string> | Iterable<string>;
  readonly targetStage?: ChapterStage;
  readonly title?: string | null;
  readonly userLanguage?: Language;
}

export class SpineDigestApp {
  readonly #debugLogDirPath: string | undefined;
  readonly #llm: LLM<SpineDigestScope> | undefined;
  readonly #verbose: boolean;

  public constructor(options: SpineDigestAppOptions) {
    this.#debugLogDirPath = options.debugLogDirPath;
    this.#verbose = options.verbose ?? false;
    if (options.llm === undefined) {
      this.#llm = undefined;
      return;
    }
    const llmOptions = normalizeLLMOptions(options.llm);

    this.#llm = new LLM<SpineDigestScope>({
      dataDirPath: DATA_DIR_PATH,
      sampling: createDefaultSpineDigestSampling({
        ...(llmOptions.temperature === undefined
          ? {}
          : { temperature: llmOptions.temperature }),
        ...(llmOptions.topP === undefined ? {} : { topP: llmOptions.topP }),
      }),
      ...llmOptions,
    });
  }

  public async digestEpubSession<T>(
    options: SpineDigestSourceSessionOptions,
    operation: (digest: SpineDigest) => Promise<T> | T,
  ): Promise<T> {
    return await this.#withLogging(
      "digest-epub",
      async () =>
        await digestEpubSession(this.#createSourceOptions(options), operation),
    );
  }

  public async digestMarkdownSession<T>(
    options: SpineDigestSourceSessionOptions,
    operation: (digest: SpineDigest) => Promise<T> | T,
  ): Promise<T> {
    return await this.#withLogging(
      "digest-markdown",
      async () =>
        await digestMarkdownSession(
          this.#createSourceOptions(options),
          operation,
        ),
    );
  }

  public async digestTextStreamSession<T>(
    options: SpineDigestTextStreamSessionOptions,
    operation: (digest: SpineDigest) => Promise<T> | T,
  ): Promise<T> {
    return await this.#withLogging(
      "digest-text-stream",
      async () =>
        await digestTextStreamSession(
          {
            extractionPrompt: resolveExtractionPrompt(options.extractionPrompt),
            ...optionalLLM(this.#resolveStageLLM(options.targetStage)),
            ...(options.onProgress === undefined
              ? {}
              : { onProgress: options.onProgress }),
            stream: options.stream,
            ...(this.#debugLogDirPath === undefined
              ? {}
              : { logDirPath: this.#debugLogDirPath }),
            ...(options.bookLanguage === undefined
              ? {}
              : { bookLanguage: options.bookLanguage }),
            ...(options.documentDirPath === undefined
              ? {}
              : { documentDirPath: options.documentDirPath }),
            ...(options.sourceFormat === undefined
              ? {}
              : { sourceFormat: options.sourceFormat }),
            ...(options.targetStage === undefined
              ? {}
              : { targetStage: options.targetStage }),
            ...(options.title === undefined ? {} : { title: options.title }),
            ...(options.userLanguage === undefined
              ? {}
              : { userLanguage: options.userLanguage }),
          } satisfies DigestTextStreamSessionOptions,
          operation,
        ),
    );
  }

  public async digestTxtSession<T>(
    options: SpineDigestSourceSessionOptions,
    operation: (digest: SpineDigest) => Promise<T> | T,
  ): Promise<T> {
    return await this.#withLogging(
      "digest-txt",
      async () =>
        await digestTxtSession(this.#createSourceOptions(options), operation),
    );
  }

  public async openSession<T>(
    path: string,
    operation: (digest: SpineDigest) => Promise<T> | T,
    options: SpineDigestOpenSessionOptions = {},
  ): Promise<T> {
    return await this.#withLogging(
      "open-wikg",
      async () =>
        await new SpineDigestFile(path).read(operation, {
          ...(options.documentDirPath === undefined
            ? {}
            : { documentDirPath: options.documentDirPath }),
        }),
    );
  }

  #createSourceOptions(
    options: SpineDigestSourceSessionOptions,
  ): DigestSourceSessionOptions {
    return {
      extractionPrompt: resolveExtractionPrompt(options.extractionPrompt),
      ...optionalLLM(this.#resolveStageLLM(options.targetStage)),
      ...(options.onProgress === undefined
        ? {}
        : { onProgress: options.onProgress }),
      path: options.path,
      ...(this.#debugLogDirPath === undefined
        ? {}
        : { logDirPath: this.#debugLogDirPath }),
      ...(options.documentDirPath === undefined
        ? {}
        : { documentDirPath: options.documentDirPath }),
      ...(options.targetStage === undefined
        ? {}
        : { targetStage: options.targetStage }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    };
  }

  #requireLLM(): LLM<SpineDigestScope> {
    if (this.#llm === undefined) {
      throw new Error(
        "LLM is required for digest operations. Configure `llm` when constructing SpineDigestApp.",
      );
    }

    return this.#llm;
  }

  #resolveStageLLM(
    targetStage: ChapterStage | undefined,
  ): LLM<SpineDigestScope> | undefined {
    if (targetStage === "planned" || targetStage === "sourced") {
      return undefined;
    }

    return this.#requireLLM();
  }

  async #withLogging<T>(operation: string, task: () => Promise<T>): Promise<T> {
    return await withLoggingContext(
      {
        operation,
        ...(this.#debugLogDirPath === undefined
          ? {}
          : { logDirPath: this.#debugLogDirPath }),
        ...(this.#verbose ? { verbose: true } : {}),
      },
      task,
    );
  }
}

export type {
  DigestProgressEvent,
  SerialDiscoveryItem,
  SerialsDiscoveredEvent,
  SerialProgressEvent,
  SpineDigestProgressCallback,
  SpineDigestProgressEvent,
  SpineDigestProgressEventType,
  SpineDigestOperation,
};

function optionalLLM(
  llm: LLM<SpineDigestScope> | undefined,
): { readonly llm: LLM<SpineDigestScope> } | Record<string, never> {
  return llm === undefined ? {} : { llm };
}

function normalizeLLMOptions(
  llm: NonNullable<SpineDigestAppOptions["llm"]>,
): SpineDigestLLMOptions {
  if (isSpineDigestLLMOptions(llm)) {
    return llm;
  }

  return { model: llm };
}

function isSpineDigestLLMOptions(
  llm: NonNullable<SpineDigestAppOptions["llm"]>,
): llm is SpineDigestLLMOptions {
  return typeof llm === "object" && llm !== null && "model" in llm;
}

function resolveExtractionPrompt(prompt: string | undefined): string {
  const normalizedPrompt = prompt?.trim();

  return normalizedPrompt === undefined || normalizedPrompt === ""
    ? DEFAULT_EXTRACTION_PROMPT
    : normalizedPrompt;
}

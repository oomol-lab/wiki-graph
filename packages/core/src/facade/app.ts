import type { LanguageModel } from "ai";

import { resolveDataDirPath } from "../common/data-dir.js";
import type { Language } from "../common/language.js";
import type { WikiGraphScope } from "../common/llm-scope.js";
import { withLoggingContext } from "../common/logging.js";
import { LLM } from "../llm/index.js";
import type {
  DigestProgressEvent,
  SerialDiscoveryItem,
  SerialsDiscoveredEvent,
  SerialProgressEvent,
  WikiGraphProgressCallback,
  WikiGraphProgressEvent,
  WikiGraphProgressEventType,
  WikiGraphOperation,
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
import { createDefaultWikiGraphSampling } from "./llm-sampling.js";
import { WikiGraphArchiveFile } from "../wikg/index.js";
import type { WikiGraphArchive } from "./wiki-graph-archive.js";
import type { ChapterStage } from "./chapter.js";
import { resolveExtractionPrompt } from "./prompts.js";

const DATA_DIR_PATH = resolveDataDirPath();

export interface WikiGraphLLMOptions {
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

export interface WikiGraphOptions {
  readonly debugLogDirPath?: string;
  readonly llm?: LanguageModel | WikiGraphLLMOptions;
  readonly verbose?: boolean;
}

export type WikiGraphOpenSessionOptions = DigestDocumentSessionOptions;

export interface WikiGraphSourceSessionOptions extends DigestDocumentSessionOptions {
  readonly extractionPrompt?: string;
  readonly onProgress?: WikiGraphProgressCallback;
  readonly path: string;
  readonly targetStage?: ChapterStage;
  readonly userLanguage?: Language;
}

export interface WikiGraphTextStreamSessionOptions extends DigestDocumentSessionOptions {
  readonly bookLanguage?: string | null;
  readonly extractionPrompt?: string;
  readonly onProgress?: WikiGraphProgressCallback;
  readonly sourceFormat?: "markdown" | "txt";
  readonly stream: AsyncIterable<string> | Iterable<string>;
  readonly targetStage?: ChapterStage;
  readonly title?: string | null;
  readonly userLanguage?: Language;
}

export class WikiGraph {
  readonly #debugLogDirPath: string | undefined;
  readonly #llm: LLM<WikiGraphScope> | undefined;
  readonly #verbose: boolean;

  public constructor(options: WikiGraphOptions) {
    this.#debugLogDirPath = options.debugLogDirPath;
    this.#verbose = options.verbose ?? false;
    if (options.llm === undefined) {
      this.#llm = undefined;
      return;
    }
    const llmOptions = normalizeLLMOptions(options.llm);

    this.#llm = new LLM<WikiGraphScope>({
      dataDirPath: DATA_DIR_PATH,
      sampling: createDefaultWikiGraphSampling({
        ...(llmOptions.temperature === undefined
          ? {}
          : { temperature: llmOptions.temperature }),
        ...(llmOptions.topP === undefined ? {} : { topP: llmOptions.topP }),
      }),
      ...llmOptions,
    });
  }

  public async digestEpubSession<T>(
    options: WikiGraphSourceSessionOptions,
    operation: (digest: WikiGraphArchive) => Promise<T> | T,
  ): Promise<T> {
    return await this.#withLogging(
      "digest-epub",
      async () =>
        await digestEpubSession(this.#createSourceOptions(options), operation),
    );
  }

  public async digestMarkdownSession<T>(
    options: WikiGraphSourceSessionOptions,
    operation: (digest: WikiGraphArchive) => Promise<T> | T,
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
    options: WikiGraphTextStreamSessionOptions,
    operation: (digest: WikiGraphArchive) => Promise<T> | T,
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
    options: WikiGraphSourceSessionOptions,
    operation: (digest: WikiGraphArchive) => Promise<T> | T,
  ): Promise<T> {
    return await this.#withLogging(
      "digest-txt",
      async () =>
        await digestTxtSession(this.#createSourceOptions(options), operation),
    );
  }

  public async openSession<T>(
    path: string,
    operation: (digest: WikiGraphArchive) => Promise<T> | T,
    options: WikiGraphOpenSessionOptions = {},
  ): Promise<T> {
    return await this.#withLogging(
      "open-wikg",
      async () =>
        await new WikiGraphArchiveFile(path).read(operation, {
          ...(options.documentDirPath === undefined
            ? {}
            : { documentDirPath: options.documentDirPath }),
        }),
    );
  }

  #createSourceOptions(
    options: WikiGraphSourceSessionOptions,
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

  #requireLLM(): LLM<WikiGraphScope> {
    if (this.#llm === undefined) {
      throw new Error(
        "LLM is required for digest operations. Configure `llm` when constructing WikiGraph.",
      );
    }

    return this.#llm;
  }

  #resolveStageLLM(
    targetStage: ChapterStage | undefined,
  ): LLM<WikiGraphScope> | undefined {
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
  WikiGraphProgressCallback,
  WikiGraphProgressEvent,
  WikiGraphProgressEventType,
  WikiGraphOperation,
};

function optionalLLM(
  llm: LLM<WikiGraphScope> | undefined,
): { readonly llm: LLM<WikiGraphScope> } | Record<string, never> {
  return llm === undefined ? {} : { llm };
}

function normalizeLLMOptions(
  llm: NonNullable<WikiGraphOptions["llm"]>,
): WikiGraphLLMOptions {
  if (isWikiGraphLLMOptions(llm)) {
    return llm;
  }

  return { model: llm };
}

function isWikiGraphLLMOptions(
  llm: NonNullable<WikiGraphOptions["llm"]>,
): llm is WikiGraphLLMOptions {
  return typeof llm === "object" && llm !== null && "model" in llm;
}

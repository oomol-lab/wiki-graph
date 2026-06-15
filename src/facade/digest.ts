import { mkdtemp, rm } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";

import { BOOK_META_VERSION, TOC_FILE_VERSION } from "../source/index.js";
import {
  EPUB_SOURCE_ADAPTER,
  MARKDOWN_SOURCE_ADAPTER,
  TXT_SOURCE_ADAPTER,
  type SourceFormat,
  type SourceAdapter,
} from "../source/index.js";
import { DirectoryDocument } from "../document/index.js";
import type { Language } from "../common/language.js";
import type { SpineDigestScope } from "../common/llm-scope.js";
import {
  createDigestProgressTracker,
  type SpineDigestProgressCallback,
} from "../progress/index.js";
import type { ReaderSegmenter, ReaderTextStream } from "../reader/index.js";
import type { LLM } from "../llm/index.js";
import { SerialGeneration, writeSerialSource } from "../serial.js";

import { importSource } from "./import.js";
import { SpineDigest } from "./spine-digest.js";
import type { ChapterStage } from "./chapter.js";

interface DigestSessionOptions {
  readonly documentDirPath?: string;
  readonly extractionPrompt: string;
  readonly llm?: LLM<SpineDigestScope>;
  readonly logDirPath?: string;
  readonly onProgress?: SpineDigestProgressCallback;
  readonly segmenter?: ReaderSegmenter;
  readonly targetStage?: ChapterStage;
  readonly userLanguage?: Language;
}

export interface DigestDocumentSessionOptions {
  readonly documentDirPath?: string;
}

export interface DigestSourceSessionOptions extends DigestSessionOptions {
  readonly path: string;
}

export interface DigestTextStreamSessionOptions extends DigestSessionOptions {
  readonly bookLanguage?: string | null;
  readonly sourceFormat?: Extract<SourceFormat, "markdown" | "txt">;
  readonly stream: ReaderTextStream;
  readonly title?: string | null;
}

export async function digestEpubSession<T>(
  options: DigestSourceSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  return await digestSourceSession(
    "digest-epub",
    EPUB_SOURCE_ADAPTER,
    options,
    operation,
  );
}

export async function digestMarkdownSession<T>(
  options: DigestSourceSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  return await digestSourceSession(
    "digest-markdown",
    MARKDOWN_SOURCE_ADAPTER,
    options,
    operation,
  );
}

export async function digestTextStreamSession<T>(
  options: DigestTextStreamSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  const progressTracker = createDigestProgressTracker({
    operation: "digest-text-stream",
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  });

  return await withTemporaryDocumentSession(async (document, directoryPath) => {
    await document.openSession(async (openedDocument) => {
      const serialId = await openedDocument.peekNextSerialId();
      const normalizedTitle = normalizeTitle(options.title);
      const targetStage = options.targetStage ?? "summarized";
      await progressTracker.markDiscoveryUnavailable();

      if (targetStage === "planned") {
        await openedDocument.serials.createWithId(serialId);
      } else if (targetStage === "sourced") {
        await openedDocument.serials.createWithId(serialId);
        await writeSerialSource(openedDocument, serialId, options.stream, {
          ...(options.segmenter === undefined
            ? {}
            : { segmenter: options.segmenter }),
        });
      } else {
        const serialProgressTracker = progressTracker.createSerialTracker({
          id: serialId,
        });
        const generation = new SerialGeneration({
          document: openedDocument,
          llm: requireDigestLLM(options.llm, targetStage),
          ...(options.logDirPath === undefined
            ? {}
            : { logDirPath: options.logDirPath }),
          ...(options.segmenter === undefined
            ? {}
            : { segmenter: options.segmenter }),
        });

        if (targetStage === "graphed") {
          await openedDocument.serials.createWithId(serialId);
          await generation.buildTopologyInto(
            serialId,
            options.stream,
            {
              extractionPrompt: options.extractionPrompt,
              ...(options.userLanguage === undefined
                ? {}
                : { userLanguage: options.userLanguage }),
            },
            serialProgressTracker,
          );
        } else {
          await generation.generateInto(
            serialId,
            options.stream,
            {
              extractionPrompt: options.extractionPrompt,
              ...(options.userLanguage === undefined
                ? {}
                : { userLanguage: options.userLanguage }),
            },
            serialProgressTracker,
          );
        }
      }

      await openedDocument.writeBookMeta({
        version: BOOK_META_VERSION,
        sourceFormat: options.sourceFormat ?? "txt",
        title: normalizeTitle(options.title) ?? null,
        authors: [],
        description: null,
        identifier: null,
        language: options.bookLanguage ?? null,
        publishedAt: null,
        publisher: null,
      });
      await openedDocument.writeToc({
        version: TOC_FILE_VERSION,
        items: [
          {
            serialId,
            children: [],
            ...(normalizedTitle === undefined
              ? {}
              : { title: normalizedTitle }),
          },
        ],
      });
    });

    return await operation(new SpineDigest(document, directoryPath));
  }, options.documentDirPath);
}

export async function digestTxtSession<T>(
  options: DigestSourceSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  return await digestSourceSession(
    "digest-txt",
    TXT_SOURCE_ADAPTER,
    options,
    operation,
  );
}

async function digestSourceSession<T>(
  operationName: "digest-epub" | "digest-markdown" | "digest-txt",
  adapter: SourceAdapter,
  options: DigestSourceSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  const progressTracker = createDigestProgressTracker({
    operation: operationName,
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  });

  return await withTemporaryDocumentSession(async (document, directoryPath) => {
    await importSource({
      adapter,
      document,
      digestProgressTracker: progressTracker,
      extractionPrompt: options.extractionPrompt,
      ...(options.llm === undefined ? {} : { llm: options.llm }),
      path: options.path,
      ...(options.targetStage === undefined
        ? {}
        : { targetStage: options.targetStage }),
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
      ...(options.segmenter === undefined
        ? {}
        : { segmenter: options.segmenter }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });

    return await operation(new SpineDigest(document, directoryPath));
  }, options.documentDirPath);
}

async function withTemporaryDocumentSession<T>(
  operation: (
    document: DirectoryDocument,
    directoryPath: string,
  ) => Promise<T> | T,
  documentDirPath?: string,
): Promise<T> {
  const directoryPath =
    documentDirPath === undefined
      ? await mkdtemp(join(tmpdir(), "spinedigest-digest-"))
      : resolve(documentDirPath);
  const document = await DirectoryDocument.open(directoryPath);

  try {
    return await operation(document, directoryPath);
  } finally {
    await document.release();
    if (documentDirPath === undefined) {
      await rm(directoryPath, { force: true, recursive: true });
    }
  }
}

function normalizeTitle(title: string | null | undefined): string | undefined {
  const normalized = title?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function requireDigestLLM(
  llm: LLM<SpineDigestScope> | undefined,
  targetStage: ChapterStage,
): LLM<SpineDigestScope> {
  if (llm === undefined) {
    throw new Error(`LLM is required to digest source to ${targetStage}.`);
  }

  return llm;
}

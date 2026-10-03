import { BOOK_META_VERSION, TOC_FILE_VERSION } from "../text/source/index.js";
import {
  EPUB_SOURCE_ADAPTER,
  PcexSourceAdapter,
  MARKDOWN_SOURCE_ADAPTER,
  TXT_SOURCE_ADAPTER,
  type SourceFormat,
  type SourceAdapter,
} from "../text/source/index.js";
import { DirectoryDocument } from "../document/index.js";
import { createChapterKey } from "../document/chapter/path.js";
import type { Language } from "../runtime/common/language.js";
import type { WikiGraphScope } from "../runtime/common/llm-scope.js";
import {
  createDigestProgressTracker,
  type WikiGraphProgressCallback,
} from "../runtime/progress/index.js";
import type {
  ReaderSegmenter,
  ReaderTextStream,
} from "../text/reader/index.js";
import type { LLM } from "../external/llm/index.js";
import { SerialGeneration, writeSerialSource } from "../serial.js";

import { importSource } from "./import.js";
import { WikiGraphArchive } from "./wiki-graph-archive.js";
import type { ChapterStage } from "./chapter/index.js";
import {
  ensureRelativeDirectory,
  getWikiGraphStorage,
  type Directory,
  type File,
} from "../runtime/platform/index.js";

interface DigestSessionOptions {
  readonly documentDirectory?: Directory;
  readonly extractionPrompt: string;
  readonly llm?: LLM<WikiGraphScope>;
  readonly logDirectory?: Directory;
  readonly onProgress?: WikiGraphProgressCallback;
  readonly onSourceValidated?: () => void | Promise<void>;
  readonly segmenter?: ReaderSegmenter;
  readonly targetStage?: ChapterStage;
  readonly userLanguage?: Language;
}

export interface DigestDocumentSessionOptions {
  readonly documentDirectory?: Directory;
}

export interface DigestSourceSessionOptions extends DigestSessionOptions {
  readonly file: File;
}

export interface DigestPcexSessionOptions extends DigestSourceSessionOptions {
  readonly pdfDigest: string;
  readonly pdfName?: string;
}

export interface DigestTextStreamSessionOptions extends DigestSessionOptions {
  readonly bookLanguage?: string | null;
  readonly sourceFormat?: Extract<SourceFormat, "markdown" | "txt">;
  readonly stream: ReaderTextStream;
  readonly title?: string | null;
}

export async function digestEpubSession<T>(
  options: DigestSourceSessionOptions,
  operation: (digest: WikiGraphArchive) => Promise<T> | T,
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
  operation: (digest: WikiGraphArchive) => Promise<T> | T,
): Promise<T> {
  return await digestSourceSession(
    "digest-markdown",
    MARKDOWN_SOURCE_ADAPTER,
    options,
    operation,
  );
}

export async function digestPcexSession<T>(
  options: DigestPcexSessionOptions,
  operation: (digest: WikiGraphArchive) => Promise<T> | T,
): Promise<T> {
  return await digestSourceSession(
    "digest-pcex",
    new PcexSourceAdapter({
      pdfDigest: options.pdfDigest,
      ...(options.pdfName === undefined ? {} : { pdfName: options.pdfName }),
    }),
    options,
    operation,
  );
}

export async function digestTextStreamSession<T>(
  options: DigestTextStreamSessionOptions,
  operation: (digest: WikiGraphArchive) => Promise<T> | T,
): Promise<T> {
  const progressTracker = createDigestProgressTracker({
    operation: "digest-text-stream",
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  });

  return await withTemporaryDocumentSession(async (document, directory) => {
    await document.openSession(async (openedDocument) => {
      const serialId = await openedDocument.peekNextSerialId();
      const normalizedTitle = normalizeTitle(options.title);
      const key = createChapterKey(new Set());
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
          ...(options.logDirectory === undefined
            ? {}
            : { logDirectory: options.logDirectory }),
          ...(options.segmenter === undefined
            ? {}
            : { segmenter: options.segmenter }),
        });

        if (targetStage === "graphed") {
          await openedDocument.serials.createWithId(serialId);
          await writeSerialSource(openedDocument, serialId, options.stream, {
            ...(options.segmenter === undefined
              ? {}
              : { segmenter: options.segmenter }),
          });
          await generation.buildTopologyInto(
            serialId,
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
            key,
            ...(normalizedTitle === undefined
              ? {}
              : { title: normalizedTitle }),
          },
        ],
      });
    });

    return await operation(new WikiGraphArchive(document, directory));
  }, options.documentDirectory);
}

export async function digestTxtSession<T>(
  options: DigestSourceSessionOptions,
  operation: (digest: WikiGraphArchive) => Promise<T> | T,
): Promise<T> {
  return await digestSourceSession(
    "digest-txt",
    TXT_SOURCE_ADAPTER,
    options,
    operation,
  );
}

async function digestSourceSession<T>(
  operationName:
    | "digest-epub"
    | "digest-markdown"
    | "digest-pcex"
    | "digest-txt",
  adapter: SourceAdapter,
  options: DigestSourceSessionOptions,
  operation: (digest: WikiGraphArchive) => Promise<T> | T,
): Promise<T> {
  const progressTracker = createDigestProgressTracker({
    operation: operationName,
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  });

  return await withTemporaryDocumentSession(async (document, directory) => {
    await importSource({
      adapter,
      document,
      digestProgressTracker: progressTracker,
      extractionPrompt: options.extractionPrompt,
      ...(options.llm === undefined ? {} : { llm: options.llm }),
      file: options.file,
      ...(options.targetStage === undefined
        ? {}
        : { targetStage: options.targetStage }),
      ...(options.logDirectory === undefined
        ? {}
        : { logDirectory: options.logDirectory }),
      ...(options.onSourceValidated === undefined
        ? {}
        : { onSourceValidated: options.onSourceValidated }),
      ...(options.segmenter === undefined
        ? {}
        : { segmenter: options.segmenter }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });

    return await operation(new WikiGraphArchive(document, directory));
  }, options.documentDirectory);
}

async function withTemporaryDocumentSession<T>(
  operation: (
    document: DirectoryDocument,
    directory: Directory,
  ) => Promise<T> | T,
  documentDirectory?: Directory,
): Promise<T> {
  const sessionsRoot =
    documentDirectory === undefined
      ? await ensureRelativeDirectory(
          getWikiGraphStorage().documentStore,
          "digest-sessions",
        )
      : undefined;
  const sessionName = `digest-${globalThis.crypto.randomUUID()}`;
  const directory =
    documentDirectory ?? (await sessionsRoot!.createDirectory(sessionName));
  const document = await DirectoryDocument.open(directory);

  try {
    return await operation(document, directory);
  } finally {
    await document.release();
    if (sessionsRoot !== undefined) {
      await sessionsRoot.remove(sessionName, { recursive: true });
    }
  }
}

function normalizeTitle(title: string | null | undefined): string | undefined {
  const normalized = title?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function requireDigestLLM(
  llm: LLM<WikiGraphScope> | undefined,
  targetStage: ChapterStage,
): LLM<WikiGraphScope> {
  if (llm === undefined) {
    throw new Error(`LLM is required to digest source to ${targetStage}.`);
  }

  return llm;
}

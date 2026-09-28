import {
  CHAPTER_JOB_PROTOCOL,
  type ChapterJobSnapshot,
} from "wiki-graph-job";

import type { ReadonlyDocument, SentenceRecord } from "../../document/index.js";
import { snapshotChapterKnowledgeGraphInput } from "../../graph/knowledge-build/index.js";
import { createChapterReadingGraphObjectStream } from "../../object-stream.js";
import { readChapterBuildInput } from "../../graph/reading-build/index.js";

export async function snapshotReadingGraphJob(
  document: ReadonlyDocument,
  chapterId: number,
  options: { readonly extractionPrompt?: string; readonly language?: string },
): Promise<ChapterJobSnapshot<"reading-graph">> {
  const input = await readChapterBuildInput(document, chapterId);
  return {
    chapterId,
    kind: "reading-graph",
    payload: {
      ...(options.extractionPrompt === undefined
        ? {}
        : { extractionPrompt: options.extractionPrompt }),
      ...(options.language === undefined ? {} : { language: options.language }),
      sourceText: input.sourceText,
    },
    protocol: CHAPTER_JOB_PROTOCOL,
    revision: input.revision,
  };
}

export async function snapshotReadingSummaryJob(
  document: ReadonlyDocument,
  chapterId: number,
  options: { readonly language?: string; readonly prompt?: string },
): Promise<ChapterJobSnapshot<"reading-summary">> {
  return {
    chapterId,
    kind: "reading-summary",
    payload: {
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
      readingGraph: await collect(
        createChapterReadingGraphObjectStream({ chapterId, document }),
      ),
    },
    protocol: CHAPTER_JOB_PROTOCOL,
    revision: await document.serials.getRevision(chapterId),
  };
}

export async function snapshotKnowledgeGraphJob(
  document: ReadonlyDocument,
  chapterId: number,
  options: { readonly language?: string; readonly policyPrompt?: string },
): Promise<ChapterJobSnapshot<"knowledge-graph">> {
  const snapshot = await snapshotChapterKnowledgeGraphInput(
    document,
    chapterId,
  );
  return {
    chapterId,
    kind: "knowledge-graph",
    payload: {
      fragments: snapshot.fragments.map((fragment) => ({
        fragmentId: fragment.fragmentId,
        sentences: fragment.sentences,
        summary: fragment.summary,
      })),
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.policyPrompt === undefined
        ? {}
        : { policyPrompt: options.policyPrompt }),
      stage: requireBuildableStage(snapshot.details.stage),
    },
    protocol: CHAPTER_JOB_PROTOCOL,
    revision: await document.serials.getRevision(chapterId),
  };
}

function requireBuildableStage(
  stage: "graphed" | "planned" | "sourced" | "summarized",
): "graphed" | "sourced" | "summarized" {
  if (stage === "planned") {
    throw new Error("A planned chapter cannot build a Knowledge Graph.");
  }
  return stage;
}

export async function snapshotFtsJob(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterJobSnapshot<"index-fts">> {
  return {
    chapterId,
    kind: "index-fts",
    payload: {
      chapterTitles: await readChapterTitles(document, chapterId),
      chunks: await document.chunks.listBySerial(chapterId),
      mentions: await document.mentions.listByChapter(chapterId),
      sentences: await listSentences(document.getSerialFragments(chapterId)),
      summarySentences: await listSentences(
        document.getSummaryFragments(chapterId),
      ),
    },
    protocol: CHAPTER_JOB_PROTOCOL,
    revision: await document.serials.getRevision(chapterId),
  };
}

export async function snapshotSourceEmbeddingJob(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterJobSnapshot<"index-embedding-source">> {
  return {
    chapterId,
    kind: "index-embedding-source",
    payload: {
      sentences: await listSentences(document.getSerialFragments(chapterId)),
    },
    protocol: CHAPTER_JOB_PROTOCOL,
    revision: await document.serials.getRevision(chapterId),
  };
}

export async function snapshotSummaryEmbeddingJob(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterJobSnapshot<"index-embedding-summary">> {
  return {
    chapterId,
    kind: "index-embedding-summary",
    payload: {
      sentences: await listSentences(document.getSummaryFragments(chapterId)),
    },
    protocol: CHAPTER_JOB_PROTOCOL,
    revision: await document.serials.getRevision(chapterId),
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<readonly T[]> {
  const output: T[] = [];
  for await (const value of values) output.push(value);
  return output;
}

async function listSentences(stream: {
  readonly listSentences?: () => Promise<readonly SentenceRecord[]>;
}): Promise<readonly SentenceRecord[]> {
  if (stream.listSentences === undefined) {
    throw new Error("Text stream does not expose sentence listing.");
  }
  return await stream.listSentences();
}

async function readChapterTitles(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<readonly { readonly id: number; readonly title: string }[]> {
  const reader = document as ReadonlyDocument & {
    readonly readToc?: () => Promise<
      | {
          readonly items: readonly TocItem[];
        }
      | undefined
    >;
  };
  const toc = await reader.readToc?.();
  const chapter =
    toc === undefined
      ? undefined
      : flattenToc(toc.items).find((item) => item.serialId === chapterId);
  return chapter?.title === undefined || chapter.title === null
    ? []
    : [{ id: chapterId, title: chapter.title }];
}

interface TocItem {
  readonly children: readonly TocItem[];
  readonly serialId?: number | undefined;
  readonly title?: string | null | undefined;
}

function flattenToc(items: readonly TocItem[]): readonly TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.children)]);
}

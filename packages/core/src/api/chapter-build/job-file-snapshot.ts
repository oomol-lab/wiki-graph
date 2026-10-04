import {
  type ChapterJobInputRecord,
  type ChapterJobKind,
  writeChapterJobInput,
} from "wiki-graph-job";

import type { ReadonlyDocument } from "../../document/index.js";
import type { File } from "../../runtime/platform/index.js";

export interface ChapterJobInputOptions {
  readonly language?: string;
  readonly prompt?: string;
}

export async function writeChapterJobInputFile(
  document: ReadonlyDocument,
  chapterId: number,
  kind: ChapterJobKind,
  file: File,
  options: ChapterJobInputOptions = {},
): Promise<number> {
  const revision = await document.serials.getRevision(chapterId);
  await writeChapterJobInput(
    file,
    createChapterJobInputRecords(document, chapterId, kind, options),
  );
  return revision;
}

export async function* createChapterJobInputRecords(
  document: ReadonlyDocument,
  chapterId: number,
  kind: ChapterJobKind,
  options: ChapterJobInputOptions = {},
): AsyncIterable<ChapterJobInputRecord> {
  const optionRecord = createOptionsRecord(options);
  if (optionRecord !== undefined) yield optionRecord;

  switch (kind) {
    case "reading-graph":
      yield* sourceTextRecords(document, chapterId);
      return;
    case "reading-summary":
      yield* sourceFragmentRecords(document, chapterId);
      yield* readingGraphRecords(document, chapterId);
      return;
    case "knowledge-graph":
      yield* sourceFragmentRecords(document, chapterId);
      return;
    case "index-fts":
      yield* chapterTitleRecords(document, chapterId);
      yield* sentenceRecords(document, chapterId, "source");
      yield* sentenceRecords(document, chapterId, "summary");
      yield* ftsGraphRecords(document, chapterId);
      return;
    case "index-embedding-source":
      yield* sentenceRecords(document, chapterId, "source");
      return;
    case "index-embedding-summary":
      yield* sentenceRecords(document, chapterId, "summary");
  }
}

function createOptionsRecord(
  options: ChapterJobInputOptions,
): ChapterJobInputRecord | undefined {
  if (options.language === undefined && options.prompt === undefined) {
    return undefined;
  }
  return { ...options, type: "job-options" };
}

async function* sourceTextRecords(
  document: ReadonlyDocument,
  chapterId: number,
): AsyncIterable<ChapterJobInputRecord> {
  const fragments = document.getSerialFragments(chapterId);
  let sentenceIndex = 0;
  for (const fragmentId of await fragments.listFragmentIds()) {
    const fragment = await fragments.getFragment(fragmentId);
    for (const sentence of fragment.sentences) {
      yield {
        fragmentId: fragment.fragmentId,
        sentenceIndex,
        text: sentence.text,
        type: "source-text",
        wordsCount: sentence.wordsCount,
      };
      sentenceIndex += 1;
    }
  }
}

async function* sourceFragmentRecords(
  document: ReadonlyDocument,
  chapterId: number,
): AsyncIterable<ChapterJobInputRecord> {
  const fragments = document.getSerialFragments(chapterId);
  let sentenceIndex = 0;
  for (const fragmentId of await fragments.listFragmentIds()) {
    const fragment = await fragments.getFragment(fragmentId);
    yield {
      fragmentId: fragment.fragmentId,
      summary: fragment.summary,
      type: "source-fragment",
    };
    for (const sentence of fragment.sentences) {
      yield {
        fragmentId: fragment.fragmentId,
        sentenceIndex,
        text: sentence.text,
        type: "source-sentence",
        wordsCount: sentence.wordsCount,
      };
      sentenceIndex += 1;
    }
  }
}

async function* sentenceRecords(
  document: ReadonlyDocument,
  chapterId: number,
  stream: "source" | "summary",
): AsyncIterable<ChapterJobInputRecord> {
  const fragments =
    stream === "source"
      ? document.getSerialFragments(chapterId)
      : document.getSummaryFragments(chapterId);
  let sentenceIndex = 0;
  for (const fragmentId of await fragments.listFragmentIds()) {
    const fragment = await fragments.getFragment(fragmentId);
    for (const sentence of fragment.sentences) {
      yield {
        sentenceIndex,
        text: sentence.text,
        type: stream === "source" ? "source-sentence" : "summary-sentence",
        wordsCount: sentence.wordsCount,
      };
      sentenceIndex += 1;
    }
  }
}

async function* chapterTitleRecords(
  document: ReadonlyDocument,
  chapterId: number,
): AsyncIterable<ChapterJobInputRecord> {
  const toc = await document.readToc?.();
  if (toc === undefined) return;
  const chapter = flattenToc(toc.items).find(
    (item) => item.serialId === chapterId,
  );
  if (chapter?.title !== undefined && chapter.title !== null) {
    yield { chapterId, title: chapter.title, type: "chapter-title" };
  }
}

async function* ftsGraphRecords(
  document: ReadonlyDocument,
  chapterId: number,
): AsyncIterable<ChapterJobInputRecord> {
  for (const chunk of await document.chunks.listBySerial(chapterId)) {
    yield {
      ...chunk,
      id: String(chunk.id),
      sentenceIndex: chunk.sentenceId[1],
      sentenceIndexes: chunk.sentenceIds.map((sentenceId) => sentenceId[1]),
      type: "reading-chunk",
    };
  }
  for (const mention of await document.mentions.listByChapter(chapterId)) {
    yield { ...mention, id: String(mention.id), type: "mention" };
  }
}

async function* readingGraphRecords(
  document: ReadonlyDocument,
  chapterId: number,
): AsyncIterable<ChapterJobInputRecord> {
  yield* ftsGraphRecords(document, chapterId);
  for (const edge of await document.readingEdges.listBySerial(chapterId)) {
    yield {
      ...edge,
      fromChunkId: String(edge.fromId),
      toChunkId: String(edge.toId),
      type: "reading-edge",
    };
  }
  for (const group of await document.fragmentGroups.listBySerial(chapterId)) {
    yield { ...group, type: "fragment-group" };
  }
  const snakes = await document.snakes.listBySerial(chapterId);
  for (const snake of snakes) {
    yield { ...snake, id: String(snake.id), type: "snake" };
    for (const item of await document.snakeChunks.listBySnake(snake.id)) {
      yield {
        chunkId: String(item.chunkId),
        position: item.position,
        snakeId: String(item.snakeId),
        type: "snake-chunk",
      };
    }
  }
  for (const edge of await document.snakeEdges.listBySerial(chapterId)) {
    yield {
      fromSnakeId: String(edge.fromSnakeId),
      toSnakeId: String(edge.toSnakeId),
      type: "snake-edge",
      weight: edge.weight,
    };
  }
}

interface TocItem {
  readonly children: readonly TocItem[];
  readonly serialId?: number | undefined;
  readonly title?: string | null | undefined;
}

function flattenToc(items: readonly TocItem[]): readonly TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.children)]);
}

import type { Document, ReadonlyDocument } from "../../../document/index.js";
import { listChapters } from "../../../document/chapter/index.js";
import {
  createSearchIndexFingerprint,
  ensureSearchIndex,
  readSearchIndexStatus,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  TEXT_SENTENCE_KIND,
  type SearchIndexInput,
  type SearchIndexProgressReporter,
} from "../../search-index/search/index.js";

import { createTextStreamIndex } from "./text-streams.js";
import type { ArchiveTextStreamKind } from "./types.js";

export async function rebuildArchiveSearchIndex(
  document: Document,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  const input = await createSearchIndexRecords(document, progress);

  if ((await readSearchIndexStatus(document, input)) === "dirty") {
    await document.deleteSearchIndexDatabase();
  }

  await ensureSearchIndex(document, input, progress);
}

export async function isArchiveSearchIndexCurrent(
  document: ReadonlyDocument,
): Promise<boolean> {
  return (await readArchiveSearchIndexStatus(document)) === "current";
}

export async function readArchiveSearchIndexStatus(
  document: ReadonlyDocument,
): Promise<"current" | "dirty" | "missing"> {
  return await readSearchIndexStatus(
    document,
    await createSearchIndexRecords(document),
  );
}

export async function clearDirtyArchiveSearchIndex(
  document: Document,
): Promise<void> {
  if ((await readArchiveSearchIndexStatus(document)) === "dirty") {
    await document.deleteSearchIndexDatabase();
  }
}

export async function createArchiveSearchIndexFingerprint(
  document: ReadonlyDocument,
): Promise<string> {
  return createSearchIndexFingerprint(await createSearchIndexRecords(document));
}

async function createSearchIndexRecords(
  document: ReadonlyDocument,
  progress?: SearchIndexProgressReporter,
): Promise<SearchIndexInput> {
  const objectProperties: SearchIndexInput["objectProperties"][number][] = [];
  const textSentences: SearchIndexInput["textSentences"][number][] = [];
  const chapters = await listChapters(document);
  let chapterDone = 0;

  for (const chapter of chapters) {
    const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;

    objectProperties.push({
      chapterId: chapter.chapterId,
      ownerId: String(chapter.chapterId),
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.title,
      text: title,
    });

    textSentences.push(
      ...(await createTextStreamSearchIndexRecords(
        document,
        chapter.chapterId,
        "summary",
        title,
      )),
    );
    textSentences.push(
      ...(await createTextStreamSearchIndexRecords(
        document,
        chapter.chapterId,
        "source",
        title,
      )),
    );
    chapterDone += 1;
    await progress?.({
      done: chapterDone,
      phase: "collecting",
      total: chapters.length,
      unit: "chapter",
    });
  }

  for (const node of await document.chunks.listAll()) {
    objectProperties.push({
      chapterId: node.sentenceId[0],
      ownerId: String(node.id),
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.label,
      text: node.label,
    });
    objectProperties.push({
      chapterId: node.sentenceId[0],
      ownerId: String(node.id),
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.content,
      text: node.content,
    });
  }

  for (const mention of await document.mentions.listAll()) {
    objectProperties.push({
      chapterId: mention.chapterId,
      ownerId: mention.qid,
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.surface,
      text: mention.surface,
    });
  }

  return { objectProperties, textSentences };
}

async function createTextStreamSearchIndexRecords(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  _title: string,
): Promise<SearchIndexInput["textSentences"]> {
  const index = await createTextStreamIndex(document, chapterId, stream);

  return index.sentences.map((sentence) => ({
    chapterId,
    kind:
      stream === "source"
        ? TEXT_SENTENCE_KIND.source
        : TEXT_SENTENCE_KIND.summary,
    sentenceIndex: sentence.globalIndex,
    text: sentence.text,
    wordsCount: sentence.wordsCount,
  }));
}


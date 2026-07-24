import type { Document, ReadonlyDocument } from "../../../document/index.js";
import { listChapters } from "../../../document/chapter/index.js";
import {
  createSearchIndexFingerprint,
  readSearchIndexStatus,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  SINGLE_ARCHIVE_INDEX_ID,
  TEXT_SENTENCE_KIND,
  type SearchIndexInput,
  type SearchIndexProgressReporter,
  type SearchIndexWriteBatch,
  writeArchiveIndexProjection,
} from "../../search-index/search/index.js";

import type { ArchiveTextStreamKind } from "./types.js";

const SEARCH_INDEX_REBUILD_ATTEMPTS = 2;
const ARCHIVE_INDEX_BATCH_RECORDS = 512;

export async function rebuildArchiveSearchIndex(
  document: Document,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  for (let attempt = 0; attempt < SEARCH_INDEX_REBUILD_ATTEMPTS; attempt += 1) {
    const input = await buildArchiveIndexProjection(document, progress);
    const fingerprint = createSearchIndexFingerprint(input);

    if ((await readSearchIndexStatus(document, input)) === "dirty") {
      const beforeDeleteInput = await buildArchiveIndexProjection(document);

      if (createSearchIndexFingerprint(beforeDeleteInput) !== fingerprint) {
        continue;
      }

      await document.deleteSearchIndexDatabase();
    }

    await writeArchiveIndexProjection(document, input, progress);

    const verifiedInput = await buildArchiveIndexProjection(document);
    if (
      createSearchIndexFingerprint(verifiedInput) === fingerprint &&
      (await readSearchIndexStatus(document, verifiedInput)) === "current"
    ) {
      return;
    }

    await document.deleteSearchIndexDatabase();
  }

  throw new Error("Archive changed while rebuilding search index; retry.");
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
    await buildArchiveIndexProjection(document),
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
  return createSearchIndexFingerprint(
    await buildArchiveIndexProjection(document),
  );
}

export async function buildArchiveIndexProjection(
  document: ReadonlyDocument,
  progress?: SearchIndexProgressReporter,
): Promise<SearchIndexInput> {
  const objectProperties: SearchIndexInput["objectProperties"][number][] = [];
  const textSentences: SearchIndexInput["textSentences"][number][] = [];

  for await (const batch of streamArchiveIndexProjection(
    document,
    SINGLE_ARCHIVE_INDEX_ID,
    progress,
  )) {
    objectProperties.push(...batch.objectProperties);
    textSentences.push(...batch.textSentences);
  }

  return { objectProperties, textSentences };
}

export async function* streamArchiveIndexProjection(
  document: ReadonlyDocument,
  archiveId: number,
  progress?: SearchIndexProgressReporter,
): AsyncIterable<SearchIndexWriteBatch> {
  const chapters = await listChapters(document);
  let chapterDone = 0;
  let batch = createEmptySearchIndexBatch();

  for (const chapter of chapters) {
    const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;

    batch = appendObjectProperty(batch, {
      archiveId,
      chapterId: chapter.chapterId,
      ownerId: String(chapter.chapterId),
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.title,
      text: title,
    });

    for await (const record of streamTextStreamSearchIndexRecords(
      document,
      archiveId,
      chapter.chapterId,
      "summary",
    )) {
      batch = appendTextSentence(batch, record);
      if (countSearchIndexBatchRecords(batch) >= ARCHIVE_INDEX_BATCH_RECORDS) {
        yield batch;
        batch = createEmptySearchIndexBatch();
      }
    }

    for await (const record of streamTextStreamSearchIndexRecords(
      document,
      archiveId,
      chapter.chapterId,
      "source",
    )) {
      batch = appendTextSentence(batch, record);
      if (countSearchIndexBatchRecords(batch) >= ARCHIVE_INDEX_BATCH_RECORDS) {
        yield batch;
        batch = createEmptySearchIndexBatch();
      }
    }

    for (const node of await document.chunks.listBySerial(chapter.chapterId)) {
      batch = appendObjectProperty(batch, {
        archiveId,
        chapterId: node.sentenceId[0],
        ownerId: String(node.id),
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.label,
        text: node.label,
      });
      batch = appendObjectProperty(batch, {
        archiveId,
        chapterId: node.sentenceId[0],
        ownerId: String(node.id),
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.content,
        text: node.content,
      });

      if (countSearchIndexBatchRecords(batch) >= ARCHIVE_INDEX_BATCH_RECORDS) {
        yield batch;
        batch = createEmptySearchIndexBatch();
      }
    }

    for (const mention of await document.mentions.listByChapter(
      chapter.chapterId,
    )) {
      batch = appendObjectProperty(batch, {
        archiveId,
        chapterId: mention.chapterId,
        ownerId: mention.qid,
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.surface,
        text: mention.surface,
      });

      if (countSearchIndexBatchRecords(batch) >= ARCHIVE_INDEX_BATCH_RECORDS) {
        yield batch;
        batch = createEmptySearchIndexBatch();
      }
    }

    chapterDone += 1;
    await progress?.({
      done: chapterDone,
      phase: "collecting",
      total: chapters.length,
      unit: "chapter",
    });
  }

  if (countSearchIndexBatchRecords(batch) > 0) {
    yield batch;
  }
}

function createEmptySearchIndexBatch(): SearchIndexWriteBatch {
  return { objectProperties: [], textSentences: [] };
}

function appendTextSentence(
  batch: SearchIndexWriteBatch,
  record: SearchIndexWriteBatch["textSentences"][number],
): SearchIndexWriteBatch {
  (
    batch.textSentences as SearchIndexWriteBatch["textSentences"][number][]
  ).push(record);
  return batch;
}

function appendObjectProperty(
  batch: SearchIndexWriteBatch,
  record: SearchIndexWriteBatch["objectProperties"][number],
): SearchIndexWriteBatch {
  (
    batch.objectProperties as SearchIndexWriteBatch["objectProperties"][number][]
  ).push(record);
  return batch;
}

function countSearchIndexBatchRecords(batch: SearchIndexWriteBatch): number {
  return batch.objectProperties.length + batch.textSentences.length;
}

async function* streamTextStreamSearchIndexRecords(
  document: ReadonlyDocument,
  archiveId: number,
  chapterId: number,
  stream: ArchiveTextStreamKind,
): AsyncIterable<SearchIndexWriteBatch["textSentences"][number]> {
  const fragments =
    stream === "summary"
      ? document.getSummaryFragments(chapterId)
      : document.getSerialFragments(chapterId);
  let globalIndex = 0;

  for (const fragmentId of await fragments.listFragmentIds()) {
    const fragment = await fragments.getFragment(fragmentId);

    for (const sentence of fragment.sentences) {
      yield {
        archiveId,
        chapterId,
        kind:
          stream === "source"
            ? TEXT_SENTENCE_KIND.source
            : TEXT_SENTENCE_KIND.summary,
        sentenceIndex: globalIndex,
        text: sentence.text,
        wordsCount: sentence.wordsCount,
      };
      globalIndex += 1;
    }
  }
}

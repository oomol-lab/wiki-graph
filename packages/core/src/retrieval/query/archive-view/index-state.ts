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
  writeArchiveIndexProjection,
} from "../../search-index/search/index.js";

import { createTextStreamIndex } from "./text-streams.js";
import type { ArchiveTextStreamKind } from "./types.js";

const SEARCH_INDEX_REBUILD_ATTEMPTS = 2;

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
  const chapters = await listChapters(document);
  let chapterDone = 0;

  for (const chapter of chapters) {
    const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;

    objectProperties.push({
      archiveId: SINGLE_ARCHIVE_INDEX_ID,
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
      archiveId: SINGLE_ARCHIVE_INDEX_ID,
      chapterId: node.sentenceId[0],
      ownerId: String(node.id),
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.label,
      text: node.label,
    });
    objectProperties.push({
      archiveId: SINGLE_ARCHIVE_INDEX_ID,
      chapterId: node.sentenceId[0],
      ownerId: String(node.id),
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.content,
      text: node.content,
    });
  }

  for (const mention of await document.mentions.listAll()) {
    objectProperties.push({
      archiveId: SINGLE_ARCHIVE_INDEX_ID,
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
    archiveId: SINGLE_ARCHIVE_INDEX_ID,
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

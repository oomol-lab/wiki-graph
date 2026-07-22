import type { Document } from "../../document/index.js";
import type { ReaderTextStream } from "../../text/reader/index.js";
import { writeSerialSource } from "../../serial.js";
import type { TocItem } from "../../text/source/index.js";
import {
  collectChapterKeys,
  createChapterKey,
  resolveChapterIdByPath,
} from "../../document/chapter/path.js";
import { getChapterDetails, requireChapterDetails } from "./details.js";
import { normalizeChapterToc } from "./entries.js";
import {
  appendChildToChapter,
  cloneTocItem,
  collectTocItemMetas,
  createChapterTreeApplyResult,
  createTocItemsFromChapterTree,
  extractChapterItem,
  findChapterLocation,
  insertMovedChapter,
  normalizeTitle,
  rejectMoveIntoOwnSubtree,
  removeChapterFromItems,
  setChapterTitleInItems,
} from "./tree.js";
import type {
  AddChapterOptions,
  ChapterDetails,
  ChapterStage,
  ChapterTreeApplyResult,
  ChapterTreeInput,
  MoveChapterOptions,
} from "./types.js";

export async function addChapter(
  document: Document,
  options: AddChapterOptions,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const normalizedTitle = normalizeTitle(options.title);
    const existingKeys = collectChapterKeys(toc.items);

    const chapterId = await openedDocument.createSerial();
    const chapterItem = {
      children: [],
      key: createChapterKey(normalizedTitle, existingKeys),
      serialId: chapterId,
      ...(normalizedTitle === undefined ? {} : { title: normalizedTitle }),
    } satisfies TocItem;

    if (options.parentChapterId === undefined) {
      toc.items = [...toc.items, chapterItem];
    } else if (
      !appendChildToChapter(toc.items, options.parentChapterId, chapterItem)
    ) {
      throw new Error(
        "Parent chapter does not exist. Use `wg <archive-uri>/chapter` to discover chapter URIs.",
      );
    }

    await openedDocument.replaceToc(toc);
    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function resolveChapterPath(
  document: Document,
  chapterPath: string,
): Promise<number> {
  const toc = await normalizeChapterToc(document);
  const chapterId = resolveChapterIdByPath(toc.items, chapterPath);
  if (chapterId === undefined) {
    throw new Error(`Chapter path ${chapterPath} does not exist.`);
  }
  return chapterId;
}

export async function applyChapterTree(
  document: Document,
  tree: ChapterTreeInput,
  options: { readonly dryRun?: boolean } = {},
): Promise<ChapterTreeApplyResult> {
  return await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const oldItems = toc.items.map(cloneTocItem);
    const oldMetas = collectTocItemMetas(oldItems);
    const { items } = createTocItemsFromChapterTree(tree, oldItems);
    const newMetas = collectTocItemMetas(items);
    const result = createChapterTreeApplyResult(oldMetas, newMetas);

    if (options.dryRun !== true && result.changed) {
      await openedDocument.replaceToc({
        items,
        version: toc.version,
      });
    }

    return result;
  });
}

export async function moveChapter(
  document: Document,
  chapterId: number,
  options: MoveChapterOptions,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const originalLocation = findChapterLocation(toc.items, chapterId);
    const extracted = extractChapterItem(toc.items, chapterId);

    if (extracted.item === undefined) {
      throw new Error(
        "Chapter does not exist. Use `wg <archive-uri>/chapter` to discover chapter URIs.",
      );
    }

    rejectMoveIntoOwnSubtree(chapterId, extracted.item, options);

    toc.items = extracted.items;
    insertMovedChapter(toc.items, extracted.item, {
      originalParentChapterId: originalLocation?.parentChapterId,
      ...options,
    });
    await openedDocument.replaceToc(toc);
    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function removeChapter(
  document: Document,
  chapterId: number,
  options: { readonly recursive?: boolean } = {},
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const removedChapterIds: number[] = [];
    const result = removeChapterFromItems(toc.items, chapterId, {
      recursive: options.recursive ?? false,
      removedChapterIds,
    });

    if (!result.removed) {
      throw new Error(
        "Chapter does not exist. Use `wg <archive-uri>/chapter` to discover chapter URIs.",
      );
    }

    toc.items = result.items;
    await openedDocument.replaceToc(toc);

    for (const removedChapterId of removedChapterIds) {
      await openedDocument.deleteSerial(removedChapterId);
    }
  });
}

export async function resetChapter(
  document: Document,
  chapterId: number,
  stage: Exclude<ChapterStage, "summarized">,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    await requireChapterDetails(openedDocument, chapterId);

    switch (stage) {
      case "planned":
        await openedDocument.clearSerialSource(chapterId);
        break;
      case "sourced":
        await openedDocument.clearSerialGraph(chapterId);
        break;
      case "graphed":
        await openedDocument.deleteSummary(chapterId);
        break;
    }

    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function setChapterSource(
  document: Document,
  chapterId: number,
  stream: ReaderTextStream,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const details = await requireChapterDetails(openedDocument, chapterId);

    if (details.stage !== "planned") {
      throw new Error(
        `Chapter ${details.uri} is ${details.stage}. Reset it to planned before setting source.`,
      );
    }

    await writeSerialSource(openedDocument, chapterId, stream);
    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function setChapterSummary(
  document: Document,
  chapterId: number,
  summary: string,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const details = await requireChapterDetails(openedDocument, chapterId);

    if (details.stage !== "graphed") {
      throw new Error(
        `Chapter ${details.uri} is ${details.stage}. Set a summary only for graphed chapters.`,
      );
    }

    await openedDocument.writeSummary(chapterId, summary);
    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function setChapterTitle(
  document: Document,
  chapterId: number,
  title: string | null | undefined,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const normalizedTitle = normalizeTitle(title);

    if (!setChapterTitleInItems(toc.items, chapterId, normalizedTitle)) {
      throw new Error(
        "Chapter does not exist. Use `wg <archive-uri>/chapter` to discover chapter URIs.",
      );
    }

    await openedDocument.replaceToc(toc);
    return await getChapterDetails(openedDocument, chapterId);
  });
}

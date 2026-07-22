import type { ReadonlyDocument } from "../index.js";
import type { TocItem } from "../../text/source/index.js";
import {
  collectChapterEntries,
  findChapterEntry,
  readChapterToc,
} from "./toc.js";
import { collectChapterIds, toChapterTreeNodes } from "./tree.js";
import { CHAPTER_STAGES } from "./types.js";
import type {
  ChapterDetails,
  ChapterEntry,
  ChapterStage,
  ChapterTree,
} from "./types.js";

export async function getChapterDetails(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterDetails> {
  const toc = await readChapterToc(document);
  const entry = await findChapterEntry(document, toc.items, chapterId);

  if (entry === undefined) {
    throw new Error(
      `Chapter ${chapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
    );
  }

  const serial = await document.serials.getById(chapterId);
  const summary = await document.readSummary(chapterId);

  return {
    ...entry,
    graphReady: serial?.topologyReady === true,
    hasSummary: summary !== undefined,
  };
}

export async function listChapters(
  document: ReadonlyDocument,
): Promise<readonly ChapterEntry[]> {
  const toc = await readChapterToc(document);

  return await collectChapterEntries(document, toc.items);
}

export async function getChapterTree(
  document: ReadonlyDocument,
): Promise<ChapterTree> {
  const toc = await readChapterToc(document);

  return {
    chapters: toc.items.flatMap((item) => toChapterTreeNodes(item)),
  };
}

export async function requireChapterDetails(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterDetails> {
  return await getChapterDetails(document, chapterId);
}

export async function selectChapterEntries(
  document: ReadonlyDocument,
  chapterId: number | undefined,
): Promise<readonly ChapterEntry[]> {
  const entries = await listChapters(document);

  if (chapterId === undefined) {
    return entries;
  }

  const selectedIds = await collectChapterSubtreeIds(document, chapterId);

  if (selectedIds.size === 0) {
    throw new Error(
      `Chapter ${chapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
    );
  }

  return entries.filter((entry) => selectedIds.has(entry.chapterId));
}

export function isStageBefore(
  stage: ChapterStage,
  targetStage: ChapterStage,
): boolean {
  return CHAPTER_STAGES.indexOf(stage) < CHAPTER_STAGES.indexOf(targetStage);
}

async function collectChapterSubtreeIds(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ReadonlySet<number>> {
  const toc = await readChapterToc(document);
  const selectedIds = new Set<number>();

  for (const item of toc.items) {
    if (collectChapterSubtreeIdsFromItem(item, chapterId, selectedIds)) {
      break;
    }
  }

  return selectedIds;
}

function collectChapterSubtreeIdsFromItem(
  item: TocItem,
  chapterId: number,
  selectedIds: Set<number>,
): boolean {
  if (item.serialId === chapterId) {
    collectChapterIds(item, selectedIds);
    return true;
  }

  for (const child of item.children) {
    if (collectChapterSubtreeIdsFromItem(child, chapterId, selectedIds)) {
      return true;
    }
  }

  return false;
}

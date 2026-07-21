import type { TOC_FILE_VERSION, TocItem } from "../../text/source/index.js";
import type { ChapterTreeNode } from "./types.js";

export function cloneTocItem(item: TocItem): MutableTocItem {
  return {
    children: item.children.map(cloneTocItem),
    ...(item.serialId === undefined ? {} : { serialId: item.serialId }),
    title: item.title,
  };
}

function toChapterTreeNode(item: MutableTocItem): ChapterTreeNode {
  if (item.serialId === undefined) {
    throw new Error("Internal error: normalized chapter tree has no id.");
  }

  return {
    children: item.children.flatMap(toChapterTreeNodes),
    id: item.serialId,
    title: normalizeTitle(item.title) ?? null,
  };
}

export function toChapterTreeNodes(item: MutableTocItem): ChapterTreeNode[] {
  return item.serialId === undefined
    ? item.children.flatMap(toChapterTreeNodes)
    : [toChapterTreeNode(item)];
}

export function normalizeTitle(
  title: string | null | undefined,
): string | undefined {
  const normalized = title?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

export function collectChapterIds(
  item: TocItem,
  chapterIds: number[] | Set<number>,
): void {
  if (item.serialId !== undefined) {
    if (Array.isArray(chapterIds)) {
      chapterIds.push(item.serialId);
    } else {
      chapterIds.add(item.serialId);
    }
  }

  for (const child of item.children) {
    collectChapterIds(child, chapterIds);
  }
}

export interface MutableTocFile {
  items: MutableTocItem[];
  version: typeof TOC_FILE_VERSION;
}

export interface MutableTocItem {
  children: MutableTocItem[];
  serialId?: number | undefined;
  title?: string | null | undefined;
}

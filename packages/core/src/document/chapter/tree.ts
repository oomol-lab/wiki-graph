import type { TOC_FILE_VERSION, TocItem } from "../../text/source/index.js";
import type { ChapterTreeNode } from "./types.js";

export function cloneTocItem(item: TocItem): MutableTocItem {
  return {
    children: item.children.map(cloneTocItem),
    ...(item.key === undefined ? {} : { key: item.key }),
    ...(item.serialId === undefined ? {} : { serialId: item.serialId }),
    title: item.title,
  };
}

function toChapterTreeNode(
  item: MutableTocItem,
  parentPath: readonly string[],
): ChapterTreeNode {
  if (item.serialId === undefined) {
    throw new Error("Internal error: normalized chapter tree has no id.");
  }
  const key = item.key ?? `chapter-${item.serialId}`;
  const path = [...parentPath, key];
  return {
    children: item.children.flatMap((child) => toChapterTreeNodes(child, path)),
    title: normalizeTitle(item.title) ?? null,
    uri: `wikg://chapter/${path.join("/")}`,
  };
}

export function toChapterTreeNodes(
  item: MutableTocItem,
  parentPath: readonly string[] = [],
): ChapterTreeNode[] {
  return item.serialId === undefined
    ? item.children.flatMap((child) => toChapterTreeNodes(child, parentPath))
    : [toChapterTreeNode(item, parentPath)];
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
  key?: string | undefined;
  serialId?: number | undefined;
  title?: string | null | undefined;
}

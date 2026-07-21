import type { TOC_FILE_VERSION, TocItem } from "../../text/source/index.js";
import type {
  ChapterTreeApplyResult,
  ChapterTreeInput,
  ChapterTreeInputNode,
  ChapterTreeMoveChange,
  ChapterTreeNode,
  ChapterTreeTitleChange,
  MoveChapterOptions,
} from "./types.js";

export function appendChildToChapter(
  items: MutableTocItem[],
  parentChapterId: number,
  child: MutableTocItem,
): boolean {
  for (const item of items) {
    if (item.serialId === parentChapterId) {
      item.children = [...item.children, child];
      return true;
    }

    if (appendChildToChapter(item.children, parentChapterId, child)) {
      return true;
    }
  }

  return false;
}

export function createChapterTreeApplyResult(
  oldMetas: Map<number, TocItemMeta>,
  newMetas: Map<number, TocItemMeta>,
): ChapterTreeApplyResult {
  const moved: ChapterTreeMoveChange[] = [];
  const renamed: ChapterTreeTitleChange[] = [];
  let unchanged = 0;

  for (const [chapterId, oldMeta] of oldMetas) {
    const newMeta = newMetas.get(chapterId);

    if (newMeta === undefined) {
      continue;
    }

    const movedChapter =
      oldMeta.parentChapterId !== newMeta.parentChapterId ||
      oldMeta.index !== newMeta.index;
    const renamedChapter = oldMeta.title !== newMeta.title;

    if (movedChapter) {
      moved.push({
        chapterId,
        newIndex: newMeta.index,
        newParentChapterId: newMeta.parentChapterId,
        newPath: newMeta.path,
        oldIndex: oldMeta.index,
        oldParentChapterId: oldMeta.parentChapterId,
        oldPath: oldMeta.path,
      });
    }
    if (renamedChapter) {
      renamed.push({
        chapterId,
        newTitle: newMeta.title,
        oldTitle: oldMeta.title,
      });
    }
    if (!movedChapter && !renamedChapter) {
      unchanged += 1;
    }
  }

  return {
    changed: moved.length > 0 || renamed.length > 0,
    moved,
    renamed,
    unchanged,
  };
}

export function createTocItemsFromChapterTree(
  tree: ChapterTreeInput,
  oldItems: readonly MutableTocItem[],
): { readonly items: MutableTocItem[] } {
  const oldItemsById = new Map<number, MutableTocItem>();
  const oldIds = new Set<number>();

  for (const oldItem of oldItems) {
    collectTocItemsById(oldItem, oldItemsById, oldIds);
  }

  const seenIds = new Set<number>();
  const items = tree.chapters.map((node) =>
    createTocItemFromChapterTreeNode(node, oldItemsById, seenIds),
  );
  const missingIds = [...oldIds].filter((id) => !seenIds.has(id));

  if (missingIds.length > 0) {
    throw new Error(
      `Chapter tree is missing chapter ids: ${missingIds.join(", ")}.`,
    );
  }

  return { items };
}

function createTocItemFromChapterTreeNode(
  node: ChapterTreeInputNode,
  oldItemsById: Map<number, MutableTocItem>,
  seenIds: Set<number>,
): MutableTocItem {
  const oldItem = oldItemsById.get(node.id);

  if (oldItem === undefined) {
    throw new Error(`Chapter tree references unknown chapter id: ${node.id}.`);
  }
  if (seenIds.has(node.id)) {
    throw new Error(`Chapter tree repeats chapter id: ${node.id}.`);
  }
  seenIds.add(node.id);

  const title = Object.prototype.hasOwnProperty.call(node, "title")
    ? normalizeTitle(node.title)
    : normalizeTitle(oldItem.title);
  const item: MutableTocItem = {
    children: node.children.map((child) =>
      createTocItemFromChapterTreeNode(child, oldItemsById, seenIds),
    ),
    serialId: node.id,
  };

  if (title !== undefined) {
    item.title = title;
  }

  return item;
}

function collectTocItemsById(
  item: MutableTocItem,
  itemsById: Map<number, MutableTocItem>,
  ids: Set<number>,
): void {
  if (item.serialId !== undefined) {
    itemsById.set(item.serialId, item);
    ids.add(item.serialId);
  }

  for (const child of item.children) {
    collectTocItemsById(child, itemsById, ids);
  }
}

export function collectTocItemMetas(
  items: readonly MutableTocItem[],
  parentChapterId: number | null = null,
  parentPath: readonly string[] = [],
): Map<number, TocItemMeta> {
  const metas = new Map<number, TocItemMeta>();

  items.forEach((item, index) => {
    if (item.serialId === undefined) {
      return;
    }

    const title = normalizeTitle(item.title) ?? null;
    const path = [...parentPath, title ?? `Chapter ${item.serialId}`];

    metas.set(item.serialId, {
      index,
      parentChapterId,
      path,
      title,
    });

    for (const [childId, childMeta] of collectTocItemMetas(
      item.children,
      item.serialId,
      path,
    )) {
      metas.set(childId, childMeta);
    }
  });

  return metas;
}

export function extractChapterItem(
  items: readonly MutableTocItem[],
  chapterId: number,
): {
  readonly item?: MutableTocItem;
  readonly items: MutableTocItem[];
} {
  const nextItems: MutableTocItem[] = [];

  for (const item of items) {
    if (item.serialId === chapterId) {
      return {
        item,
        items: [...nextItems, ...items.slice(nextItems.length + 1)],
      };
    }

    const childResult = extractChapterItem(item.children, chapterId);

    if (childResult.item !== undefined) {
      nextItems.push({
        ...item,
        children: childResult.items,
      });
      nextItems.push(...items.slice(nextItems.length));
      return {
        item: childResult.item,
        items: nextItems,
      };
    }

    nextItems.push(item);
  }

  return {
    items: [...items],
  };
}

function findChildContainer(
  items: MutableTocItem[],
  parentChapterId: number | undefined,
): MutableTocItem[] | undefined {
  if (parentChapterId === undefined) {
    return items;
  }

  for (const item of items) {
    if (item.serialId === parentChapterId) {
      return item.children;
    }

    const childContainer = findChildContainer(item.children, parentChapterId);

    if (childContainer !== undefined) {
      return childContainer;
    }
  }

  return undefined;
}

export function findChapterLocation(
  items: MutableTocItem[],
  chapterId: number,
):
  | {
      readonly index: number;
      readonly parentChapterId?: number | undefined;
      readonly siblings: MutableTocItem[];
    }
  | undefined {
  return findChapterLocationInItems(items, chapterId);
}

function findChapterLocationInItems(
  items: MutableTocItem[],
  chapterId: number,
  parentChapterId?: number,
):
  | {
      readonly index: number;
      readonly parentChapterId?: number | undefined;
      readonly siblings: MutableTocItem[];
    }
  | undefined {
  for (const [index, item] of items.entries()) {
    if (item.serialId === chapterId) {
      return {
        index,
        parentChapterId,
        siblings: items,
      };
    }

    const location = findChapterLocationInItems(
      item.children,
      chapterId,
      item.serialId,
    );

    if (location !== undefined) {
      return location;
    }
  }

  return undefined;
}

export function insertMovedChapter(
  items: MutableTocItem[],
  item: MutableTocItem,
  options: MoveChapterOptions & {
    readonly originalParentChapterId?: number | undefined;
  },
): void {
  if (
    options.beforeChapterId !== undefined ||
    options.afterChapterId !== undefined
  ) {
    const targetChapterId = options.beforeChapterId ?? options.afterChapterId!;
    const location = findChapterLocation(items, targetChapterId);

    if (location === undefined) {
      throw new Error(`Target chapter ${targetChapterId} does not exist.`);
    }

    location.siblings.splice(
      options.beforeChapterId === undefined
        ? location.index + 1
        : location.index,
      0,
      item,
    );
    return;
  }

  const parentChapterId =
    options.root === true
      ? undefined
      : options.parentChapterId !== undefined
        ? options.parentChapterId
        : options.originalParentChapterId;
  const container = findChildContainer(items, parentChapterId);

  if (container === undefined) {
    throw new Error(`Chapter ${parentChapterId} does not exist.`);
  }

  if (options.first === true) {
    container.splice(0, 0, item);
  } else {
    container.push(item);
  }
}

export function rejectMoveIntoOwnSubtree(
  chapterId: number,
  item: MutableTocItem,
  options: MoveChapterOptions,
): void {
  const targetIds = [
    options.parentChapterId,
    options.beforeChapterId,
    options.afterChapterId,
  ].filter((id): id is number => id !== undefined);

  for (const targetId of targetIds) {
    if (targetId === chapterId || containsChapterId(item.children, targetId)) {
      throw new Error(
        `Cannot move chapter ${chapterId} into or next to its own descendant ${targetId}.`,
      );
    }
  }
}

function containsChapterId(
  items: readonly MutableTocItem[],
  chapterId: number,
): boolean {
  for (const item of items) {
    if (
      item.serialId === chapterId ||
      containsChapterId(item.children, chapterId)
    ) {
      return true;
    }
  }

  return false;
}

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

export function normalizeTitle(title: string | null | undefined): string | undefined {
  const normalized = title?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

export function removeChapterFromItems(
  items: readonly MutableTocItem[],
  chapterId: number,
  options: {
    readonly recursive: boolean;
    readonly removedChapterIds: number[];
  },
): { readonly items: MutableTocItem[]; readonly removed: boolean } {
  const nextItems: MutableTocItem[] = [];
  let removed = false;

  for (const item of items) {
    if (item.serialId === chapterId) {
      if (!options.recursive && item.children.length > 0) {
        throw new Error(
          `Chapter ${chapterId} has child chapters. Use --recursive to remove it and its descendants.`,
        );
      }

      collectChapterIds(item, options.removedChapterIds);
      removed = true;
      continue;
    }

    const childResult = removeChapterFromItems(
      item.children,
      chapterId,
      options,
    );

    nextItems.push({
      ...item,
      children: childResult.items,
    });
    removed ||= childResult.removed;
  }

  return {
    items: nextItems,
    removed,
  };
}

export function setChapterTitleInItems(
  items: readonly MutableTocItem[],
  chapterId: number,
  title: string | undefined,
): boolean {
  for (const item of items) {
    if (item.serialId === chapterId) {
      if (title === undefined) {
        delete item.title;
      } else {
        item.title = title;
      }
      return true;
    }

    if (setChapterTitleInItems(item.children, chapterId, title)) {
      return true;
    }
  }

  return false;
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

interface TocItemMeta {
  readonly index: number;
  readonly parentChapterId: number | null;
  readonly path: readonly string[];
  readonly title: string | null;
}

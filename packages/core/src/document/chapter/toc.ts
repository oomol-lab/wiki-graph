import type { ReadonlyDocument } from "../index.js";
import { TOC_FILE_VERSION, type TocItem } from "../../text/source/index.js";

import {
  collectChapterKeys,
  createChapterKey,
  formatChapterUri,
} from "./path.js";
import { cloneTocItem, normalizeTitle, type MutableTocFile } from "./tree.js";
import type { ChapterEntry, ChapterStage } from "./types.js";

export async function readChapterToc(
  document: ReadonlyDocument,
): Promise<MutableTocFile> {
  const toc = await document.readToc();
  const items = toc?.items.map(cloneTocItem) ?? [];
  ensureChapterKeys(items);

  return toc === undefined
    ? { items: [], version: TOC_FILE_VERSION }
    : {
        items,
        version: toc.version,
      };
}

export function ensureChapterKeys(items: MutableTocFile["items"]): boolean {
  const existingKeys = collectChapterKeys(items);
  let changed = false;
  const visit = (nodes: MutableTocFile["items"]): void => {
    for (const item of nodes) {
      if (item.key === undefined) {
        item.key = createChapterKey(normalizeTitle(item.title), existingKeys);
        existingKeys.add(item.key);
        changed = true;
      } else {
        existingKeys.add(item.key);
      }
      visit(item.children);
    }
  };
  visit(items);
  return changed;
}

export async function findChapterEntry(
  document: ReadonlyDocument,
  items: readonly TocItem[],
  chapterId: number,
  ancestorTitles: readonly string[] = [],
  ancestorKeys: readonly string[] = [],
  depth = 0,
): Promise<ChapterEntry | undefined> {
  for (const item of items) {
    const title = normalizeTitle(item.title) ?? null;
    const key = item.key ?? `chapter-${item.serialId ?? "group"}`;
    const tocPath =
      item.serialId === undefined
        ? [...ancestorTitles, ...(title === null ? [] : [title])]
        : [...ancestorTitles, title ?? `Chapter ${item.serialId}`];
    const chapterPath = [...ancestorKeys, key];

    if (item.serialId === chapterId) {
      return await createChapterEntry(document, item, item.serialId, {
        chapterPath,
        depth,
        title,
        tocPath,
      });
    }

    const childEntry = await findChapterEntry(
      document,
      item.children,
      chapterId,
      tocPath,
      chapterPath,
      depth + 1,
    );

    if (childEntry !== undefined) {
      return childEntry;
    }
  }

  return undefined;
}

export async function collectChapterEntries(
  document: ReadonlyDocument,
  items: readonly TocItem[],
  ancestorTitles: readonly string[] = [],
  ancestorKeys: readonly string[] = [],
  depth = 0,
): Promise<ChapterEntry[]> {
  const entries: ChapterEntry[] = [];

  for (const item of items) {
    const title = normalizeTitle(item.title) ?? null;
    const key = item.key ?? `chapter-${item.serialId ?? "group"}`;
    const tocPath =
      item.serialId === undefined
        ? [...ancestorTitles, ...(title === null ? [] : [title])]
        : [...ancestorTitles, title ?? `Chapter ${item.serialId}`];
    const chapterPath = [...ancestorKeys, key];

    if (item.serialId === undefined) {
      entries.push(
        ...(await collectChapterEntries(
          document,
          item.children,
          tocPath,
          chapterPath,
          depth + 1,
        )),
      );
      continue;
    }

    entries.push(
      await createChapterEntry(document, item, item.serialId, {
        chapterPath,
        depth,
        title,
        tocPath,
      }),
    );
    entries.push(
      ...(await collectChapterEntries(
        document,
        item.children,
        tocPath,
        chapterPath,
        depth + 1,
      )),
    );
  }

  return entries;
}

async function createChapterEntry(
  document: ReadonlyDocument,
  item: TocItem,
  serialId: number,
  input: {
    readonly depth: number;
    readonly chapterPath: readonly string[];
    readonly title: string | null;
    readonly tocPath: readonly string[];
  },
): Promise<ChapterEntry> {
  const [serial, sourceSummary] = await Promise.all([
    document.serials.getById(serialId),
    summarizeSerialSource(document, serialId),
  ]);

  return {
    chapterId: serialId,
    childCount: item.children.length,
    depth: input.depth,
    documentOrder: serial?.documentOrder ?? serialId,
    fragmentCount: sourceSummary.fragmentCount,
    key: input.chapterPath.at(-1) ?? `chapter-${serialId}`,
    path: input.chapterPath.join("/"),
    stage: await resolveChapterStage(
      document,
      serialId,
      sourceSummary.fragmentCount,
    ),
    title: input.title,
    tocPath: input.tocPath,
    uri: formatChapterUri(input.chapterPath.join("/")),
    words: sourceSummary.words,
  };
}

async function summarizeSerialSource(
  document: ReadonlyDocument,
  serialId: number,
): Promise<{ readonly fragmentCount: number; readonly words: number }> {
  const sentenceWords = await document.readDatabase(
    async (database) =>
      await database.queryAll(
        `
        SELECT words_count
        FROM text_sentence_records
        WHERE kind = 1 AND chapter_id = ?
        ORDER BY sentence_index
      `,
        [serialId],
        (row) => Number(row.words_count),
      ),
  );
  let fragmentCount = 0;
  let fragmentWords = 0;
  let words = 0;

  for (const sentenceWordCount of sentenceWords) {
    if (fragmentWords > 0 && fragmentWords + sentenceWordCount > 600) {
      fragmentCount += 1;
      fragmentWords = 0;
    }

    fragmentWords += sentenceWordCount;
    words += sentenceWordCount;
  }

  if (fragmentWords > 0) {
    fragmentCount += 1;
  }

  return {
    fragmentCount,
    words,
  };
}

export async function resolveChapterStage(
  document: ReadonlyDocument,
  chapterId: number,
  fragmentCount: number,
): Promise<ChapterStage> {
  const summarySentenceCount = await document.readDatabase(
    async (database) =>
      (await database.queryOne(
        `
          SELECT COUNT(*) AS count
          FROM text_sentence_records
          WHERE kind = 2 AND chapter_id = ?
        `,
        [chapterId],
        (row) => Number(row.count),
      )) ?? 0,
  );

  if (summarySentenceCount > 0) {
    return "summarized";
  }

  const serial = await document.serials.getById(chapterId);

  if (serial?.topologyReady === true) {
    return "graphed";
  }

  if (fragmentCount > 0) {
    return "sourced";
  }

  return "planned";
}

import type { File } from "../../runtime/platform/index.js";

import type { ReadonlyDocument } from "../../document/index.js";
import type { TocItem } from "../source/index.js";

export interface WritePlainTextOptions {
  readonly document: ReadonlyDocument;
  readonly file: File;
}

export async function writePlainText(
  options: WritePlainTextOptions,
): Promise<void> {
  const text = await options.document.openSession(
    async (document) => await buildPlainText(document),
  );

  const writer = await options.file.openWriter();
  try {
    await writer.write(text);
    await writer.commit();
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

async function buildPlainText(document: ReadonlyDocument): Promise<string> {
  const toc = await document.readToc();

  if (toc === undefined) {
    throw new Error("Document TOC is missing");
  }

  const blocks = await renderTocItems(document, toc.items);

  if (blocks.length === 0) {
    return "";
  }

  return `${blocks.join("\n\n")}\n`;
}

async function renderTocItems(
  document: ReadonlyDocument,
  items: readonly TocItem[],
): Promise<string[]> {
  const blocks: string[] = [];

  for (const item of items) {
    const block = await renderTocItem(document, item);

    if (block !== undefined) {
      blocks.push(block);
    }
  }

  return blocks;
}

async function renderTocItem(
  document: ReadonlyDocument,
  item: TocItem,
): Promise<string | undefined> {
  const parts = [item.title?.trim()].filter(
    (value): value is string => value !== undefined && value !== "",
  );

  if (item.serialId !== undefined) {
    const summary = await document.readSummary(item.serialId);

    if (summary === undefined) {
      throw new WikiGraphError(
        "chapter_summary_missing_tree",
        `Chapter ${item.serialId} summary is missing.`,
        { chapterId: item.serialId },
      );
    }
    if (summary.trim() !== "") {
      parts.push(summary.trim());
    }
  }

  const childBlocks = await renderTocItems(document, item.children);

  if (parts.length === 0 && childBlocks.length === 0) {
    return undefined;
  }

  return [...parts, ...childBlocks].join("\n\n");
}
import { WikiGraphError } from "../../runtime/common/error.js";

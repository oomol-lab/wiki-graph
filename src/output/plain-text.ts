import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";

import type { ReadonlyDocument } from "../document/index.js";
import type { TocItem } from "../source/index.js";

export interface WritePlainTextOptions {
  readonly document: ReadonlyDocument;
  readonly path: string;
}

export async function writePlainText(
  options: WritePlainTextOptions,
): Promise<void> {
  const text = await options.document.openSession(
    async (document) => await buildPlainText(document),
  );

  await mkdir(dirname(options.path), { recursive: true });
  await writeFile(options.path, text, "utf8");
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
      throw new Error(
        `Serial ${item.serialId} summary is missing. Run \`spinedigest sdpub stage pending <path>\` to inspect unfinished chapters.`,
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

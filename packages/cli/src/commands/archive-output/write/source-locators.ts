import type {
  ArchiveSourceLocator,
  ArchiveSourceLocatorResult,
} from "wiki-graph-sdk";

import { formatCLIJSON, writeTextToStdout } from "../../../support/index.js";
import { createOutputContinuationCursor } from "../object/cursor.js";
import { createPageCursorObject } from "../object/page-cursor.js";
import type { ArchiveOutputContext, ResultFormat } from "../object/types.js";
import { formatNextCursor } from "../text/index.js";
import { writeJSONL } from "./jsonl.js";

export async function writeSourceLocators(
  result: ArchiveSourceLocatorResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const nextCursor = await createOutputContinuationCursor(
    context,
    result.nextCursor,
  );

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON({
        limit: result.limit,
        nextCursor,
        objects: result.items,
      }),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([...result.items, createPageCursorObject(nextCursor)]);
    return;
  }

  if (result.items.length === 0) {
    await writeTextToStdout("No source locators.\n");
    return;
  }

  await writeTextToStdout(
    `${result.items.map(formatSourceLocator).join("\n")}${formatNextCursor(nextCursor)}\n`,
  );
}

export async function writeAllSourceLocators(
  readPage: (cursor: string | undefined) => Promise<ArchiveSourceLocatorResult>,
  initialCursor: string | undefined,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const pages: ArchiveSourceLocatorResult[] = [];
  let cursor = initialCursor;

  while (true) {
    const page = await readPage(cursor);
    if (format === "jsonl") {
      await writeJSONL(page.items);
    } else {
      pages.push(page);
    }
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }

  if (format === "jsonl") return;

  const items = pages.flatMap((page) => page.items);
  await writeSourceLocators(
    { items, limit: items.length, nextCursor: null },
    context,
    format,
  );
}

function formatSourceLocator(locator: ArchiveSourceLocator): string {
  return `${locator.range[0]}..${locator.range[1]} -> ${locator.uri}`;
}

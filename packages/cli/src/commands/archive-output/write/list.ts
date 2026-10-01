import type { ArchiveRelatedResult } from "wiki-graph-sdk";

import { formatCLIJSON, writeTextToStdout } from "../../../support/index.js";
import { createOutputContinuationCursor } from "../object/cursor.js";
import {
  formatFindObject,
  formatNextCursor,
  formatOpenShortUriHint,
  getListObjectSeparator,
} from "../text/index.js";
import { writeJSONL } from "./jsonl.js";
import { createListObject, createObjectResultPage } from "../object/objects.js";
import { createPageCursorObject } from "../object/page-cursor.js";
import type { ArchiveOutputContext, ResultFormat } from "../object/types.js";
import {
  createOutputWarnings,
  createWarningJSONLObject,
  formatOutputWarnings,
} from "./warnings.js";

export async function writeList(
  result: ArchiveRelatedResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const objects = await Promise.all(
    result.items.map(async (item) => await createListObject(item, context)),
  );
  const nextCursor = await createOutputContinuationCursor(
    context,
    result.nextCursor,
  );
  const warnings = createOutputWarnings(context);

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(
        createObjectResultPage(objects, nextCursor, result.limit, warnings),
      ),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([
      ...warnings.map(createWarningJSONLObject),
      ...objects,
      createPageCursorObject(nextCursor),
    ]);
    return;
  }

  if (objects.length === 0) {
    await writeTextToStdout(`${formatOutputWarnings(warnings)}No objects.\n`);
    return;
  }

  await writeTextToStdout(
    `${formatOutputWarnings(warnings)}${objects.map(formatFindObject).join(getListObjectSeparator(objects))}${formatOpenShortUriHint(objects, context)}${formatNextCursor(nextCursor)}\n`,
  );
}

export async function writeAllRelatedItems(
  readPage: (cursor: string | undefined) => Promise<ArchiveRelatedResult>,
  initialCursor: string | undefined,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const pages: ArchiveRelatedResult[] = [];
  let cursor = initialCursor;

  while (true) {
    const page = await readPage(cursor);

    if (format === "jsonl") {
      await writeListWithoutContinuation(page, context, format, {
        emitWarnings: cursor === initialCursor,
      });
    } else {
      pages.push(page);
    }

    if (page.nextCursor === null) {
      break;
    }

    cursor = page.nextCursor;
  }

  if (format === "jsonl") {
    return;
  }

  await writeListWithoutContinuation(mergeRelatedPages(pages), context, format);
}

export async function writeListWithoutContinuation(
  result: ArchiveRelatedResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
  options: { readonly emitWarnings?: boolean } = {},
): Promise<void> {
  const objects = await Promise.all(
    result.items.map(async (item) => await createListObject(item, context)),
  );
  const warnings =
    (options.emitWarnings ?? true) ? createOutputWarnings(context) : [];

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(
        createObjectResultPage(objects, null, result.limit, warnings),
      ),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([...warnings.map(createWarningJSONLObject), ...objects]);
    return;
  }

  if (objects.length === 0) {
    await writeTextToStdout(`${formatOutputWarnings(warnings)}No objects.\n`);
    return;
  }

  await writeTextToStdout(
    `${formatOutputWarnings(warnings)}${objects.map(formatFindObject).join(getListObjectSeparator(objects))}\n`,
  );
}

function mergeRelatedPages(
  pages: readonly ArchiveRelatedResult[],
): ArchiveRelatedResult {
  const [first] = pages;

  if (first === undefined) {
    throw new Error("Internal error: no related pages were loaded.");
  }

  return {
    ...first,
    items: pages.flatMap((page) => page.items),
    limit: pages.reduce((total, page) => total + page.items.length, 0),
    nextCursor: null,
  };
}

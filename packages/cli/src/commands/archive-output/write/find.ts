import type { ArchiveFindResult } from "wiki-graph-sdk";

import { formatCLIJSON, writeTextToStdout } from "../../../support/index.js";
import { createOutputContinuationCursor } from "../object/cursor.js";
import {
  formatFindLensHint,
  formatFindObject,
  formatNextCursor,
  formatNoMatches,
  formatOpenShortUriHint,
  getListObjectSeparator,
} from "../text/index.js";
import { writeJSONL } from "./jsonl.js";
import { createFindObject, createObjectResultPage } from "../object/objects.js";
import { createPageCursorObject } from "../object/page-cursor.js";
import type { ArchiveOutputContext, ResultFormat } from "../object/types.js";
import {
  createOutputWarnings,
  createWarningJSONLObject,
  formatOutputWarnings,
} from "./warnings.js";

export async function writeFindHits(
  result: ArchiveFindResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const objects = await Promise.all(
    result.items.map(async (item) => await createFindObject(item, context)),
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
    await writeTextToStdout(
      `${formatOutputWarnings(warnings)}${formatNoMatches(result)}`,
    );
    return;
  }

  await writeTextToStdout(
    `${formatOutputWarnings(warnings)}${objects
      .map((object) => formatFindObject(object))
      .join(
        getListObjectSeparator(objects),
      )}${formatOpenShortUriHint(objects, context)}${formatNextCursor(nextCursor)}${formatFindLensHint(result)}\n`,
  );
}

export async function writeAllFindHits(
  readPage: (cursor: string | undefined) => Promise<ArchiveFindResult>,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const pages: ArchiveFindResult[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await readPage(cursor);

    if (format === "jsonl") {
      await writeFindHitsWithoutContinuation(page, context, format, {
        emitWarnings: cursor === undefined,
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

  const merged = mergeFindResultPages(pages);
  await writeFindHitsWithoutContinuation(merged, context, format);
}

export async function writeFindHitsWithoutContinuation(
  result: ArchiveFindResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
  options: { readonly emitWarnings?: boolean } = {},
): Promise<void> {
  const objects = await Promise.all(
    result.items.map(async (item) => await createFindObject(item, context)),
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
    await writeTextToStdout(
      `${formatOutputWarnings(warnings)}${formatNoMatches(result)}`,
    );
    return;
  }

  await writeTextToStdout(
    `${formatOutputWarnings(warnings)}${objects
      .map((object) => formatFindObject(object))
      .join(getListObjectSeparator(objects))}${formatFindLensHint(result)}\n`,
  );
}

function mergeFindResultPages(
  pages: readonly ArchiveFindResult[],
): ArchiveFindResult {
  const [first] = pages;

  if (first === undefined) {
    throw new Error("Internal error: no result pages were loaded.");
  }

  return {
    ...first,
    items: pages.flatMap((page) => page.items),
    limit: pages.reduce((total, page) => total + page.items.length, 0),
    nextCursor: null,
  };
}

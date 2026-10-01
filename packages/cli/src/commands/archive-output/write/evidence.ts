import type { ArchiveEvidence } from "wiki-graph-sdk";

import { formatCLIJSON, writeTextToStdout } from "../../../support/index.js";
import { createOutputContinuationCursor } from "../object/cursor.js";
import { formatEvidenceItem, formatEvidenceNextCursor } from "../text/index.js";
import { writeJSONL } from "./jsonl.js";
import {
  createObjectResultPage,
  createSourceObject,
} from "../object/objects.js";
import { createPageCursorObject } from "../object/page-cursor.js";
import type { ArchiveOutputContext, ResultFormat } from "../object/types.js";
import {
  createOutputWarnings,
  createWarningJSONLObject,
  formatOutputWarnings,
} from "./warnings.js";

export async function writeEvidence(
  evidence: ArchiveEvidence,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const nextCursor = await createOutputContinuationCursor(
    context,
    evidence.nextCursor,
  );
  const objects = evidence.items.map(createSourceObject);
  const warnings = createOutputWarnings(context);

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(
        createObjectResultPage(objects, nextCursor, evidence.limit, warnings),
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

  if (evidence.items.length === 0) {
    await writeTextToStdout(`${formatOutputWarnings(warnings)}No evidence.\n`);
    return;
  }

  await writeTextToStdout(
    `${formatOutputWarnings(warnings)}${evidence.items.map(formatEvidenceItem).join("\n\n")}${formatEvidenceNextCursor(nextCursor)}\n`,
  );
}

export async function writeAllEvidence(
  readPage: (cursor: string | undefined) => Promise<ArchiveEvidence>,
  initialCursor: string | undefined,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const pages: ArchiveEvidence[] = [];
  let cursor = initialCursor;

  while (true) {
    const page = await readPage(cursor);

    if (format === "jsonl") {
      await writeEvidenceWithoutContinuation(page, context, format, {
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

  await writeEvidenceWithoutContinuation(
    mergeEvidencePages(pages),
    context,
    format,
  );
}

export async function writeEvidenceWithoutContinuation(
  evidence: ArchiveEvidence,
  context: ArchiveOutputContext,
  format: ResultFormat,
  options: { readonly emitWarnings?: boolean } = {},
): Promise<void> {
  const objects = evidence.items.map(createSourceObject);
  const warnings =
    (options.emitWarnings ?? true) ? createOutputWarnings(context) : [];

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(
        createObjectResultPage(objects, null, evidence.limit, warnings),
      ),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([...warnings.map(createWarningJSONLObject), ...objects]);
    return;
  }

  if (evidence.items.length === 0) {
    await writeTextToStdout(`${formatOutputWarnings(warnings)}No evidence.\n`);
    return;
  }

  await writeTextToStdout(
    `${formatOutputWarnings(warnings)}${evidence.items.map(formatEvidenceItem).join("\n\n")}\n`,
  );
}

function mergeEvidencePages(
  pages: readonly ArchiveEvidence[],
): ArchiveEvidence {
  const [first] = pages;

  if (first === undefined) {
    throw new Error("Internal error: no evidence pages were loaded.");
  }

  return {
    ...first,
    items: pages.flatMap((page) => page.items),
    limit: pages.reduce((total, page) => total + page.items.length, 0),
    nextCursor: null,
  };
}

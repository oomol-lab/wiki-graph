import type { ArchivePage } from "wiki-graph-core";

import { formatCLIJSON, writeTextToStdout } from "../../../support/index.js";
import {
  appendEntityNextSteps,
  formatChapterObjectText,
  formatEntityWikipageText,
  formatEvidenceBackedPageText,
  formatFindObject,
  formatNeighborLines,
  formatNodeLabels,
  formatPlainObject,
  formatPosition,
  formatSourceFragmentLines,
  formatStatePageText,
} from "../text/index.js";
import { writeJSONL } from "./jsonl.js";
import { createPageObject } from "../object/objects.js";
import type {
  ArchiveOutputContext,
  ArchiveOutputObject,
  ResultFormat,
} from "../object/types.js";

export async function writePage(
  page: ArchivePage,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(await createPageObject(page, context)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([await createPageObject(page, context)]);
    return;
  }

  switch (page.type) {
    case "chapter-title":
      await writeTextToStdout(
        `${formatPlainObject(await createPageObject(page, context))}\n`,
      );
      return;
    case "chapter":
      await writeTextToStdout(
        `${formatChapterObjectText(
          (await createPageObject(page, context)) as ArchiveOutputObject,
        )}\n`,
      );
      return;
    case "meta":
      await writeTextToStdout(
        `${formatPlainObject(await createPageObject(page, context))}\n`,
      );
      return;
    case "state":
      await writeTextToStdout(
        `${formatStatePageText(await createPageObject(page, context))}\n`,
      );
      return;
    case "fragment":
      if (
        page.id.startsWith("wikg://") &&
        !page.id.includes("#") &&
        page.backlinks === undefined
      ) {
        await writeTextToStdout(`${page.fragment.text}\n`);
        return;
      }
      if (page.id.startsWith("wikg://chapter/")) {
        await writeTextToStdout(
          `${formatFindObject(
            (await createPageObject(page, context)) as ArchiveOutputObject,
          )}\n`,
        );
        return;
      }
      await writeTextToStdout(
        [
          `${page.id}`,
          `Words: ${page.fragment.wordsCount}`,
          `Previous: ${page.previousFragmentId ?? "[none]"}`,
          `Next: ${page.nextFragmentId ?? "[none]"}`,
          "",
          page.fragment.text,
          "",
          "Related Nodes:",
          ...formatNodeLabels(page.nodes),
        ].join("\n") + "\n",
      );
      return;
    case "node":
      await writeTextToStdout(
        [
          `${page.id}  ${page.title}`,
          `Chapter: ${page.position === undefined ? "[unknown]" : `chapter:${page.position.chapter}`}`,
          `Position: ${formatPosition(page.position)}`,
          "",
          "Generated Node Summary:",
          page.generatedNodeSummary,
          "",
          "Source Fragments:",
          ...formatSourceFragmentLines(page.sourceFragments),
          "",
          "Outgoing Nodes:",
          ...formatNeighborLines(page.outgoing),
          "",
          "Incoming Nodes:",
          ...formatNeighborLines(page.incoming),
        ].join("\n") + "\n",
      );
      return;
    case "summary":
      await writeTextToStdout(`${page.id}  ${page.title}\n\n${page.content}\n`);
      return;
    case "entity":
      await writeTextToStdout(
        `${appendEntityNextSteps(
          await formatEvidenceBackedPageText(
            page.id,
            page.label,
            page.evidence,
            context,
          ),
          page.id,
          context.archivePath,
        )}\n`,
      );
      return;
    case "entity-wikipage":
      await writeTextToStdout(`${formatEntityWikipageText(page)}\n`);
      return;
    case "triple":
      await writeTextToStdout(
        `${await formatEvidenceBackedPageText(
          page.id,
          page.label,
          page.evidence,
          context,
        )}\n`,
      );
      return;
  }
}
